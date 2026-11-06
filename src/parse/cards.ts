import { all, one, text, attr, type Element } from './dom.ts'
import { absoluteAssetUrl, resolveBingUrl } from './urls.ts'
import { isHttpUrl, readQueryParam } from '../utils/url.ts'
import { parseDateTime } from '../utils/time.ts'
import { collectUnique } from '../utils/collect.ts'

const MAX_ITEMS = 20

/** 图片卡容器 class。 */
export const IMAGE_CARD_CLASS = 'b_imgansacf'

/** 相关搜索词。按「先 #brsv3 后 #inline_rs」的顺序传入容器，取第一个非空的。 */
export function extractRelatedSearches(related: Element[]): string[] {
    for (const scope of related) {
        const hits = collectUnique(
            all('.b_suggestionText', scope),
            el => {
                const value = text(el)
                return value ? { key: value, value } : null
            },
            MAX_ITEMS
        )
        if (hits.length) return hits.map(c => c.value)
    }
    return []
}

/** 资讯条目的素材；默认不下发，需 includeRichContents。 */
export interface NewsRichContents {
    favicon?: string
    thumbnail?: string
}

/**
 * 资讯条目（两个变体：nscjk_card_link / nscard_link）。
 *
 * 与 WebPage 的差别在**时间语义**：这里是媒体的发布时刻，不是 Bing 的收录时间，
 * 覆盖率也高得多。
 */
export interface NewsPage {
    type: 'news'
    title: string
    url: string
    snippet?: string
    site?: string
    /** 发布时刻，按可信精度截断（10 / 13 / 16 位，`T` 分隔）。 */
    publishedAt?: string
    richContents?: NewsRichContents
}

/** 时间在 footer 末尾，前面可能挂来源名：「凤凰网科技 · 10 小时」。 */
function newsTimeText(raw: string): string {
    const parts = raw.split(/[·•]/)
    return parts[parts.length - 1]!.trim()
}

function newsFavicon(a: Element): string | undefined {
    const img = one(
        'img.pubimg[data-src-hq], img.pubimg[data-src], .pubimg[data-src-hq]',
        a
    )
    return absoluteAssetUrl(
        img ? (attr(img, 'data-src-hq') ?? attr(img, 'data-src')) : undefined
    )
}

/** 新闻缩略图：`.imagewrap` 里的 itm_img（nscjk 变体才有）。 */
function newsThumbnail(a: Element): string | undefined {
    const img = one(
        '.imagewrap img.itm_img[data-src-hq], ' +
            '.imagewrap img[data-src], .imagewrap img[src]',
        a
    )
    const raw = img
        ? (attr(img, 'data-src-hq') ??
          attr(img, 'data-src') ??
          attr(img, 'src'))
        : undefined
    return raw ? absoluteAssetUrl(raw) : undefined
}

function newsTitleOf(a: Element): string {
    return (
        attr(a, 'titletext') ||
        text(one('.nscjk_card_title', a)) ||
        text(one('.nscard_caption', a))
    )
}

/** 提取容器里的资讯条目，按每条展开。 */
export function extractNewsPages(
    container: Element,
    nowMs: number
): NewsPage[] {
    return collectUnique(
        all('a.nscjk_card_link, a.nscard_link', container),
        a => {
            const title = newsTitleOf(a)
            const url = resolveBingUrl(attr(a, 'href'))
            if (!title || !url) return null

            const item: NewsPage = { type: 'news', title, url }

            const snippet = text(one('.nscjk_card_snippet', a))
            if (snippet) item.snippet = snippet

            const site = attr(one('cite', a), 'title')
            if (site) item.site = site

            const parsedTime = parseDateTime(
                newsTimeText(
                    text(one('.cap_txt', a)) || text(one('.news_footer', a))
                ),
                nowMs,
                { allowBareDuration: true }
            )
            if (parsedTime) item.publishedAt = parsedTime.value

            const richContents: NewsRichContents = {}
            const favicon = newsFavicon(a)
            if (favicon) richContents.favicon = favicon
            const thumbnail = newsThumbnail(a)
            if (thumbnail) richContents.thumbnail = thumbnail
            if (Object.keys(richContents).length > 0)
                item.richContents = richContents

            return { key: url, value: item }
        },
        MAX_ITEMS
    ).map(c => c.value)
}

export interface ImageItem {
    thumbnailUrl: string
    title: string
    detailUrl: string
    mediaUrl?: string
    sourceUrl?: string
    width?: number
    height?: number
    originalWidth?: number
    originalHeight?: number
    id?: string
}

/**
 * 图片卡。卡头链接指向「查看更多图片」；Bing 还会下发一个只差 FORM 参数的
 * 「更多」链接，两种写法指向同一个搜索页，故不单独暴露。
 */
export interface ImageCard {
    title: string
    url?: string
    items: ImageItem[]
}

function imageItemOf(a: Element): ImageItem | undefined {
    const title = attr(one('.imgInfo', a), 'title') || attr(a, 'aria-label')
    const thumb = attr(one('[data-src]', a), 'data-src')
    const detailUrl = resolveBingUrl(attr(a, 'href'))
    if (!title || !thumb || !detailUrl) return undefined

    // mediaurl 解一层；若是 Bing R-C 代理，内部 riu 再解一层
    const mediaUrl = readQueryParam(detailUrl, 'mediaurl')
    const sourceUrl = mediaUrl ? readQueryParam(mediaUrl, 'riu') : undefined
    const wh = /width:\s*(\d+)px;\s*height:\s*(\d+)px/i.exec(
        attr(one('.cico', a), 'style') ?? ''
    )

    return {
        thumbnailUrl: thumb,
        title,
        detailUrl,
        mediaUrl,
        sourceUrl,
        width: wh ? Number(wh[1]) : undefined,
        height: wh ? Number(wh[2]) : undefined,
        ...numericFields(detailUrl),
    }
}

function numericFields(detailUrl: string): Partial<ImageItem> {
    const originalWidth = Number(readQueryParam(detailUrl, 'expw'))
    const originalHeight = Number(readQueryParam(detailUrl, 'exph'))
    const id = readQueryParam(detailUrl, 'thid')
    return {
        originalWidth: originalWidth || undefined,
        originalHeight: originalHeight || undefined,
        id,
    }
}

/**
 * 提取图片卡。卡内没有 img 标签（图全在 data-src），且含一个 svg 视觉搜索图标，
 * 因此只认 a.iacf_imglnk 且排除 svg。
 */
export function extractImageCard(
    containers: Element[]
): ImageCard | undefined {
    for (const card of containers) {
        const thumbOf = (a: Element): string => {
            const thumb = attr(one('[data-src]', a), 'data-src') ?? ''
            const usable = isHttpUrl(thumb) && !/\.svg(?:$|[?#])/i.test(thumb)
            return usable ? thumb : ''
        }

        const items = collectUnique(
            all('a.iacf_imglnk', card),
            a => {
                const key = thumbOf(a)
                if (!key) return null
                const item = imageItemOf(a)
                return item ? { key, value: item } : null
            },
            MAX_ITEMS
        ).map(c => c.value)
        if (items.length === 0) continue

        const head = one('a.iacf_head', card)
        const url = resolveBingUrl(attr(head, 'href'))

        return {
            title: text(head),
            url: url || undefined,
            items,
        }
    }
    return undefined
}
