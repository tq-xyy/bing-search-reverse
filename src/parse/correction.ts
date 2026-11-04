import { one, text, type Document } from './dom.ts'

/** 查询纠错提示：两个 .b_promtxt 按文档顺序拼成整句（文案灰度可变，只认结构）。 */
export interface QueryCorrection {
    hint: string
    correctedQuery: string
}

export function extractCorrection(doc: Document): QueryCorrection | undefined {
    const requery = one('.sp_requery', doc)
    if (!requery) return undefined

    const correctedQuery = text(one('a', requery))
    if (!correctedQuery) return undefined

    const recourse = one('.sp_recourse', doc)
    const hint = text(requery) + (recourse ? text(recourse) : '')
    if (!hint) return undefined

    return { hint, correctedQuery }
}
