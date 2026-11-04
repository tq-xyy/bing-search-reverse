# 决策：用全局 fetch 替换手写 HTTP/2 传输层

## 结论

`src/transport.ts`（320 行）与 `src/session.ts` 的连接持有部分整体删除，
改为**全局 `fetch` + `tough-cookie` 的 `CookieJar`**：

|            | 旧                                      | 新                                     |
| ---------- | --------------------------------------- | -------------------------------------- |
| 传输       | 手写 `http2.connect` + `client.request` | 全局 `fetch`（undici 8，ALPN 协商 h2） |
| 解压       | 自己 `gunzip/brotli/inflate`            | undici 内置                            |
| 超时       | 自己 `setTimeout` + 手动 settle         | `AbortSignal.timeout()`                |
| Set-Cookie | 自己攒数组 + 字符串拼 jar               | `headers.getSetCookie()` + `CookieJar` |
| 进程退出   | `WeakMap` 记账 ref/unref                | 无需处理（连接归 undici 池）           |
| 状态码判定 | 白名单 + 挑战页识别 + 两档重试          | 白名单（只有 200 算成功）              |

净效果：删除约 490 行，新增约 340 行（含 jar 与拟态），
`dist/bing.js` 46KB → 43KB；`tough-cookie` 成为第三个运行期依赖。

## 为什么（实测，Node 26.7 / undici 8.9 / 2026-10-24）

同一份 cookie、同一套请求头、同一个 URL，只换传输实现：

|                                 | 手写 http2    | 全局 fetch      |
| ------------------------------- | ------------- | --------------- |
| 搜索页（冷）                    | 461ms / 354KB | 639ms / 361KB   |
| 搜索页（热）                    | 417ms         | **361ms**       |
| 8 词并发                        | 1298ms        | **968ms**       |
| 8 并发全部填充页                | ✅            | ✅（381~484KB） |
| `b_ans` / `b_algo` / `paa` 模块 | 全在          | 全在            |
| 服务器 ALPN                     | h2            | h2              |

**填充页命中率与模块完整度完全相同**——决定这些的是 `sec-ms-gec` 与 cookie
拟态，两者都在请求头里，与传输实现无关。

其余能力对照：

| 能力                          | 手写 http2          | fetch                                           |
| ----------------------------- | ------------------- | ----------------------------------------------- |
| 收集多条 Set-Cookie           | 自己攒              | `headers.getSetCookie()`（实测 12 条/5 条都对） |
| 解压 br/gzip/deflate          | 自己写              | 内置（手动设 `accept-encoding: br` 也能自动解） |
| 超时                          | 自己写              | `AbortSignal.timeout()`                         |
| 进程自然退出                  | 需要 ref/unref 记账 | 无需处理（实测 `exit=0`，0.6s）                 |
| 发 `sec-fetch-mode: navigate` | 可以                | **不行**，被强制成 `cors`                       |
| 并发不放大连接数              | ✅ 单连接多路复用   | ❌ 默认每并发一条连接                           |

## 被放弃的两项

### 1. `sec-fetch-mode: navigate`

真实浏览器导航请求发 `sec-fetch-mode: navigate`，fetch 只能发 `cors`
（`sec-fetch-site`/`sec-fetch-user`/`sec-fetch-dest` 可以覆盖，只有 mode 不能）。
实测带 `cors` 的 8 个词全拿到填充页，**没有观测到影响**。若要恢复，
只能换回 `http2` 或用自定义 dispatcher。

### 2. 单连接多路复用

fetch 8 并发建了 8 条连接。对本库的压测形态（`Promise.all(词表)`）意味着
连接数 = 并发数。这是"礼貌性"损失而非正确性损失；需要时可换
`undici.Agent({ allowH2: true, connections: 1 })` 作为 dispatcher 找回，
但那会把 undici 从"Node 内置实现"变成显式依赖。

## 不采用的替代

| 方案                                                | 否决理由                                                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 保留 http2，只砍到骨架                              | 仍要自己维护解压/超时/set-cookie，等于继续重写 undici                                                                                         |
| `fetch-cookie` 包装层                               | 实测同一 jar 下并发三个词拿到 101/101/99KB 骨架，而裸 fetch 传 cookie 串是 371~384KB 填充。竞态原因未隔离验证，但足够说明**jar 应归我们持有** |
| `p-retry` 代替手写重试                              | 语义对得上（`AbortError` → 立即终止），但重试循环里还嵌着 `invalidateSession()`，逻辑量没减少                                                 |
| 用 `@exhumer/undici-cookie-agent` 之类 agent 级 jar | 引入 dispatcher 层，比"每次请求现取 cookie 串"更难观测；且我们要在两次请求之间**改写** `SRCHHPGUSR`                                           |

## 换 jar 踩到的坑（已处理）

`CookieJar` 按 `(name, domain, path)` 判重。写回 `SRCHHPGUSR` 时若不带原
cookie 的 Domain/Path：

```
jar 里出现 2 条同名 cookie
getCookieString() 返回旧的那条 → 值停在 "SRCHLANG=zh-Hans"
→ HVE 根本没发出去 → 填充页变骨架页
```

`mergeSrchhpgusr` 现在从 `jar.getCookies()` 读回原 cookie 的 domain/path 再写。
这是换 jar 唯一的真实坑（旧的字符串拼接天然"同名替换"，不存在此问题）。

## 验证

```bash
pnpm test    # 类型 + 离线 210 项 + 在线 48 项（13 skip），全绿
pnpm build   # dist/bing.js 43KB
```

三条端到端实测（换传输后）：

- 单次查询：10 pages + overview(cht) + PAA 4/4 有答案 + relatedSearches 8，589~1249ms
- 8 词并发：全部填充页
- 进程退出：不调任何关闭函数，`exit=0`

## 相关

- [h2-session-lifecycle.md](h2-session-lifecycle.md)：被本决策取代的 ref/unref 记账（历史证据保留）
- [no-session-ttl.md](no-session-ttl.md)：为什么仍然没有 TTL
