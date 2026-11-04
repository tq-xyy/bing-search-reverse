# 决策：空闲连接 unref，下游不需要手动关闭连接

> ⚠️ **已被 [fetch-over-http2.md](fetch-over-http2.md) 取代（2026-10-24）。**
> 传输改用全局 `fetch` 后，连接归 undici 连接池管理，不再有 ref handle，
> 也不存在 unref/ref 记账。下文保留为历史证据（"只 unref 不够"那条反例仍然是
> 关于 Node handle 的正确结论，只是不再适用于本项目的传输层）。

## 结论

HTTP/2 连接的生命周期与进程的生命周期解耦：

| 时刻                   | 引用状态                          |
| ---------------------- | --------------------------------- |
| `connect()` 发起握手   | **ref**（默认，保证握手能完成）   |
| 握手完成、空闲         | **unref**（不阻止进程退出）       |
| `request()` 进行中     | **ref**（响应到达前不被退出打断） |
| 请求结束 / 超时 / 失败 | **unref**                         |

对外只暴露 `invalidateSession()`（销毁当前连接并清空缓存，下一次
`getSession()` 重新建连），它同时是"立即归还 fd"的手段。
**不存在 `closeSession()`**——2026-10 重构已删除，进程退出不再依赖任何
调用方记得关连接。

> 2026-10-18 后续：会话 TTL 与 `retire()` 已删除，连接改为"能用就一直用"。
> 见 [no-session-ttl.md](no-session-ttl.md)。

## 根因

`http2.ClientHttp2Session` 是 **ref 状态的 handle**：只要连接不断，
libuv 的事件循环就排不空，`process` 不退出。旧的 `session.ts` 在进程级
缓存这条连接（为了复用省 245ms/请求），于是：

- CLI：必须在最后显式关闭连接（旧 API），否则命令跑完也不返回；
- 库的下游（chatxt 等）：同样必须记得在退出前调，漏一次就挂住进程，
  而且是**静默**挂住——业务日志早已打完，看起来像"进程卡死"。

2026-09 的 CDP 时代已经踩过同型坑（`child.stdio` 是 ref 的 Socket，
`beforeExit` 永不触发，见 [HISTORY.md](../HISTORY.md)）。

## 证据（Node 26.7 / Windows）

| 场景                                             | 结果                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 建连后保持 ref，不发请求、不关闭                 | 进程 15s 仍未退出（被 SIGTERM 强杀）                                                 |
| 建连后 `unref()`                                 | **296ms 内自然退出**                                                                 |
| `unref()` 后直接发请求并 `await`                 | **进程 316ms 退出**，顶层 await 永不 settle（exit 13 + "unsettled top-level await"） |
| `unref()` → `ref()` → 请求 → `unref()`           | 请求成功（302 / 130B），进程 450ms 退出                                              |
| 生产链路：连续 3 次 `searchByBing`，不调关闭函数 | pages = 10/10/10，进程 3.95s 自然退出                                                |
| 生产链路：`Promise.all` 并发 3 次查询            | pages = 10/9/10，进程 2.18s 自然退出                                                 |

第三行是**最关键的反例**：只 `unref` 不够。unref 之后发起请求，
Node 不会因为"有活跃 stream"而把 socket 重新 ref 住——stream 本身不是
ref 源。若不补 `ref()`，库会在最需要它工作的时候让进程退出。

## 不采用的方案

| 方案                                    | 否决理由                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 每次查询新建连接、用完即关              | 失去连接复用收益（实测 429ms vs 184ms/请求，一次查询省 ~490ms）；且关闭本身要等 GOAWAY，不省时间             |
| 只加空闲超时定时器                      | 定时器若 ref 仍挂住进程；若 unref 又不能保证请求期间存活（见上）。只能作为释放 fd 的补充，替代不了 ref/unref |
| `process.once('beforeExit')` 里自动关闭 | `beforeExit` 只在事件循环空时触发，而 ref 的连接让循环永远不空 → 清理是死代码（2026-09 已证实）              |
| `FinalizationRegistry` / GC 回收        | 时机不确定，不能作为可观测的退出保证                                                                         |
| 维持现状，要求下游显式关闭连接          | 把生命周期责任推给每个调用方；漏调就挂住，且 fail-silent                                                     |

## 实现要点

1. `transport.ts` 用 `WeakMap<H2Connection, number>` 做**进行中请求计数**：
   第一个请求 `ref()`，最后一个结束 `unref()`。计数是必须的——本项目
   一次查询串行发两遍请求，但下游可能 `Promise.all` 并发调用。
2. `connect()` 额外挂一个常驻 `'error'` 空监听。连接级错误（GOAWAY /
   网络中断）若无人监听会变成 `uncaughtException`；请求级错误仍由
   stream 的 `'error'` 上报，不受影响。
3. `session.ts` 在 `establishSession()` 里挂 `once('close')`，连接被对端
   关闭时主动清空缓存，避免下次请求撞上半死连接。
4. 请求的超时 timer（6s）不 `unref`：请求进行中它和 ref 一起保证进程
   存活，结束时 `clearTimeout`，不残留。
5. 会话缓存支持 in-flight Promise（single-flight）：并发首调共用同一次
   建连。建连失败清空缓存（不缓存 rejection）；若 `invalidateSession()`
   在建连途中被调用，会在该 Promise 完成后销毁刚建好的连接。
6. 首页握手（取 Set-Cookie + Salt）也走同一条 HTTP/2 连接，不用全局
   `fetch`：后者会另外建一条 HTTP/1.1 连接（两套协议、两套错误语义），
   且 `fetch` 默认无超时——首页悬挂时 single-flight 的建连 Promise 永不
   settle，所有并发调用者一起卡死。建连/握手任一步失败都会 `destroy()`
   这条连接，不留半死连接等 GC。

## 边界与代价

- `ref()`/`unref()` 是同步的 socket 调用，开销可忽略（不是系统调用）。
- 不改变任何请求形态（URL / 头 / cookie / 请求序列），对 Bing 不可见。
- 进程被 kill 时连接随进程回收，服务端会按自己的超时清理。
- 长驻进程（MCP server）仍可在确定不再搜索时调 `invalidateSession()`
  抢先归还 fd，但这是资源优化，不是正确性要求。

## 验证

```bash
pnpm test            # typecheck + 离线 208 项 + 在线 51 项（13 skip），全绿
pnpm test:live        # connection.test.ts 的「不调关闭函数时进程自然退出」
#   ✅ 不调关闭函数时进程自然退出  exit=0
```

生产链路实测（不调任何关闭函数）：

- 连续 3 次查询：pages = 10/10/10，进程 3.95s 自然退出；
- `Promise.all` 并发 4 次：pages = 10/10/10/10，进程 1.8s 自然退出；
- 退出时 `process.getActiveResourcesInfo()` 只剩 stdout/stderr 的管道。

## 相关

- [ARCHITECTURE.md](../ARCHITECTURE.md) 的"连接生命周期"
- [no-session-ttl.md](no-session-ttl.md)：为什么删掉会话 TTL
- [HISTORY.md](../HISTORY.md)：同型的 ref handle 挂住进程问题
