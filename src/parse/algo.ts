import { all, one, text, attr, type Element } from './dom.ts'
import { absoluteAssetUrl, resolveBingUrl } from './urls.ts'
import { extractDatePrefix } from '../utils/time.ts'
import { collectUnique } from '../utils/collect.ts'
import { extractRichCard, type RichCard } from './rich.ts'
import { extractInlineVideo, type InlineVideo } from './video.ts'

/** 主结果容器 class。 */
export const WEB_PAGE_CLASS = 'b_algo'

/** 主结果的判别值：正文页 / 文档。 */
export type DocumentType = 'page' | 'pdf'

/** Bing 在标题上方下发的文档类型标记（样本里只有 `[PDF]`）。 */
const DOC_TYPE_MARKER = '.sb_doct_txt'

/**
 * 标记文本 → 判别值。
 *
 * 只认已观测到的形态：没见过的标记（`[DOC]`/`[XLS]`/`[PPT]`）一律按正文页处理，
 * 不猜、不提前建类型。样本里标记与 URL 后缀 3/3 重合，但判别只看标记——
 * 我们是 Bing 的封装，Bing 打什么标就信什么标。
 */
const DOC_TYPE_BY_MARKER: Record<string, DocumentType> = { '[PDF]': 'pdf' }

export interface SideImage {
    thumbnailUrl: string
    detailUrl?: string
    width?: number
    height?: number
}

export interface LinkItem {
    title: string
    url: string
}

/**
 * 素材与富化块：渲染用，不是检索数据。
 *
 * 单独成组是为了让出口裁剪只认一个开关（`includeRichContents`），
 * 也为了让 `ResultItem` 那六个字段保持跨类型稳定。
 */
export interface RichContents {
    favicon?: string
    sideImage?: SideImage
    rich?: RichCard
    links?: LinkItem[]
    video?: InlineVideo
}

/** 普通结果条目。 */
export interface WebPage {
    type: 'page'
    title: string
    url: string
    snippet?: string
    /** Bing 展示名，可能错标；来源以 url 的 hostname 为准。 */
    site?: string
    /**
     * Bing 的收录 / 更新日，按可信精度截断（10 / 13 / 16 位，`T` 分隔）。
     * 不是内容所指事件的发生时间。
     */
    publishedAt?: string
    /** 素材；默认不下发，需 includeRichContents。 */
    richContents?: RichContents
}

/** 主结果条目的公共字段（type 之外）。 */
export type WebPageFields = Omit<WebPage, 'type'>

/** 文档型主结果：Bing 打了 `[PDF]` 标记的条目，字段与正文页同构。 */
export interface PdfPage extends WebPageFields {
    type: 'pdf'
}

/** 一次主结果提取的中间结果：判别值 + 已填好的字段。 */
export interface WebDigest {
    docType: DocumentType
    fields: WebPageFields
}

const MAX_LINKS = 20

function faviconOf(container: Element): string | undefined {
    const el = one(
        '.cico.siteicon .rms_iac[data-src], .wr_fav .rms_iac[data-src], ' +
            'img.res_img[src], img.res_img[data-src]',
        container
    )
    return absoluteAssetUrl(
        el ? (attr(el, 'data-src') ?? attr(el, 'src')) : ''
    )
}

function sideImageOf(container: Element): SideImage | undefined {
    const cap = one('.b_imgcap_img', container)
    if (!cap) return undefined
    const img = one('.rms_iac[data-src], img[data-src], img[src]', cap)
    const thumb = absoluteAssetUrl(
        img ? (attr(img, 'data-src') ?? attr(img, 'src')) : ''
    )
    if (!thumb) return undefined
    const a = one('a[href]', cap)
    const detail = resolveBingUrl(attr(a, 'href'))
    const width = Number(attr(img, 'data-width'))
    const height = Number(attr(img, 'data-height'))
    return {
        thumbnailUrl: thumb,
        detailUrl: detail || undefined,
        width: width || undefined,
        height: height || undefined,
    }
}

function linksOf(container: Element): LinkItem[] {
    return collectUnique(
        all(
            '.b_vtl_deeplinks a[href], .b_vlist2col.b_deep a[href]',
            container
        ),
        a => {
            const title = text(a)
            const url = resolveBingUrl(attr(a, 'href'))
            return title && url ? { key: url, value: { title, url } } : null
        },
        MAX_LINKS
    ).map(c => c.value)
}

/**
 * 判别一条主结果是正文页还是文档。
 *
 * 标记是 `h2` 的兄弟节点（`div.b_title > span.sb_doct_txt`），**不在标题里**，
 * 所以取 `text(h2 a)` 的标题天然不含它。class 多值（`sb_doct_txt b_float`），
 * 选择器按类名匹配、按文本定类型。
 */
function docTypeOf(container: Element): DocumentType {
    const marker = one(DOC_TYPE_MARKER, container)
    if (!marker) return 'page'
    return DOC_TYPE_BY_MARKER[text(marker).toUpperCase()] ?? 'page'
}

/** wpt 首屏网格里带来源行（.b_tpcn）的块才是主结果。 */
export function extractWptResults(
    container: Element,
    nowMs: number
): (WebPage | PdfPage)[] {
    const out: (WebPage | PdfPage)[] = []
    for (const bl of all('.b_wpt_bl', container)) {
        if (!one('.b_tpcn', bl)) continue
        const digest = extractWebDigest(bl, nowMs)
        if (!digest) continue
        const entry = {
            type: digest.docType,
            ...digest.fields,
        } as WebPage | PdfPage
        if (!entry.snippet) {
            const vlist = one('.b_vList.b_divsec', bl)
            if (vlist) {
                const t = text(vlist)
                if (t) entry.snippet = t
            }
        }
        out.push(entry)
    }
    return out
}

/**
 * 提取一条主结果的全部公共字段，并给出判别值。
 *
 * 判别在**同一次**遍历里做：wpt 网格与结果流都会把同一个块喂进来，
 * 拆成"先问类型再取字段"会白跑两遍 DOM 查询。
 */
export function extractWebDigest(
    container: Element,
    nowMs: number
): WebDigest | undefined {
    const a = one('h2 a', container)
    if (!a) return undefined
    const href = attr(a, 'href')
    if (!href) return undefined
    const title = text(a)
    if (!title) return undefined
    const url = resolveBingUrl(href)
    if (!url) return undefined

    const fields: WebPageFields = { title, url }

    const p = one('p[class*="b_lineclamp"]', container)
    if (p) {
        const parsed = extractDatePrefix(text(p), nowMs)
        if (parsed.date) fields.publishedAt = parsed.date
        if (parsed.rest) fields.snippet = parsed.rest
    }

    const site = text(one('.tptt', container))
    if (site) fields.site = site

    // 素材先攒进独立对象，一条都没有时整个 richContents 不出现
    const richContents: RichContents = {}

    const favicon = faviconOf(container)
    if (favicon) richContents.favicon = favicon

    const sideImage = sideImageOf(container)
    if (sideImage) richContents.sideImage = sideImage

    const rich = extractRichCard(container)
    if (rich) richContents.rich = rich

    const links = linksOf(container)
    if (links.length) richContents.links = links

    const video = extractInlineVideo(container, nowMs)
    if (video) richContents.video = video

    if (Object.keys(richContents).length > 0)
        fields.richContents = richContents

    return { docType: docTypeOf(container), fields }
}
