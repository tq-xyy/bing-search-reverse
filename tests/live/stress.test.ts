/**
 * 全量压测（原 scripts/regression/stress-bing.ts，2026-10-24 并入默认测试）
 *
 * 判定：只统计**失败率**——能拿到条目 = 请求层正常；抛错 = 请求失败（重试耗尽）；
 * 0 条 = 引擎未返回 b_algo。不做可信度断言：pages 就是 Bing 的返回。
 *
 * 注意失败语义：searchByBing 失败时**抛错**，不返回空结果。所以这里必须
 * 捕获异常并保留原文——否则一次网络抖动会直接让整个 it 崩掉，看不出是哪种失败。
 *
 * ⚠️ 必须写成单个 it 内部并发：
 *    node --test 默认**串行**跑用例，24 个 it = 24 次串行 ≈ 20s+；
 *    内部 Promise.all 并发实测 **3.6s**（2026-10-24）。
 *
 * 词表覆盖：技术 / 中文长尾 / 边界（含曾被误判为 garbage 的「民族团结法」）。
 */
import assert from 'node:assert/strict'
import { it } from 'node:test'

import { searchByBing } from '../../src/index.ts'

/** 24 词：历史降级词 + 正常词 + 边界词 */
const WORDS = [
    'Redis 持久化 RDB AOF 原理',
    'Redis 分布式锁 Redisson 实现',
    'Go 泛型 约束 类型参数',
    'Go 微服务 架构 设计 实践',
    'Vue Router 路由 守卫 原理',
    'Docker Compose 编排 部署',
    'TypeScript 装饰器 实现 原理',
    'Kubernetes Pod 调度 原理',
    'Python 装饰器 闭包 原理',
    'React Hooks 原理 实现',
    'MySQL 事务 隔离级别 实现',
    'Nginx 反向代理 负载均衡 配置',
    '消息队列 Kafka 原理 架构',
    '微服务 分布式 事务 解决方案',
    'JVM 垃圾回收 算法 原理',
    '分布式 一致性 算法 Raft 原理',
    'Elasticsearch 倒排索引 原理',
    'Spring Boot 自动配置 原理',
    'WebSocket 长连接 心跳 机制',
    '打铁花 非遗 起源 传承',
    '圆锥曲线 椭圆 标准方程 离心率',
    '通货膨胀 成因 需求拉动 成本推动',
    '七天无理由退货 适用条件',
    'Vue SSR Nuxt.js',
] as const

it('24 词压测：零失败零空结果', { timeout: 180_000 }, async () => {
    const t0 = Date.now()
    const results: { q: string; n: number; error?: string }[] = []

    // 并发 6 而不是 24：实测（2026-10-24，多轮）
    //   并发  8 → 多数 0 空结果，但在刚跑完其他在线测试时会冒 5~8 个
    //   并发 12 → 0~14 个（不稳定，触发限流）
    //   并发 16/24 → 7~14 个
    // 用 worker pool 限流，既保住并行又避开风控。
    const CONCURRENCY = 6
    let next = 0
    type Outcome = { q: string; n: number; error?: string }
    /**
     * 一次查询：成功记条数，失败记错误原文。
     * 必须 catch——失败语义是抛错，吞不掉就会让整个 it 崩在第一处抖动上。
     */
    const run = async (q: string): Promise<Outcome> => {
        try {
            const r = await searchByBing(q)
            return { q, n: r.pages.length }
        } catch (e) {
            return { q, n: 0, error: (e as Error).message }
        }
    }
    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            while (next < WORDS.length) {
                results.push(await run(WORDS[next++]!))
            }
        })
    )

    // 空结果可能是并发限流（服务端行为），不一定是代码缺陷。
    // 串行重试一次：仍空才说明请求层真的坏了。
    // 这是本项目「无区分度基线」纪律的直接应用——不能拿噪声当信号。
    const retried: Outcome[] = []
    for (const x of results.filter(v => v.n === 0))
        retried.push(await run(x.q))
    const durMs = Date.now() - t0

    // 先看「抛错」：这才是请求层真的失败，空 pages 另有含义
    assert.deepEqual(
        retried.filter(x => x.error).map(x => x.q + ': ' + x.error),
        [],
        '串行重试后仍抛错 = 请求层失败（非并发限流）'
    )
    const stillEmpty = retried.filter(x => x.n === 0)
    assert.deepEqual(
        stillEmpty.map(x => x.q),
        [],
        '串行重试后仍空 = 请求层失败（非并发限流）；' +
            '平均耗时 ' +
            Math.round(durMs / WORDS.length) +
            'ms/词'
    )
    assert.equal(results.length, WORDS.length, '有词没跑到')
    // 重试比例过高说明并发仍然超标（>40% 需要重新调 CONCURRENCY）
    assert.ok(
        retried.length <= WORDS.length * 0.4,
        retried.length +
            '/' +
            WORDS.length +
            ' 个词需要重试：CONCURRENCY=' +
            CONCURRENCY +
            ' 可能仍偏高'
    )
})
