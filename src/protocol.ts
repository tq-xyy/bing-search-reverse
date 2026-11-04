/** Bing 站点的协议约定：基址、页面内联常量、接口 URL。 */

/** cn.bing.com 的基址。 */
export const CN_BING_ORIGIN = 'https://cn.bing.com'

/** 国际版在搜索 URL 上的开关参数。 */
export const INTERNATIONAL_ENTRANCE_PARAM = 'ensearch=1'

export type BingEntrance = 'cn' | 'international'

/** 页面里的 _G.IG，用于 rdr 第二遍与 PAA 答案接口。 */
export const IG_RE = /IG:"([0-9A-Fa-f]{32})"/

/** 首页 HTML 里的 Salt，即 HVE cookie 的取值。 */
export const SALT_RE = /Salt:"([^"]+)"/

/** PAA 参数：AnswerFetcher(..., "<Feed>", "<Language>")。 */
export const PAA_FEED_RE = /AnswerFetcher\([^,]+,\s*"([^"]+)"/
export const PAA_LANGUAGE_RE = /AnswerFetcher\([^,]+,\s*"[^"]+",\s*"([^"]+)"/

/** 搜索页 URL。不能带 first（会杀掉首屏富化模块）；国际版多一个 ensearch=1。 */
export function searchUrl(
    query: string,
    cvid: string,
    entrance: BingEntrance = 'cn'
): string {
    const encoded = encodeURIComponent(query)
    const base =
        CN_BING_ORIGIN +
        '/search?q=' +
        encoded +
        '&form=QBLH&sp=-1&lq=0&pq=' +
        encoded +
        '&sc=' +
        query.length +
        '-' +
        query.split(/\s+/).length +
        '&qs=n&sk=&cvid=' +
        cvid
    return entrance === 'international'
        ? base + '&' + INTERNATIONAL_ENTRANCE_PARAM
        : base
}

/** 入口首页，也是首遍搜索的 referer。 */
export function homeUrl(entrance: BingEntrance = 'cn'): string {
    return (
        CN_BING_ORIGIN +
        '/' +
        (entrance === 'international'
            ? '?' + INTERNATIONAL_ENTRANCE_PARAM
            : '')
    )
}

/** rdr 第二遍：追加 rdr=1&rdrig=<IG>。 */
export function rdrUrl(url: string, ig: string): string {
    return url + '&rdr=1&rdrig=' + ig
}

/** PAA 答案接口；SFX 是问题在列表里的序号（从 1 开始）。 */
export function paaAnswerUrl(ig: string, sfx: number): string {
    return (
        CN_BING_ORIGIN +
        '/getanswerforclickedquestion?IG=' +
        encodeURIComponent(ig) +
        '&IID=RelatedQnA-QnAAlsoAsk&SFX=' +
        sfx
    )
}
