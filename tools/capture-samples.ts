/**
 * 抓取真实响应样本，保存到 tests/fixtures/samples/cards3/
 *
 * 为什么需要它：离线测试只能覆盖已固化的页面形态；Bing 的组件（PAA、
 * b_rcGbMod、b_richcard、b_imgcap_img）随查询/版本出现，必须先把样本抓下来，
 * 才能写稳定的回归断言。
 *
 * 请求形态与生产一致：不带 first；首遍不是填充页时再走 rdr 第二遍；
 * cookie 由 session 保管，不在这里手工传递。
 *
 * 用法:
 *   npx tsx tools/capture-samples.ts [query...]
 *   npx tsx tools/capture-samples.ts --paa   # 同时保存 PAA 答案响应
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { getSession } from '../src/net/session.ts'
import { assertOk } from '../src/net/errors.ts'
import { all, parse } from '../src/parse/dom.ts'
import { CN_BING_ORIGIN, IG_RE, rdrUrl, searchUrl } from '../src/protocol.ts'

const DEFAULT_QUERIES = [
    'VCP',
    '父母欠薪345万捧女儿出道',
    '决策模型',
    '决策树算法',
    '苏轼',
    '什么是向量数据库',
    'Redis 持久化 RDB AOF 原理',
    '北京天气',
    '美元 人民币 汇率',
]

const SAVE_PAA = process.argv.includes('--paa')
const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const queries = args.length > 0 ? args : DEFAULT_QUERIES

const OUT_DIR = 'tests/fixtures/samples/cards3'
const PAA_DIR = 'tests/fixtures/samples/paa'
mkdirSync(OUT_DIR, { recursive: true })
if (SAVE_PAA) mkdirSync(PAA_DIR, { recursive: true })

function slugOf(query: string): string {
    return query.replace(/[\\/:*?"<>|]/g, '_')
}

function randomCvid(): string {
    return Array.from(
        { length: 32 },
        () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]
    ).join('')
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

const session = await getSession()

async function capture(query: string): Promise<void> {
    // URL 形态与生产完全一致：直接复用 protocol 的构造函数，
    // 不在这里抄一份（旧版抄的那份会把 first 参数之类的问题挡在测试之外）
    const url = searchUrl(query, randomCvid())

    const first = await session.request(url, {
        referer: CN_BING_ORIGIN + '/',
    })
    let { status, body } = first
    const firstSize = body.length

    const ig = IG_RE.exec(body)?.[1] ?? session.ig
    if (status === 200 && body.length < 200_000 && ig) {
        try {
            const second = await session.request(rdrUrl(url, ig), {
                referer: url,
            })
            if (second.status === 200 && second.body.length > body.length) {
                status = second.status
                body = second.body
            }
        } catch {
            /* 保留首遍 */
        }
    }
    assertOk(status)

    const doc = parse(body)
    const counts = {
        algo: all('#b_results li.b_algo, .b_results_eml li.b_algo', doc)
            .length,
        video: all('li.b_vidAns', doc).length,
        news: all('a.nscjk_card_link, a.nscard_link', doc).length,
        images: all('li.b_imgansacf', doc).length,
        paa: all('#df_listaa', doc).length,
        rcGbMod: all('.b_rcGbMod', doc).length,
        richcard: all('.b_richcard', doc).length,
        imgcap: all('.b_imgcap_img', doc).length,
        deeplinks: all('.b_vtl_deeplinks', doc).length,
        favicon: all('.cico.siteicon .rms_iac[data-src]', doc).length,
    }

    const file = OUT_DIR + '/' + slugOf(query) + '.html'
    writeFileSync(file, body, 'utf8')
    console.log(
        query.padEnd(24) +
            ' ' +
            firstSize +
            '→' +
            body.length +
            ' ' +
            JSON.stringify(counts) +
            ' → ' +
            file
    )

    // 可选：保存第一条 PAA 答案响应（供 parsePaaAnswer 离线测试）
    if (SAVE_PAA && counts.paa > 0) {
        const qm =
            /class="acf-accn-itm__hdr-label"[^>]*>([\s\S]*?)<\/span>/.exec(
                body
            )
        const um = /class="b_paa_ansContainer"[^>]*data-url="([^"]+)"/.exec(
            body
        )
        const question = qm ? qm[1].replace(/<[^>]+>/g, '').trim() : ''
        const sourceUrl = um ? um[1].replace(/&amp;/g, '&') : ''
        if (ig && question && sourceUrl) {
            const feed =
                /AnswerFetcher\([^,]+,\s*"([^"]+)"/.exec(body)?.[1] ??
                'urlpostwebzhchs'
            const language =
                /AnswerFetcher\([^,]+,\s*"[^"]+",\s*"([^"]+)"/.exec(
                    body
                )?.[1] ?? 'zh_chs'
            const api =
                'https://cn.bing.com/getanswerforclickedquestion?IG=' +
                ig +
                '&IID=RelatedQnA-QnAAlsoAsk&SFX=1'
            try {
                const ans = await session.request(api, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                    },
                    body: JSON.stringify({
                        Question: question,
                        Feed: feed,
                        Language: language,
                        Url: sourceUrl,
                    }),
                    referer: url,
                    timeoutMs: 6000,
                })
                if (ans.status === 200) {
                    const paafile = PAA_DIR + '/' + slugOf(query) + '.html'
                    writeFileSync(paafile, ans.body, 'utf8')
                    console.log('    PAA answer → ' + paafile)
                }
            } catch {
                console.log('    PAA answer 抓取失败（可选步骤）')
            }
        }
    }
}

for (const q of queries) {
    try {
        await capture(q)
    } catch (e) {
        console.log(q + ' 抓取失败: ' + String(e).slice(0, 160))
    }
    await wait(1000)
}
