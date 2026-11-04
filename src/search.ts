import { randomUUID } from 'node:crypto'
import { getSession, invalidateSession, type Session } from './net/session.ts'
import { assertOk, backoffDelay, toSearchHttpError } from './net/errors.ts'
import { parseSearchPage } from './parse/index.ts'
import { applyResultShape } from './shape.ts'
import type { SearchOptions, SearchResult } from './contract.ts'
import { loadRelatedAnswers } from './net/paa.ts'
import {
    IG_RE,
    PAA_FEED_RE,
    PAA_LANGUAGE_RE,
    homeUrl,
    rdrUrl,
    searchUrl,
    type BingEntrance,
} from './protocol.ts'

const MAX_ATTEMPTS = 3

/** 骨架页约 100KB、填充页 320KB 起。 */
const FILLED_MIN_BYTES = 200_000

interface FetchedPage {
    html: string
    referer: string
    ig?: string
    feed?: string
    language?: string
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/** 取一次搜索结果页；首遍是骨架页时补 rdr 第二遍。 */
async function requestPage(
    query: string,
    session: Session,
    entrance: BingEntrance
): Promise<FetchedPage> {
    const cvid = randomUUID().replaceAll('-', '').toUpperCase()
    const url = searchUrl(query, cvid, entrance)

    const first = await session.request(url, { referer: homeUrl(entrance) })
    let { status, body } = first

    if (status === 200 && body.length < FILLED_MIN_BYTES) {
        const ig = IG_RE.exec(first.body)?.[1] ?? session.ig
        if (ig) {
            try {
                const second = await session.request(rdrUrl(url, ig), {
                    referer: url,
                })
                if (
                    second.status === 200 &&
                    second.body.length > body.length
                ) {
                    status = second.status
                    body = second.body
                }
            } catch {
                /* 保留第一遍响应 */
            }
        }
    }

    assertOk(status)

    return {
        html: body,
        referer: url,
        ig: IG_RE.exec(body)?.[1] ?? session.ig,
        feed: PAA_FEED_RE.exec(body)?.[1],
        language: PAA_LANGUAGE_RE.exec(body)?.[1],
    }
}

/** 加载 PAA 答案正文（附加能力，失败只丢 answer/citations）。 */
async function attachAnswers(
    session: Session,
    page: FetchedPage,
    result: SearchResult,
    options: SearchOptions | undefined
): Promise<void> {
    if (options?.loadRelatedAnswers === false) return
    if (result.relatedQuestions.length === 0 || !page.ig) return

    try {
        result.relatedQuestions = await loadRelatedAnswers(
            session,
            result.relatedQuestions,
            {
                ig: page.ig,
                referer: page.referer,
                feed: page.feed,
                language: page.language,
                concurrency: options?.relatedAnswerConcurrency,
            }
        )
    } catch {
        /* 附加能力：失败保留问题与来源 URL */
    }
}

async function search(
    query: string,
    options: SearchOptions | undefined,
    entrance: BingEntrance
): Promise<SearchResult> {
    const nowMs = Date.now()
    const empty: SearchResult = {
        pages: [],
        relatedQuestions: [],
        relatedSearches: [],
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let page: FetchedPage
        let session: Session
        try {
            session = await getSession()
            page = await requestPage(query, session, entrance)
        } catch (e) {
            const err = toSearchHttpError(e)
            if (!err.retryable) return empty
            invalidateSession()
            if (attempt < MAX_ATTEMPTS) {
                await wait(backoffDelay(attempt))
                continue
            }
            return empty
        }

        const result = parseSearchPage(page.html, nowMs)
        await attachAnswers(session, page, result, options)
        applyResultShape(result, options)
        return result
    }
    return empty
}

/** 搜索国内版（cn.bing.com）。 */
export function searchByCnBing(
    query: string,
    options?: SearchOptions
): Promise<SearchResult> {
    return search(query, options, 'cn')
}

/** 搜索国际版（同一站点 + ensearch=1）。 */
export function searchByInternationalBing(
    query: string,
    options?: SearchOptions
): Promise<SearchResult> {
    return search(query, options, 'international')
}
