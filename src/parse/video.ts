import { all, one, text, attr, hasClass, type Element } from './dom.ts'
import { resolveBingUrl } from './urls.ts'
import { parseDateTime, type DatePrecision } from '../utils/time.ts'

/** 视频答案卡容器 class。 */
export const VIDEO_CARD_CLASS = 'b_vidAns'

interface VideoMeta {
    thumbnail?: string
    duration?: string
    site?: string
    uploader?: string
    views?: string
    published?: string
    publishedPrecision?: DatePrecision
    description?: string
}

/** 视频卡展开后的一条视频。 */
export interface VideoPage extends VideoMeta {
    type: 'video'
    source: 'card'
    title: string
    url: string
    card: { title: string; moreUrl?: string }
}

/** 主结果里内嵌的视频富摘要，作为 WebPage.video 附加。 */
export interface InlineVideo extends VideoMeta {
    source: 'inline'
    url?: string
}

type VideoData = VideoMeta & { title: string; url: string }

/** aria-label 兜底表：字段 → 「标签 + 值 + ·」。 */
const ARIA_FIELDS = [
    ['duration', /时长:\s*([^·]+?)\s*·/],
    ['views', /已浏览\s*([^·]+?)\s*·/],
    ['site', /来源:\s*([^·]+?)\s*·/],
    ['uploader', /上传人:\s*([^·]+?)\s*·/],
] as const

function assignDate(
    target: VideoMeta,
    parsed: ReturnType<typeof parseDateTime>
): void {
    if (!parsed) return
    target.published = parsed.value
    target.publishedPrecision = parsed.precision
}

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

    assignDate(
        item,
        parseDateTime(text(one('.meta_pd_content', block)), nowMs)
    )

    for (const [field, re] of ARIA_FIELDS) {
        if (item[field]) continue
        const m = re.exec(aria)
        if (m) item[field] = m[1].trim()
    }
    if (!item.published) {
        const m = /上传时间:\s*([^·]+?)\s*·/.exec(aria)
        if (m) assignDate(item, parseDateTime(m[1], nowMs))
    }

    const desc = /单击以播放。?\s*·\s*([\s\S]+)$/.exec(aria)
    if (desc) {
        const d = desc[1].replace(/\s+/g, ' ').trim()
        if (d) item.description = d
    }
    return item
}

/** 视频卡 → 多条 VideoPage。必须锁定卡容器，否则会把内嵌视频混进来。 */
export function extractVideoPages(card: Element, nowMs: number): VideoPage[] {
    let title = ''
    let moreUrl: string | undefined
    for (const bt of all('.btitle', card)) {
        const a = one('a', bt)
        if (!a) continue
        if (!moreUrl) {
            const href = attr(a, 'href')
            if (href) moreUrl = resolveBingUrl(href) || undefined
        }
        const t = text(a)
        if (!title && t && !/^更多视频/.test(t)) title = t
    }

    const out: VideoPage[] = []
    for (const block of all('.mc_vtvc', card)) {
        const v = parseVtvc(block, nowMs)
        if (!v) continue
        out.push({
            type: 'video',
            source: 'card',
            ...v,
            card: { title, moreUrl },
        })
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

    const { title: _title, url, ...meta } = v
    return {
        source: 'inline',
        url,
        ...meta,
        uploader,
        views,
    }
}
