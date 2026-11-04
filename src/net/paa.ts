import type { Session } from './session.ts'
import { parsePaaAnswer } from '../parse/paa-answer.ts'
import type { RelatedQuestion } from '../parse/questions.ts'
import { paaAnswerUrl } from '../protocol.ts'

interface PaaLoadOptions {
    ig: string
    referer: string
    /** 页面脚本里的 Feed，缺省 urlpostwebzhchs */
    feed?: string
    /** 页面脚本里的 Language，缺省 zh_chs */
    language?: string
    /** 并发上限（默认 3） */
    concurrency?: number
    /** 单条超时（默认 6s） */
    timeoutMs?: number
}

const DEFAULT_FEED = 'urlpostwebzhchs'
const DEFAULT_LANGUAGE = 'zh_chs'
const DEFAULT_CONCURRENCY = 3
const DEFAULT_TIMEOUT = 6000

/** 加载 PAA 答案正文；失败只丢 answer/citations，不影响问题列表。 */
export async function loadRelatedAnswers(
    session: Session,
    questions: RelatedQuestion[],
    options: PaaLoadOptions
): Promise<RelatedQuestion[]> {
    if (questions.length === 0) return questions

    const results = questions.slice()
    const jobs = questions
        .map((question, index) => ({ question, index }))
        .filter(job => Boolean(job.question.sourceUrl))
    if (jobs.length === 0) return results

    const feed = options.feed || DEFAULT_FEED
    const language = options.language || DEFAULT_LANGUAGE
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
    let cursor = 0

    const worker = async (): Promise<void> => {
        while (cursor < jobs.length) {
            const job = jobs[cursor++]
            const question = job.question
            try {
                const res = await session.request(
                    paaAnswerUrl(options.ig, job.index + 1),
                    {
                        method: 'POST',
                        headers: {
                            'content-type':
                                'application/x-www-form-urlencoded',
                        },
                        body: JSON.stringify({
                            Question: question.question,
                            Feed: feed,
                            Language: language,
                            Url: question.sourceUrl,
                        }),
                        referer: options.referer,
                        timeoutMs,
                    }
                )
                if (res.status !== 200) continue

                const parsed = parsePaaAnswer(res.body)
                if (parsed.answer || parsed.citations)
                    results[job.index] = { ...question, ...parsed }
            } catch {
                /* 附加能力：失败保留问题与来源 URL */
            }
        }
    }

    const n = Math.max(
        1,
        Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, jobs.length)
    )
    await Promise.all(Array.from({ length: n }, () => worker()))
    return results
}
