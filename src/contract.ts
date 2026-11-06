import type { WebPage, PdfPage } from './parse/algo.ts'
import type { VideoPage } from './parse/video.ts'
import type { NewsPage, ImageCard } from './parse/cards.ts'
import type { Overview } from './parse/overview.ts'
import type { RelatedQuestion } from './parse/questions.ts'
import type { QueryCorrection } from './parse/correction.ts'
import type { ResultShape } from './shape.ts'

export type {
    WebPage,
    PdfPage,
    SideImage,
    LinkItem,
    RichContents,
} from './parse/algo.ts'
export type {
    VideoPage,
    InlineVideo,
    VideoRichContents,
} from './parse/video.ts'
export type {
    NewsPage,
    ImageCard,
    ImageItem,
    NewsRichContents,
} from './parse/cards.ts'
export type { Overview, OverviewCitation } from './parse/overview.ts'
export type {
    RelatedQuestion,
    RelatedAnswerCitation,
} from './parse/questions.ts'
export type { RichCard, RichSection } from './parse/rich.ts'
export type { QueryCorrection } from './parse/correction.ts'

/** 结果流中的一项。四型共用 type/title/url/snippet/site/publishedAt。 */
export type ResultItem = WebPage | PdfPage | VideoPage | NewsPage

/**
 * 解析层产出的一次搜索结果。
 *
 * 与 `SearchResult` 的差别只在于**没有调用级元信息**：`entrance` 与
 * `elapsedMs` 是 search 层的产物，解析层是纯函数，不该也没法知道。
 * 拆成两个类型，既让分层约束成立，也让解析器单测不必伪造这两个字段。
 */
export interface ParsedSearch {
    /** 结果流，文档顺序。四型混排，用 type 判别。 */
    pages: ResultItem[]
    overview?: Overview
    relatedQuestions: RelatedQuestion[]
    relatedSearches: string[]
    images?: ImageCard
    correct?: QueryCorrection
}

/** 一次搜索的结果：解析结果 + 调用级元信息。 */
export interface SearchResult extends ParsedSearch {
    /** 实际生效的入口：显式传入的，或按运行时时区推测出来的。 */
    entrance: 'cn' | 'international'
    /** 整个调用的墙钟耗时（毫秒），含重试与 PAA 加载。 */
    elapsedMs: number
}

/** 调用方的搜索选项。 */
export interface SearchOptions extends ResultShape {
    /** 入口：'cn' 国内版 / 'international' 国际版；缺省按运行时时区推测。 */
    bingEntrance?: 'cn' | 'international'
    /** 是否加载 PAA 答案正文（默认 true）。关掉能省一轮请求。 */
    loadRelatedAnswers?: boolean
    /** PAA 答案并发上限（默认 3）。 */
    relatedAnswerConcurrency?: number
}
