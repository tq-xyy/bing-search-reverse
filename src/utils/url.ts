/** URL 通用工具：与具体站点无关。 */

/** 是否为绝对 http(s) URL。 */
export function isHttpUrl(raw: string): boolean {
    return /^https?:\/\//i.test(raw)
}

/** 相对地址 → 绝对 http(s) 地址；补不出时返回 undefined。 */
export function toAbsoluteUrl(
    raw: string | undefined,
    origin: string
): string | undefined {
    const s = raw?.trim()
    if (!s) return undefined
    if (isHttpUrl(s)) return s
    try {
        const url = new URL(s, origin)
        return isHttpUrl(url.href) ? url.href : undefined
    } catch {
        return undefined
    }
}

/** 按原始文本取查询参数，只解一层百分号编码（不能用 searchParams，+ 会被解成空格）。 */
export function readQueryParam(url: string, key: string): string | undefined {
    const m = new RegExp('[?&]' + key + '=([^&#]*)').exec(url)
    if (!m) return undefined
    try {
        return decodeURIComponent(m[1])
    } catch {
        return m[1]
    }
}
