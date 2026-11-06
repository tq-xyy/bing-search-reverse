/**
 * 在线契约测试（node --test，依赖网络）。
 *
 * 与 parsers.test.ts 分工：
 *   · 离线测解析正确性（真实 HTML 样本，稳定可复现）
 *   · 在线测端到端契约（真实请求，验证字段真的被生产代码填上）
 *
 * 2026-10-27 契约：pages 是 page/pdf/video/news 的联合数组
 * （pdf = Bing 打了 `[PDF]` 标记的文档型主结果）；
 * overview / relatedQuestions / relatedSearches 在顶层；images 也在顶层。
 *
 * 每个 query 在 before 里预热两次（默认选项 / 三个开关全开），之后所有断言
 * 都读缓存，不再打 Bing。两次取法缺一不可：
 *   · 默认选项 —— 验证「该裁的都裁掉了」，也验证默认形态；
 *   · 三个开关全开 —— 验证被裁掉的素材确实**能**被拿到。只测默认的话，
 *     video / images / richContents 三条断言永远拿不到样本，只会恒 skip，
 *     那是把「跳过」当「通过」的假绿。
 *
 * ⚠️ 两份结果**不逐条比对**：它们是两次独立请求，Bing 的排位灰度实验会让
 * 同词在相邻请求间换序（见 request-shape.test.ts 文件头）。跨请求只断言
 * 各自内部自洽的东西。
 *
 * 卡片缺失时以 skip 呈现，而不是「测试列表随响应变化」。
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { searchByBing } from '../../src/index.ts'
import type { SearchResult } from '../../src/index.ts'

const ALLOWED_KEYS = new Set([
    'entrance',
    'elapsedMs',
    'pages',
    'overview',
    'relatedQuestions',
    'relatedSearches',
    'images',
    'correct',
])

const QUERIES = ['经济应用数学基础', '洛天依', 'Redis 持久化 RDB AOF 原理']

describe('在线端到端契约', () => {
    /** 默认选项：每个 query 只跑一次真实请求，各断言共享 */
    const results = new Map<string, SearchResult>()
    /** 三个开关全开：素材类断言只用这一份，覆盖 page.richContents / video / images */
    const full = new Map<string, SearchResult>()

    before(
        async () => {
            for (const q of QUERIES) {
                results.set(q, await searchByBing(q))
                full.set(
                    q,
                    await searchByBing(q, {
                        includeRichContents: true,
                        includeImages: true,
                        includeVideos: true,
                    })
                )
            }
        },
        { timeout: 180_000 }
    )

    describe('1. 契约形状', () => {
        for (const q of QUERIES) {
            const short = q.slice(0, 12)

            it('顶层字段都在白名单内 ' + short, () => {
                const unknown = Object.keys(results.get(q)!).filter(
                    k => !ALLOWED_KEYS.has(k)
                )
                assert.deepEqual(unknown, [], '多余字段')
            })

            it('pages 是数组 ' + short, () => {
                assert.ok(Array.isArray(results.get(q)!.pages))
            })

            it('relatedSearches 是数组 ' + short, () => {
                assert.ok(Array.isArray(results.get(q)!.relatedSearches))
            })

            it('relatedQuestions 是数组 ' + short, () => {
                assert.ok(Array.isArray(results.get(q)!.relatedQuestions))
            })

            it('pages 条目结构合法 ' + short, () => {
                const bad = results
                    .get(q)!
                    .pages.filter(
                        p =>
                            !['page', 'pdf', 'video', 'news'].includes(
                                p.type
                            ) ||
                            typeof p.title !== 'string' ||
                            typeof p.url !== 'string'
                    )
                assert.deepEqual(bad, [])
            })

            it('默认不返回素材 / 图片卡 / 视频卡 ' + short, () => {
                const r = results.get(q)!
                assert.deepEqual(
                    r.pages.filter(p => p.richContents != null),
                    [],
                    '默认应剥离 richContents'
                )
                assert.equal(r.images, undefined, '默认不返回图片卡')
                assert.deepEqual(
                    r.pages.filter(p => p.type === 'video'),
                    [],
                    '默认不返回视频卡'
                )
            })

            it('entrance 与 elapsedMs 合法 ' + short, () => {
                const r = results.get(q)!
                assert.ok(
                    r.entrance === 'cn' || r.entrance === 'international',
                    '非法 entrance: ' + r.entrance
                )
                assert.equal(typeof r.elapsedMs, 'number')
                assert.ok(r.elapsedMs >= 0 && Number.isFinite(r.elapsedMs))
            })

            it('relatedQuestions 条目合法 ' + short, () => {
                const bad = results
                    .get(q)!
                    .relatedQuestions.filter(
                        x =>
                            typeof x.question !== 'string' ||
                            !x.question ||
                            (x.answer !== undefined &&
                                typeof x.answer !== 'string')
                    )
                assert.deepEqual(bad, [])
            })

            // 已退役字段不得回归
            it('无 bingStatus ' + short, () => {
                assert.ok(!('bingStatus' in results.get(q)!))
            })

            it('无 fallbackQuery ' + short, () => {
                assert.ok(!('fallbackQuery' in results.get(q)!))
            })

            it('无旧版卡片顶层字段 ' + short, () => {
                for (const key of ['videos', 'inlineVideos', 'news'])
                    assert.ok(!(key in results.get(q)!), key + ' 不该在顶层')
            })
        }
    })

    describe('2. 高覆盖率能力（相关搜索 ~100%）', () => {
        it('相关搜索覆盖率应 >=2/3', () => {
            const hits = QUERIES.filter(
                q => results.get(q)!.relatedSearches.length > 0
            )
            assert.ok(
                hits.length >= 2,
                hits.length +
                    '/3 命中：' +
                    QUERIES.map(
                        q => q + '=' + results.get(q)!.relatedSearches.length
                    ).join(', ')
            )
        })
    })

    describe('3. 卡片字段形状（存在即必须合法，不要求必然存在）', () => {
        for (const q of QUERIES) {
            const short = q.slice(0, 8)

            it('video 条目合法 ' + short, t => {
                const list = full.get(q)!.pages.filter(p => p.type === 'video')
                if (list.length === 0)
                    return t.skip('该结果无视频卡（开关已开，确实是 0 条）')
                const bad = list.filter(
                    x => !x.title || !/^https?:\/\//.test(x.url)
                )
                assert.deepEqual(bad, [])
            })

            it('内嵌视频合法 ' + short, t => {
                // 内嵌视频归在 richContents 下，跟着 includeRichContents 走
                // （不受 includeVideos 影响），所以这里取全开的那份
                const list = full
                    .get(q)!
                    .pages.filter(
                        p =>
                            p.type === 'page' &&
                            p.richContents?.video !== undefined
                    )
                if (list.length === 0)
                    return t.skip('该结果无内嵌视频（开关已开，确实没有）')
                const bad = list.filter(
                    p =>
                        p.type === 'page' &&
                        p.richContents?.video !== undefined &&
                        !/^https?:\/\//.test(p.richContents.video.url)
                )
                assert.deepEqual(bad, [])
            })

            it('pdf 条目合法 ' + short, t => {
                const list = results
                    .get(q)!
                    .pages.filter(p => p.type === 'pdf')
                if (list.length === 0) return t.skip('该结果无文档型条目')
                const bad = list.filter(
                    x =>
                        !x.title ||
                        !/^https?:\/\//.test(x.url) ||
                        // 标记文本不得混进标题
                        /\[PDF\]/.test(x.title)
                )
                assert.deepEqual(bad, [])
            })

            it('news 条目合法 ' + short, t => {
                const list = results
                    .get(q)!
                    .pages.filter(p => p.type === 'news')
                if (list.length === 0) return t.skip('该结果无资讯卡')
                const bad = list.filter(x => !x.title || !x.url)
                assert.deepEqual(bad, [])
            })

            it('images 条目合法 ' + short, t => {
                const img = full.get(q)!.images
                if (!img) return t.skip('该结果无图片卡（开关已开，确实没有）')
                assert.ok(img.items.length > 0)
                const bad = img.items.filter(
                    i => !/^https?:\/\//.test(i.thumbnailUrl)
                )
                assert.deepEqual(bad, [])
            })

            it('全开时素材字段形状合法 ' + short, t => {
                const rich = full
                    .get(q)!
                    .pages.filter(p => p.richContents != null)
                if (rich.length === 0)
                    return t.skip('该结果无任何素材（开关已开，确实没有）')
                for (const p of rich) {
                    const rc = p.richContents!
                    if (rc.favicon !== undefined)
                        assert.match(rc.favicon, /^https?:\/\//, 'favicon')
                    // 只有网页型（page / pdf）有 links；用 in 收窄联合类型
                    if (!('links' in rc)) continue
                    for (const l of rc.links ?? [])
                        assert.match(l.url, /^https?:\/\//, 'links.url')
                }
            })

            it('overview 结构合法 ' + short, t => {
                const o = results.get(q)!.overview
                if (!o) return t.skip('该结果无答案摘要')
                assert.equal(typeof o.title, 'string')
                assert.ok(o.kind === 'cht' || o.kind === 'gs')
                assert.ok(Array.isArray(o.paragraphs))
            })
        }
    })

    describe('4. 边界与历史误判词（删除裁决后必须照常返回）', () => {
        // 「民族团结法」是删除裁决体系的直接起因：曾被 hasFullToken 判 garbage，
        // 而 10 条结果全部相关（Bing 自己用 <strong> 标注了匹配范围）。
        const WORDS = [
            'Go 泛型', // 2 词
            'Redis', // 单分词
            '民族团结法',
            '微服务 分布式 事务 解决方案',
        ]
        for (const q of WORDS) {
            it(
                '照常返回结果：' + q.slice(0, 16),
                { timeout: 40_000 },
                async () => {
                    const r = await searchByBing(q)
                    assert.ok(r.pages.length > 0, '结果为空：' + q)
                    assert.deepEqual(
                        Object.keys(r).filter(k => !ALLOWED_KEYS.has(k)),
                        []
                    )
                }
            )
        }
    })

    describe('5. 连接复用（同一会话内连续请求应显著更快）', () => {
        it('复用后单次查询 < 1.6s', { timeout: 60_000 }, async () => {
            const warm = 'Redis'
            // 第 1 次可能含握手，第 2/3 次应复用连接
            const t: number[] = []
            for (let i = 0; i < 3; i++) {
                const t0 = performance.now()
                await searchByBing(warm)
                t.push(performance.now() - t0)
            }
            const later = Math.min(t[1], t[2])
            assert.ok(
                later < 1600,
                later.toFixed(0) +
                    'ms (' +
                    t.map(x => x.toFixed(0)).join('/') +
                    ')'
            )
        })
    })
})
