import { searchByCnBing, searchByInternationalBing } from './search.ts'
import type { SearchOptions, SearchResult } from './contract.ts'

export type { SearchOptions, SearchResult }

/** 中国大陆与港澳台走国内版，其余走国际版。 */
const CN_TIMEZONES = new Set([
    'Asia/Shanghai',
    'Asia/Chongqing',
    'Asia/Harbin',
    'Asia/Urumqi',
    'Asia/Kashgar',
    'PRC',
    'Asia/Hong_Kong',
    'Asia/Macau',
    'Asia/Taipei',
])

function resolveEntrance(
    explicit?: SearchOptions['bingEnterance'],
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): 'cn' | 'international' {
    if (explicit === 'cn' || explicit === 'international') return explicit
    return CN_TIMEZONES.has(timeZone) ? 'cn' : 'international'
}

/**
 * 搜索 Bing。
 *
 * 入口由 options.bingEnterance 决定，缺省按运行时时区推测。
 * 网络失败重试耗尽后返回空 pages（不抛错）。
 */
export function searchByBing(
    query: string,
    options?: SearchOptions
): Promise<SearchResult> {
    return resolveEntrance(options?.bingEnterance) === 'international'
        ? searchByInternationalBing(query, options)
        : searchByCnBing(query, options)
}
