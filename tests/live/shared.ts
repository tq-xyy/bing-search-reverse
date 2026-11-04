/**
 * 在线测试的共享查询池与结果缓存。
 *
 * 为什么要共享：Bing 对短时间内的重复查询会降级，且每次请求 150~600ms。
 * 全部在线测试文件共用一个「查询 → 结果」缓存，保证：
 *   · 同一个词在整轮测试里只请求一次；
 *   · 各断言看到的是同一份快照（不会出现「第 3 条断言时服务端改版了」）。
 *
 * ⚠️ 这是**进程内**缓存：node --test 每个文件独立进程，
 * 所以跨文件仍然各请求各的（实测总耗时仍在 10s 级，可接受）。
 */
import { searchByBing } from '../../src/index.ts'
import type { SearchResult } from '../../src/index.ts'

const cache = new Map<string, SearchResult>()

/** 取一个词的结果（同进程内只真实请求一次） */
export async function getResult(query: string): Promise<SearchResult> {
    const hit = cache.get(query)
    if (hit) return hit
    const r = await searchByBing(query)
    cache.set(query, r)
    return r
}

/** 批量预热（before 钩子里用，避免每个 it 各自等待） */
export async function warm(queries: readonly string[]): Promise<void> {
    await Promise.all(queries.map(q => getResult(q)))
}

/** 通用词池：覆盖技术/长尾/中文/边界 */
export const POOL = [
    'Redis 持久化 RDB AOF 原理',
    'Go 泛型 约束 类型参数',
    'Vue Router 路由 守卫 原理',
    'Docker Compose 编排 部署',
    'TypeScript 装饰器 实现 原理',
    'Kubernetes Pod 调度 原理',
    'React Hooks 原理 实现',
    'MySQL 事务 隔离级别 实现',
    'JVM 垃圾回收 算法 原理',
    '消息队列 Kafka 原理 架构',
    '微服务 分布式 事务 解决方案',
    '分布式 一致性 算法 Raft 原理',
    'Elasticsearch 倒排索引 原理',
    'Spring Boot 自动配置 原理',
    'WebSocket 长连接 心跳 机制',
    '打铁花 非遗 起源 传承',
    '圆锥曲线 椭圆 标准方程 离心率',
    '通货膨胀 成因 需求拉动 成本推动',
    '七天无理由退货 适用条件',
    'Vue SSR Nuxt.js',
    'Redis 分布式锁 Redisson 实现',
    'Go 微服务 架构 设计 实践',
    'Python 装饰器 闭包 原理',
    'Nginx 反向代理 负载均衡 配置',
] as const
