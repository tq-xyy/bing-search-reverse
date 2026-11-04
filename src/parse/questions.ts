import { all, one, text, attr, type Element } from './dom.ts'
import { collectUnique } from '../utils/collect.ts'

export interface RelatedAnswerCitation {
    title?: string
    site?: string
    url: string
    favicon?: string
}

export interface RelatedQuestion {
    question: string
    sourceUrl?: string
    answer?: string
    citations?: RelatedAnswerCitation[]
}

/** PAA 问题列表的容器内特征。 */
export const PAA_SELECTOR = '#df_listaa'

const MAX_QUESTIONS = 20

export function extractRelatedQuestions(
    containers: Element[]
): RelatedQuestion[] {
    const cells = containers.flatMap(container => {
        const df = one(PAA_SELECTOR, container)
        return df ? all('.acf-accn-itm', df) : []
    })

    return collectUnique(
        cells,
        item => {
            const question = text(one('.acf-accn-itm__hdr-label', item))
            if (!question) return null
            const sourceUrl = attr(
                one('.b_paa_ansContainer', item),
                'data-url'
            )
            return {
                key: question + '|' + (sourceUrl ?? ''),
                value: { question, sourceUrl },
            }
        },
        MAX_QUESTIONS
    ).map(c => c.value)
}
