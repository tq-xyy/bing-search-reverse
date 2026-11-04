/** Bing 时间文本 → 带精度的本地时间（按精度截断，不伪造时刻）。 */

/** 时间精度：输出值能信到哪一级。 */
export type DatePrecision = 'minute' | 'hour' | 'day'

export interface ParsedDateTime {
    /** day→10 位、hour→13 位、minute→16 位 */
    value: string
    precision: DatePrecision
}

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 单位 → 时长与精度（月按 30 天、年按 365 天近似）。 */
const UNITS: Record<string, { ms: number; precision: DatePrecision }> = {
    秒: { ms: SEC, precision: 'minute' },
    分钟: { ms: MIN, precision: 'minute' },
    小时: { ms: HOUR, precision: 'hour' },
    天: { ms: DAY, precision: 'day' },
    周: { ms: 7 * DAY, precision: 'day' },
    个月: { ms: 30 * DAY, precision: 'day' },
    年: { ms: 365 * DAY, precision: 'day' },
}

function unitOf(token: string) {
    return UNITS[token.startsWith('秒') ? '秒' : token]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function ymd(year: string, month: string, day: string): string {
    return year + '-' + pad2(Number(month)) + '-' + pad2(Number(day))
}

function toLocalDateTime(ms: number): string {
    const d = new Date(ms)
    return (
        d.getFullYear() +
        '-' +
        pad2(d.getMonth() + 1) +
        '-' +
        pad2(d.getDate()) +
        ' ' +
        pad2(d.getHours()) +
        ':' +
        pad2(d.getMinutes())
    )
}

function trimByPrecision(full: string, precision: DatePrecision): string {
    if (precision === 'day') return full.slice(0, 10)
    if (precision === 'hour') return full.slice(0, 13)
    return full
}

/** 异体空格与连续空白归一。 */
function normalizeSpace(raw: string): string {
    return raw
        .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const UNIT_PATTERN = '秒钟?|分钟|小时|天|周|个月|年'

const RELATIVE_RE = new RegExp(
    '^(\\d{1,3}) ?(' + UNIT_PATTERN + ') ?(?:之前|前)$'
)

const BARE_DURATION_RE = new RegExp('^(\\d{1,3}) ?(' + UNIT_PATTERN + ')$')

/**
 * 解析 Bing 时间文本。
 *
 * @param opts.allowBareDuration 额外接受无「前」字的时长（资讯卡的「8 小时」）
 */
export function parseDateTime(
    raw: string,
    nowMs: number,
    opts?: { allowBareDuration?: boolean }
): ParsedDateTime | undefined {
    const t = normalizeSpace(raw)
        .replace(/^[·•\s]+/, '')
        .replace(/[·•\s]+$/, '')
    if (!t) return undefined

    const abs = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
    if (abs) return { value: ymd(abs[1], abs[2], abs[3]), precision: 'day' }
    const cn = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(t)
    if (cn) return { value: ymd(cn[1], cn[2], cn[3]), precision: 'day' }

    if (opts?.allowBareDuration) {
        const dur = BARE_DURATION_RE.exec(t)
        if (dur) return since(dur, nowMs)
    }
    const rel = RELATIVE_RE.exec(t)
    if (rel) return since(rel, nowMs)
    return undefined
}

function since(m: RegExpExecArray, nowMs: number): ParsedDateTime | undefined {
    const unit = unitOf(m[2])
    if (!unit) return undefined
    const full = toLocalDateTime(nowMs - Number(m[1]) * unit.ms)
    return {
        value: trimByPrecision(full, unit.precision),
        precision: unit.precision,
    }
}

/** 把日期与正文间的分隔符归一（兼容未解码的 &ensp; 等实体）。 */
function normalizeDateSeparators(raw: string): string {
    return raw
        .replace(/&ensp;|&nbsp;|&#8194;|&#160;/gi, ' ')
        .replace(/&#0*183;?/gi, '·')
        .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
}

const SP = '[\\s\\u00a0\\u2000-\\u200a\\u202f\\u205f\\u3000]*'
const SEP = SP + '·' + SP

const PREFIX_CN_DATE_RE = new RegExp(
    '^' + SP + '(\\d{4})年(\\d{1,2})月(\\d{1,2})日' + SEP
)

const PREFIX_DASH_DATE_RE = new RegExp(
    '^' + SP + '(\\d{4})-(\\d{1,2})-(\\d{1,2})' + SP + '[·-]' + SP
)

const PREFIX_RELATIVE_RE = new RegExp(
    '^' +
        SP +
        '(\\d{1,3}' +
        SP +
        '(?:' +
        UNIT_PATTERN +
        ')' +
        SP +
        '(?:之前|前))' +
        SEP
)

/** 从 snippet 行首拆出日期：必须同时满足「行首」+「后接 ·」。 */
export function extractDatePrefix(
    raw: string,
    nowMs: number
): { date?: string; datePrecision?: DatePrecision; rest: string } {
    raw = normalizeDateSeparators(raw)

    const abs = PREFIX_CN_DATE_RE.exec(raw)
    if (abs) return dated(abs, ymd(abs[1], abs[2], abs[3]), 'day', raw)

    const dash = PREFIX_DASH_DATE_RE.exec(raw)
    if (dash) return dated(dash, ymd(dash[1], dash[2], dash[3]), 'day', raw)

    const rel = PREFIX_RELATIVE_RE.exec(raw)
    if (rel) {
        const parsed = parseDateTime(rel[1], nowMs)
        if (parsed) return dated(rel, parsed.value, parsed.precision, raw)
    }

    return { rest: raw }
}

function dated(
    match: RegExpExecArray,
    date: string,
    datePrecision: DatePrecision,
    raw: string
) {
    return { date, datePrecision, rest: raw.slice(match[0].length) }
}
