/**
 * 会话层验收（原「连接层」，2026-10-24 换 fetch 后重写）
 *
 * 两条不变量：
 *   1. 并发查询只做 1 次首页握手（session 的 single-flight）；
 *   2. 不调任何关闭函数时，进程也必须能自然退出。
 *
 * ⚠️ 实现要点（踩过）：
 *   · globalThis.fetch 的 patch 必须在 **动态 import 生产模块之前**完成。
 *     写成顶层静态 import，ESM 会把它提升到 patch 之前，patch 失效 →
 *     计数永远 0 → 测试假装通过。
 *   · 子进程不能靠 process.argv 传标志（node --test 下 argv 为空，实测），
 *     改成独立 fixture 文件 + 环境变量。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import { describe, it } from 'node:test'

describe('会话层', () => {
    it(
        '并发查询只握手 1 次（single-flight）',
        { timeout: 120_000 },
        async () => {
            const original = globalThis.fetch
            let handshakes = 0
            globalThis.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : String(input)
                if (url === 'https://cn.bing.com/') handshakes++
                return original(input, init)
            } as typeof fetch

            const WORDS = [
                'Redis 持久化 RDB AOF 原理',
                '民族团结法',
                '决策模型 API',
            ]
            try {
                // 必须动态 import：静态 import 会被提升到 patch 之前
                const { searchByBing } = await import('../../src/index.ts')
                const results = await Promise.all(
                    WORDS.map(q => searchByBing(q))
                )
                for (const r of results) {
                    assert.ok(r.pages.length > 0, '并发查询应拿到结果')
                }
            } finally {
                globalThis.fetch = original
            }

            assert.equal(
                handshakes,
                1,
                handshakes +
                    ' 次首页握手 / ' +
                    WORDS.length +
                    ' 次并发查询：single-flight 失效'
            )
        }
    )

    it('不调关闭函数时进程自然退出', { timeout: 120_000 }, () => {
        const fixture = path.resolve(
            import.meta.dirname,
            '../fixtures/session-exit-child.ts'
        )
        const t0 = Date.now()
        const r = spawnSync(process.execPath, ['--import', 'tsx', fixture], {
            encoding: 'utf8',
            timeout: 90_000,
            env: { ...process.env, SESSION_EXIT_CHILD: '1' },
        })
        const elapsed = Date.now() - t0

        assert.equal(
            r.status,
            0,
            '子进程未自然退出（exit=' +
                r.status +
                ' ' +
                elapsed +
                'ms）\n' +
                (r.stderr ?? '').slice(0, 500)
        )
        // 顺带确认它是真的「搜完就退」，不是启动就崩
        assert.match(r.stdout ?? '', /pages=\d+/, '子进程没有完成搜索')
    })
})
