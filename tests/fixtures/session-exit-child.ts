/**
 * 「进程自然退出」的被观测子进程（不匹配 *.test.ts，不会被测试发现）
 *
 * 只做一件事：跑一次真实搜索，然后什么都不做。
 * 故意不调 invalidateSession() / closeBrowser() —— 这正是要证明的事：
 * 空闲的 HTTP/2 连接已 unref，不会把进程按在事件循环里。
 *
 * 由 tests/live/connection.test.ts 的 spawnSync 启动。
 */
import { searchByBing } from '../../src/index.ts'

const r = await searchByBing('Redis 持久化')
console.log('pages=' + r.pages.length)
// 不关闭任何东西，让进程自己退出
