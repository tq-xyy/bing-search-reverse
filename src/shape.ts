import type { ParsedSearch } from './contract.ts'

/**
 * 出口裁剪选项。三个开关语义一致：默认关，显式 true 才保留。
 *
 * 素材收敛成一个开关（`includeRichContents`）：图标、配图、富卡片、深链接、
 * 内嵌视频、缩略图同进同出。它们都是渲染素材，分成多个开关只会让调用方
 * 反复试哪种组合刚好「够用」。
 */
export interface ResultShape {
    includeRichContents?: boolean
    includeImages?: boolean
    includeVideos?: boolean
}

/**
 * 剥离所有素材：各型 ResultItem 的 `richContents`，以及 overview /
 * relatedQuestions 里引用来源的图标。原地修改。
 */
export function stripRichContents(result: ParsedSearch): ParsedSearch {
    for (const page of result.pages) delete page.richContents
    for (const citation of result.overview?.citations ?? [])
        delete citation.favicon
    for (const question of result.relatedQuestions) {
        for (const citation of question.citations ?? [])
            delete citation.favicon
    }
    return result
}

/** 按选项裁剪结果，原地修改。 */
export function applyResultShape(
    result: ParsedSearch,
    shape?: ResultShape
): ParsedSearch {
    if (shape?.includeRichContents !== true) stripRichContents(result)
    if (shape?.includeImages !== true) delete result.images
    if (shape?.includeVideos !== true)
        result.pages = result.pages.filter(p => p.type !== 'video')
    return result
}
