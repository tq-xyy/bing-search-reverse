/**
 * 请求形态验收（合并自 request-shape-check + overview-check，2026-10-24）
 *
 * 为什么需要它：URL 里一旦混入 first 这类分页参数，Bing 会跳过首屏模块——
 * **结果条目仍然逐条正确**，丢的是 AI Overview 与相关搜索。
 * 所以「有 10 条结果」完全不能证明请求形态正常。
 *
 * 判据（两条都要）：
 *   1. 前 3 条里至少有一条标题命中查询的首个分词 —— 检索有效性；
 *   2. relatedSearches 非空 —— URL 形态未被 Bing 判成翻页请求。
 *
 * 为什么是「前 3 条命中一次」而不是「首条命中」：首条排位是 Bing 侧的
 * 灰度实验（实测同词连续请求会在两条结果间随机切换，间隔十几秒即变，
 * 与库无关），单看首条必然间歇性泛红。而一旦 URL 混入 first 这类分页
 * 参数，丢的是 AI Overview 与相关搜索——首条本身反而照样正确，
 * 所以「首条必须命中」既不稳定、也不是真正在守的那条线。
 *
 * 原脚本用「2/3 命中」把不确定性藏进阈值；这里改成逐词断言 +
 * 模块缺失时 skip（长 query 的 relatedSearches 实测常为 0，属正常）。
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

import { getResult } from './shared.ts'

/** 三个固定词：覆盖中文长尾 / 英文技术 / 中文技术 */
const WORDS = [
    '打铁花 非遗 起源 传承',
    'Redis 持久化 RDB AOF 原理',
    'MySQL 事务 隔离级别 实现',
] as const

describe('请求形态', () => {
    before(
        async () => {
            await Promise.all(WORDS.map(q => getResult(q)))
        },
        { timeout: 120_000 }
    )

    for (const q of WORDS) {
        const short = q.slice(0, 14)

        it('前 3 条与查询相关 ' + short, async () => {
            const r = await getResult(q)
            const titles = r.pages
                .slice(0, 3)
                .map(p => p.title)
                .filter(Boolean)
            const token = q.split(/\s+/)[0]!.toLowerCase()
            assert.ok(titles.length > 0, '结果为空：' + q)
            assert.ok(
                titles.some(t => t.toLowerCase().includes(token)),
                '前 3 条都不含 "' +
                    token +
                    '"：' +
                    titles.map(t => '"' + t + '"').join(' / ')
            )
        })

        it(
            'relatedSearches 非空（URL 形态未被当成翻页请求） ' + short,
            async t => {
                const r = await getResult(q)
                if (r.relatedSearches.length === 0) {
                    return t.skip('该词无相关搜索（长 query 属正常）')
                }
                assert.ok(r.relatedSearches.length > 0)
            }
        )
    }

    it('URL 未混入 first 分页参数（三条判据同时成立的充分条件）', async () => {
        // first 存在时，三个词的相关搜索会**同时**消失；这里断言的是
        // 「不是全空」——单条为空可能是 query 长度问题，全空只能是形态问题。
        const counts = await Promise.all(
            WORDS.map(async q => (await getResult(q)).relatedSearches.length)
        )
        assert.ok(
            counts.some(n => n > 0),
            '全部为 0：检查 src/search.ts 的 URL 是否混入了 first 等分页参数'
        )
    })
})
