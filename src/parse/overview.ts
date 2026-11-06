import { all, one, text, attr, hasClass, type Element } from './dom.ts'
import { resolveBingUrl } from './urls.ts'

/** 摘要的一条引用来源。 */
export interface OverviewCitation {
    /** 链接原文，Bing 未给时缺失。 */
    title?: string
    /** 来源站点名。 */
    site?: string
    url: string
    /** 来源图标；默认不下发，需 includeRichContents。 */
    favicon?: string
}

/** AI 生成的答案摘要（生成式内容，不保证准确）。 */
export interface Overview {
    kind: 'cht' | 'gs'
    title: string
    /** 正文块，Markdown 片段。 */
    paragraphs: string[]
    /** 引用来源，按 URL 去重。 */
    citations: OverviewCitation[]
}

const isNoise = (el: Element): boolean =>
    el.name === 'a' || hasClass(el, 'cht_codblk_hdr')

function clean(node: Element | null | undefined, skipLists = false): string {
    return text(
        node,
        skipLists
            ? el => isNoise(el) || el.name === 'ul' || el.name === 'ol'
            : isNoise
    )
}

function childItems(list: Element): Element[] {
    return (list.children ?? []).filter(
        (n): n is Element => n.type === 'tag' && n.name === 'li'
    )
}

function directLists(el: Element): Element[] {
    return (el.children ?? []).filter(
        (n): n is Element =>
            n.type === 'tag' && (n.name === 'ul' || n.name === 'ol')
    )
}

function listMarkdown(list: Element, depth = 0): string {
    const indent = '    '.repeat(depth)
    const ordered = list.name === 'ol'
    const lines: string[] = []
    childItems(list).forEach((li, i) => {
        const own = clean(li, true)
        if (own) lines.push(indent + (ordered ? i + 1 + '. ' : '- ') + own)
        for (const sub of directLists(li))
            lines.push(listMarkdown(sub, depth + 1))
    })
    return lines.join('\n')
}

/** cht 型正文是 Markdown 渲染结果，这里按块还原成 Markdown 片段。 */
function readChtBody(root: Element): string[] {
    const box = one('.cht_mdroot', root) ?? root
    const out: string[] = []
    let lead: string | null = null
    let firstH2 = true

    const push = (block: string, merge: boolean) => {
        if (merge && lead) out[out.length - 1] = lead + '\n' + block
        else out.push(block)
        lead = null
    }

    for (const node of box.children ?? []) {
        if (node.type !== 'tag') continue
        const el = node as Element

        if (el.name === 'h2' || el.name === 'h3') {
            const t = clean(el)
            if (!t) continue
            if (el.name === 'h2' && firstH2) {
                firstH2 = false
                lead = null
                continue
            }
            push((el.name === 'h2' ? '## ' : '### ') + t, false)
            continue
        }
        if (el.name === 'hr') {
            lead = null
            continue
        }
        if (el.name === 'p') {
            const t = clean(el)
            if (!t) continue
            out.push(t)
            lead = /[：:]$/.test(t) ? t : null
            continue
        }
        if (el.name === 'ul' || el.name === 'ol') {
            const md = listMarkdown(el)
            if (md) push(md, true)
            continue
        }
        if (el.name === 'pre') {
            const code = one('code', el)
            const body = clean(code ?? el)
            if (!body) continue
            const raw = clean(one('.cht_codblk_lang', el)).toLowerCase()
            const lang = raw && raw !== 'code' ? raw : ''
            push('```' + lang + '\n' + body + '\n' + '```', true)
            continue
        }
        lead = null
    }
    return out
}

function citFavicon(link: Element): string | undefined {
    const img = one('img.md_citlink__fav-img[data-src]', link)
    return img ? (attr(img, 'data-src') ?? undefined) : undefined
}

function readCht(container: Element): Overview | undefined {
    const root = one('.cht_text', container)
    if (!root) return undefined

    let title = ''
    for (const h2 of all('h2', root)) {
        const s = one('strong', h2)
        if (s) {
            title = text(s)
            break
        }
    }

    const paragraphs = readChtBody(root)

    const citations: OverviewCitation[] = []
    const seen = new Set<string>()
    for (const a of all('a.md_citlink', root)) {
        const url = resolveBingUrl(attr(a, 'href'))
        if (!url || seen.has(url)) continue
        seen.add(url)
        const citation: OverviewCitation = { url }
        // 链接内可见文本只有「图标 + 站点名」，没有页标题，所以 title 留空不编造
        const site = text(one('.md_citlink__site', a))
        if (site) citation.site = site
        const favicon = citFavicon(a)
        if (favicon) citation.favicon = favicon
        citations.push(citation)
    }

    if (!title && paragraphs.length === 0 && citations.length === 0)
        return undefined
    return { kind: 'cht', title, paragraphs, citations }
}

/** gs 型：正文 .gs_p，引用 .gs_cit（与正文是兄弟节点，必须按容器找）。 */
function readGs(container: Element): Overview | undefined {
    const root = one('.gs_text', container)
    if (!root) return undefined

    let title = ''
    for (const sel of ['h2', 'h3', '.gs_title', '.gs_h_title']) {
        const el = one(sel, root)
        if (el) {
            title = text(el)
            if (title) break
        }
    }

    const paragraphs: string[] = []
    for (const p of all('.gs_p', root)) {
        const t = clean(p)
        if (t) paragraphs.push(t)
    }
    if (paragraphs.length === 0) {
        const whole = clean(root)
        if (whole) paragraphs.push(whole)
    }
    if (!title && paragraphs.length > 0) title = paragraphs[0].slice(0, 80)

    const citations: OverviewCitation[] = []
    const seen = new Set<string>()
    for (const c of all('.gs_cit', container)) {
        let url = resolveBingUrl(attr(c, 'data-url'))
        const hash = url.indexOf('#')
        if (hash > 0) url = url.slice(0, hash)
        if (!url || seen.has(url)) continue
        seen.add(url)
        const citation: OverviewCitation = { url }
        const site = attr(c, 'data-displayname')
        if (site) citation.site = site
        const favicon = attr(one('.rms_iac[data-src]', c), 'data-src')
        if (favicon) citation.favicon = favicon
        citations.push(citation)
    }

    if (!title && paragraphs.length === 0 && citations.length === 0)
        return undefined
    return { kind: 'gs', title, paragraphs, citations }
}

/** 提取答案摘要：先 cht 后 gs。 */
export function extractOverview(containers: Element[]): Overview | undefined {
    for (const container of containers) {
        const r = readCht(container)
        if (r) return r
    }
    for (const container of containers) {
        const r = readGs(container)
        if (r) return r
    }
    return undefined
}
