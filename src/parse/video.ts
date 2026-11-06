import { all, one, text, attr, hasClass, type Element } from './dom.ts'
import { absoluteAssetUrl, resolveBingUrl } from './urls.ts'
import { parseDateTime } from '../utils/time.ts'

/** 视频答案卡容器 class。 */
export const VIDEO_CARD_CLASS = 'b_vidAns'

/** 视频条目共有的字段（不含 type 与素材）。 */
interface VideoMeta {
    duration?: string
    site?: string
    uploader?: string
    views?: string
    /** 发布时刻，按可信精度截断（10 / 13 / 16 位，`T` 分隔）。 */
    publishedAt?: string
}

/** 视频素材；默认不下发，需 includeRichContents。 */
export interface VideoRichContents {
    favicon?: string
    thumbnail?: string
}

/**
 * 视频卡里的一条视频。
 *
 * 卡片本身不单独暴露：卡头标题恒为 `<查询词> 的视频`，「更多视频」链接
 * 也只是 `/videos/search?q=<查询词>`，都能从 query 推出来。
 */
export interface VideoPage extends VideoMeta {
    type: 'video'
    title: string
    url: string
    snippet?: string
    richContents?: VideoRichContents
}

/**
 * 主结果里内嵌的视频富摘要，作为 `WebPage.richContents.video` 附加。
 *
 * 该 DOM 不提供简介与发布时间，所以不声明这两个字段（声明了也永远是空承诺）。
 */
export interface InlineVideo {
    url: string
    thumbnail?: string
    duration?: string
    site?: string
    uploader?: string
    views?: string
}

type VideoData = VideoMeta & {
    title: string
    url: string
    thumbnail?: string
}

/** aria-label 兜底表：字段 → 「标签 + 值 + ·」。 */
const ARIA_FIELDS = [
    ['duration', /时长:\s*([^·]+?)\s*·/],
    ['views', /已浏览\s*([^·]+?)\s*·/],
    ['site', /来源:\s*([^·]+?)\s*·/],
    ['uploader', /上传人:\s*([^·]+?)\s*·/],
] as const

/** 解析 div.mc_vtvc；视频卡与内嵌视频共用。 */
function parseVtvc(block: Element, nowMs: number): VideoData | undefined {
    const a = one('a.mc_vtvc_link', block)
    if (!a) return undefined
    const url = resolveBingUrl(attr(a, 'href'))
    if (!url) return undefined
    const aria = attr(a, 'aria-label') ?? ''

    const titleEl = one('.mc_vtvc_title', block)
    let title = (titleEl && attr(titleEl, 'title')) || text(titleEl)
    if (!title && aria) title = aria.split('来源:')[0].trim()
    if (!title) return undefined

    const item: VideoData = { title, url }

    const thumb = attr(one('.rms_iac', block), 'data-src')
    if (thumb) item.thumbnail = thumb

    const duration = text(one('.mc_bc.items', block))
    if (duration) item.duration = duration

    const spans = all('.mc_vtvc_meta_channel span', block)
    const uploaderEl = spans.find(s => hasClass(s, 'mc_vtvc_meta_row_channel'))
    const siteEl = spans.find(s => s !== uploaderEl)
    if (siteEl) item.site = text(siteEl) || undefined
    if (uploaderEl) item.uploader = text(uploaderEl) || undefined

    const views = text(one('.meta_vc_content', block))
    if (views) item.views = views

    const parsed = parseDateTime(text(one('.meta_pd_content', block)), nowMs)
    if (parsed) item.publishedAt = parsed.value

    for (const [field, re] of ARIA_FIELDS) {
        if (item[field]) continue
        const m = re.exec(aria)
        if (m) item[field] = m[1].trim()
    }
    if (!item.publishedAt) {
        const m = /上传时间:\s*([^·]+?)\s*·/.exec(aria)
        const fallback = m ? parseDateTime(m[1], nowMs) : undefined
        if (fallback) item.publishedAt = fallback.value
    }

    return item
}

/** 视频条目上的站点图标；当前样本不下发，有则填。 */
function faviconOf(container: Element): string | undefined {
    const el = one(
        '.cico.siteicon .rms_iac[data-src], .wr_fav .rms_iac[data-src]',
        container
    )
    return absoluteAssetUrl(el ? (attr(el, 'data-src') ?? '') : '')
}

/** 视频卡 → 多条 VideoPage。必须锁定卡容器，否则会把内嵌视频混进来。 */
export function extractVideoPages(card: Element, nowMs: number): VideoPage[] {
    const out: VideoPage[] = []
    for (const block of all('.mc_vtvc', card)) {
        const v = parseVtvc(block, nowMs)
        if (!v) continue

        const { title, url, thumbnail, ...meta } = v
        const item: VideoPage = { type: 'video', title, url, ...meta }

        const richContents: VideoRichContents = {}
        if (thumbnail) richContents.thumbnail = thumbnail
        const favicon = faviconOf(block)
        if (favicon) richContents.favicon = favicon
        if (Object.keys(richContents).length > 0)
            item.richContents = richContents

        out.push(item)
    }
    return out
}

/** 主结果内嵌视频（div.rc_videocap）。标题/URL 由所属 WebPage 承载。 */
export function extractInlineVideo(
    container: Element,
    nowMs: number
): InlineVideo | undefined {
    const cap = one('.rc_videocap', container)
    if (!cap) return undefined
    const v = parseVtvc(cap, nowMs)
    if (!v) return undefined

    let uploader: string | undefined
    let views: string | undefined
    for (const div of all('.b_factrow div', container)) {
        const t = text(div)
        const author = /^作者:\s*(.+)$/.exec(t)
        if (author) {
            uploader = author[1].trim()
            continue
        }
        const view = /^查看次数\s*(.+)$/.exec(t)
        if (view) views = '查看次数 ' + view[1].trim()
    }

    const inline: InlineVideo = { url: v.url }
    if (v.thumbnail) inline.thumbnail = v.thumbnail
    if (v.duration) inline.duration = v.duration
    if (v.site) inline.site = v.site
    if (uploader ?? v.uploader) inline.uploader = uploader ?? v.uploader
    if (views ?? v.views) inline.views = views ?? v.views
    return inline
}
