import { searchByCnBing, searchByInternationalBing } from './search.ts'
import { resolveEntrance } from './entrance.ts'
import type { SearchOptions, SearchResult } from './contract.ts'

export type { SearchOptions, SearchResult }

/**
 * 搜索 Bing。
 *
 * 入口由 options.bingEntrance 决定，缺省按运行时时区推测；实际生效的入口
 * 回填到结果的 `entrance`，耗时（含重试与 PAA）回填到 `elapsedMs`。
 *
 * 失败抛错：网络错误与 HTTP 错误都抛，重试耗尽后仍抛。空 `pages`
 * 只表示 Bing 确实没给结果。
 */
export function searchByBing(
    query: string,
    options?: SearchOptions
): Promise<SearchResult> {
    return resolveEntrance(options?.bingEntrance) === 'international'
        ? searchByInternationalBing(query, options)
        : searchByCnBing(query, options)
}
