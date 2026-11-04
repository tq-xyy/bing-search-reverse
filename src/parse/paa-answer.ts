import {
    all,
    one,
    text,
    attr,
    parse,
    type Document,
    type Element,
} from './dom.ts'
import { collectUnique } from '../utils/collect.ts'
import type { RelatedAnswerCitation } from './questions.ts'

export interface PaaAnswer {
    answer?: string
    citations?: RelatedAnswerCitation[]
}

/** 引用 URL：优先 .paa-cit-url 文本，退到父节点 a[href]。 */
function citationUrlOf(card: Element): string {
    const parent = card.parent
    const href =
        parent && parent.type === 'tag' ? (attr(parent, 'href') ?? '') : ''
    return text(one('.paa-cit-url', card)) || href
}

/** 解析 PAA 答案接口返回的 HTML 片段。 */
export function parsePaaAnswer(html: string): PaaAnswer {
    if (!html) return {}
    const doc: Document = parse(html)

    const answer = text(one('.paa-txt', doc)) || undefined

    const citations = collectUnique(all('.paa-cit-card', doc), card => {
        const url = citationUrlOf(card)
        if (!url) return null
        const title = text(one('.paa-cit-txt', card))
        const site = text(one('.paa-cit-attr-text', card))
        const favicon = attr(one('.paa-cit-logo img', card), 'src')
        return { key: url, value: { title, site, url, favicon } }
    }).map(c => c.value)

    return { answer, citations: citations.length ? citations : undefined }
}
