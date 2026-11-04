import { randomUUID } from 'node:crypto'
import { CookieJar } from 'tough-cookie'
import { baseHeaders } from './headers.ts'
import { CN_BING_ORIGIN, IG_RE, SALT_RE } from '../protocol.ts'
import { assertOk } from './errors.ts'

const DEFAULT_TIMEOUT = 6_000

/** SRCHHPGUSR 缺失时必须补齐的渲染窗口字段（缺它们返回骨架页）。 */
const SRCHHPGUSR_DEFAULTS: Record<string, string> = {
    SRCHLANG: 'zh-Hans',
    PREFCOL: '0',
    BRW: 'HTP',
    BRH: 'S',
    CW: '756',
    CH: '488',
    DPR: '1',
    UTC: '480',
}

export interface SessionRequestInit {
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: string
    referer?: string
    timeoutMs?: number
}

export interface SessionResponse {
    status: number
    body: string
    url: string
}

/** 一次搜索会话：cookie jar + 首页握手得到的站点参数。 */
export class Session {
    readonly jar = new CookieJar()
    /** 首页 HTML 里的 _G.IG，用于 rdr=1&rdrig=<IG>。 */
    ig?: string

    readonly origin: string

    constructor(origin: string = CN_BING_ORIGIN) {
        this.origin = origin
    }

    async cookieHeader(): Promise<string> {
        return this.jar.getCookieString(this.origin + '/')
    }

    /** 发一次请求：自动带 cookie 与 referer，响应的 Set-Cookie 写回 jar。 */
    async request(
        url: string,
        init?: SessionRequestInit
    ): Promise<SessionResponse> {
        const cookie = await this.cookieHeader()
        const headers: Record<string, string> = {
            ...baseHeaders(),
            ...init?.headers,
            cookie,
            referer: init?.referer ?? this.origin + '/',
        }
        const res = await fetch(url, {
            method: init?.method ?? 'GET',
            headers,
            body: init?.body,
            redirect: 'follow',
            signal: AbortSignal.timeout(init?.timeoutMs ?? DEFAULT_TIMEOUT),
        })
        const body = await res.text()
        await this.absorbSetCookie(res, url)
        return { status: res.status, body, url }
    }

    private async absorbSetCookie(res: Response, url: string): Promise<void> {
        for (const raw of res.headers.getSetCookie()) {
            try {
                await this.jar.setCookie(raw, url)
            } catch {
                /* 无法解析的 cookie 忽略 */
            }
        }
    }
}

function parseSubCookie(raw: string): Map<string, string> {
    const fields = new Map<string, string>()
    for (const f of raw.split('&')) {
        if (!f) continue
        const eq = f.indexOf('=')
        if (eq < 0) fields.set(f, '')
        else fields.set(f.slice(0, eq), f.slice(eq + 1))
    }
    return fields
}

/**
 * 把 HV/HVE 合并进已有的 SRCHHPGUSR 并补齐渲染窗口字段。
 * 必须复用原 cookie 的 Domain/Path，否则 jar 里会出现第二条同名 cookie。
 */
async function mergeSrchhpgusr(session: Session, salt: string): Promise<void> {
    const scope = session.origin + '/'
    const cookies = await session.jar.getCookies(scope)
    const existing = cookies.find(c => c.key === 'SRCHHPGUSR')
    const fields = existing
        ? parseSubCookie(existing.value)
        : new Map<string, string>()
    for (const [k, v] of Object.entries(SRCHHPGUSR_DEFAULTS)) {
        if (!fields.has(k)) fields.set(k, v)
    }
    fields.set('HV', String(Math.round(Date.now() / 1000)))
    fields.set('HVE', salt)

    const value = [...fields].map(([k, v]) => (v ? k + '=' + v : k)).join('&')
    const domain = existing?.domain
        ? '; Domain=' +
          (existing.domain.startsWith('.')
              ? existing.domain
              : '.' + existing.domain)
        : ''
    const path = '; Path=' + (existing?.path ?? '/')
    await session.jar.setCookie('SRCHHPGUSR=' + value + domain + path, scope)
}

/** 页面 JS 首次交互时会写的 cookie，这里直接构造。_RwBf 必须是完整形态。 */
function jsCookies(now: number): string[] {
    return [
        'ipv6=hit=' + now + '&t=4',
        'BFBUSR=BFBHP=0',
        'SNRHOP=I=&TS=',
        '_RwBf=r=0&ilt=1&ihpd=1&ispd=0&rc=0&rb=0&rg=200&pc=0&mtu=0&rbb=0&clo=0&v=1' +
            '&l=2026-10-14T07:00:00.0000000Z&lft=0001-01-01T00:00:00.0000000&aof=0' +
            '&ard=0001-01-01T00:00:00.0000000&rwdbt=0&rwflt=0&rwaul2=0&g=&o=2&p=&c=&t=0' +
            '&s=0001-01-01T00:00:00.0000000+00:00&ts=' +
            new Date(now).toISOString() +
            '&rwred=0&wls=&wlb=&wle=&ccp=&cpt=&lka=0&lkt=0&aad=0&TH=&cid=0&gb=',
        'WLS=C=' + randomUUID() + '&N=',
    ]
}

/** 建立会话：首页握手取 cookie，并用页面里的 Salt 自造 HVE。 */
async function establishSession(): Promise<Session> {
    const session = new Session()
    const home = await session.request(CN_BING_ORIGIN + '/')
    assertOk(home.status)

    const existing = new Set(
        (await session.jar.getCookies(CN_BING_ORIGIN + '/')).map(c => c.key)
    )
    for (const item of jsCookies(Date.now())) {
        const eq = item.indexOf('=')
        const name = eq < 0 ? item : item.slice(0, eq)
        if (existing.has(name)) continue
        await session.jar.setCookie(
            item + '; Domain=.bing.com; Path=/',
            CN_BING_ORIGIN + '/'
        )
    }

    const salt = SALT_RE.exec(home.body)?.[1]
    if (salt) await mergeSrchhpgusr(session, salt)
    session.ig = IG_RE.exec(home.body)?.[1]
    return session
}

let cache: Session | Promise<Session> | null = null

/** 取会话（进程级缓存，single-flight）；失败时清空缓存以便重试。 */
export async function getSession(): Promise<Session> {
    const cached = cache
    if (cached instanceof Promise) return cached
    if (cached) return cached

    const pending = establishSession()
    cache = pending
    try {
        const session = await pending
        if (cache === pending) cache = session
        return session
    } catch (e) {
        if (cache === pending) cache = null
        throw e
    }
}

/** 丢弃当前会话，下次调用重新握手。 */
export function invalidateSession(): void {
    cache = null
}
