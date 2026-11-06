import { parse, all, hasClass, type Document, type Element } from './dom.ts'
import { extractWebDigest, extractWptResults, WEB_PAGE_CLASS } from './algo.ts'
import { extractVideoPages, VIDEO_CARD_CLASS } from './video.ts'
import {
    extractNewsPages,
    extractRelatedSearches,
    extractImageCard,
    IMAGE_CARD_CLASS,
} from './cards.ts'
import { extractOverview } from './overview.ts'
import { extractRelatedQuestions } from './questions.ts'
import { extractCorrection } from './correction.ts'
import type { ParsedSearch, ResultItem } from '../contract.ts'

/** 结果流容器；缺结果流时退回全局 li.b_algo / li.b_ans。 */
function collectContainers(doc: Document): Element[] {
    const items = all('#b_results > li, .b_results_eml > li', doc)
    return items.length > 0 ? items : all('li.b_algo, li.b_ans', doc)
}

/**
 * 解析搜索结果页：一次 parse，卡片分流 + 全局字段。
 *
 * @param nowMs 相对时间的换算基准（可注入，便于测试确定性）
 */
export function parseSearchPage(
    html: string,
    nowMs = Date.now()
): ParsedSearch {
    const doc: Document = parse(html)
    const items = collectContainers(doc)

    const pages: ResultItem[] = []
    for (const item of items) {
        const wpt = extractWptResults(item, nowMs)
        if (wpt.length) pages.push(...wpt)

        const news = extractNewsPages(item, nowMs)
        if (news.length) pages.push(...news)

        // 视频卡与主结果互斥：按 class 先截断
        if (hasClass(item, VIDEO_CARD_CLASS)) {
            pages.push(...extractVideoPages(item, nowMs))
            continue
        }
        if (hasClass(item, WEB_PAGE_CLASS)) {
            const digest = extractWebDigest(item, nowMs)
            if (digest) pages.push({ type: digest.docType, ...digest.fields })
        }
    }

    return {
        pages,
        overview: extractOverview(items),
        relatedQuestions: extractRelatedQuestions(items),
        // #brsv3 是 #inline_rs 的超集，必须分组枚举而非合并选择器
        relatedSearches: extractRelatedSearches(
            ['#brsv3', '#inline_rs'].flatMap(id => all(id, doc))
        ),
        images: extractImageCard(
            items.filter(el => hasClass(el, IMAGE_CARD_CLASS))
        ),
        correct: extractCorrection(doc),
    }
}
