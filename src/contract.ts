import type { WebPage, PdfPage } from './parse/algo.ts'
import type { VideoPage } from './parse/video.ts'
import type { NewsPage, ImageCard } from './parse/cards.ts'
import type { Overview } from './parse/overview.ts'
import type { RelatedQuestion } from './parse/questions.ts'
import type { QueryCorrection } from './parse/correction.ts'
import type { ResultShape } from './shape.ts'

export type { WebPage, PdfPage, SideImage, LinkItem } from './parse/algo.ts'
export type { VideoPage, InlineVideo } from './parse/video.ts'
export type { NewsPage, ImageCard, ImageItem } from './parse/cards.ts'
export type { Overview, OverviewSource } from './parse/overview.ts'
export type {
    RelatedQuestion,
    RelatedAnswerCitation,
} from './parse/questions.ts'
export type { RichCard, RichSection } from './parse/rich.ts'
export type { QueryCorrection } from './parse/correction.ts'

/** 结果流中的一项。 */
export type SearchResultPage = WebPage | PdfPage | VideoPage | NewsPage

/** 一次搜索的结果。 */
export interface SearchResult {
    pages: SearchResultPage[]
    overview?: Overview
    relatedQuestions: RelatedQuestion[]
    relatedSearches: string[]
    images?: ImageCard
    correct?: QueryCorrection
}

/** 调用方的搜索选项。 */
export interface SearchOptions extends ResultShape {
    /** 是否加载 PAA 答案正文（默认 true）。 */
    loadRelatedAnswers?: boolean
    /** PAA 答案加载并发上限（默认 3）。 */
    relatedAnswerConcurrency?: number
    /** 入口：'cn' 国内版 / 'international' 国际版；缺省按运行时时区推测。 */
    bingEnterance?: 'cn' | 'international'
}
