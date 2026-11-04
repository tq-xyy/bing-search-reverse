import { isHttpUrl, toAbsoluteUrl } from '../utils/url.ts'
import { CN_BING_ORIGIN } from '../protocol.ts'

const BING_ASSET_ORIGIN = 'https://www.bing.com'
const REDIRECT_PATH = '/ck/a'

/** 图片/图标地址补成绝对 URL（Bing CDN）；非法形态返回 undefined。 */
export function absoluteAssetUrl(raw: string | undefined): string | undefined {
    return toAbsoluteUrl(raw, BING_ASSET_ORIGIN)
}

/**
 * 解 /ck/a?...&u=a1<base64url> 里的真实地址。
 * 解出的可能是绝对 URL 或站内相对路径；非跳转与解析失败一律原样返回。
 */
export function decodeBingRedirectUrl(raw: string): string {
    if (!isHttpUrl(raw)) return raw
    let parsed: URL
    try {
        parsed = new URL(raw)
    } catch {
        return raw
    }
    if (parsed.pathname !== REDIRECT_PATH) return raw

    // 用原始 query 正则取 u：searchParams 会把 base64 里的 + 解成空格
    const uMatch = raw.match(/[?&]u=([^&]+)/)
    const u = uMatch ? uMatch[1] : null
    if (!u || !u.startsWith('a1')) return raw

    let encoded = u.slice(2)
    if (encoded.includes('%')) {
        try {
            encoded = decodeURIComponent(encoded)
        } catch {
            /* 保留原值 */
        }
    }

    let decoded: string
    try {
        decoded = Buffer.from(encoded, 'base64url').toString('utf-8')
    } catch {
        return raw
    }
    if (isHttpUrl(decoded)) return decoded
    if (decoded.startsWith('/')) return decoded
    return raw
}

/** 解析层取链接的统一出口：解跳转 + 补绝对，幂等。失败返回空串。 */
export function resolveBingUrl(href: string | undefined): string {
    const raw = href?.trim()
    if (!raw) return ''
    return toAbsoluteUrl(decodeBingRedirectUrl(raw), CN_BING_ORIGIN) ?? ''
}
