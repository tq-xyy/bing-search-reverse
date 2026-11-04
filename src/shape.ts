import type { SearchResult } from './contract.ts'

/** 出口裁剪选项；三个开关语义一致：默认关，显式 true 才保留。 */
export interface ResultShape {
    includeIcons?: boolean
    includeImages?: boolean
    includeVideos?: boolean
}

/** 剥离 favicon / logo / 来源图标，原地修改。 */
export function stripIcons(result: SearchResult): SearchResult {
    for (const page of result.pages) {
        if (page.type === 'page' || page.type === 'pdf') delete page.favicon
        else if (page.type === 'news') delete page.logo
    }
    for (const source of result.overview?.sources ?? []) delete source.favicon
    for (const question of result.relatedQuestions) {
        for (const citation of question.citations ?? [])
            delete citation.favicon
    }
    return result
}

/** 按选项裁剪结果，原地修改。 */
export function applyResultShape(
    result: SearchResult,
    shape?: ResultShape
): SearchResult {
    if (shape?.includeIcons !== true) stripIcons(result)
    if (shape?.includeImages !== true) delete result.images
    if (shape?.includeVideos !== true)
        result.pages = result.pages.filter(p => p.type !== 'video')
    return result
}
