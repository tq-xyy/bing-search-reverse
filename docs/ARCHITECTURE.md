# 架构

## 数据流

```
searchByBing(query, options?)                 src/index.ts
  │  bingEnterance: 'cn' | 'international'，缺省按时区推测（中国大陆与港澳台 → cn）
  ├─ searchByCnBing / searchByInternationalBing   src/search.ts
  ├─ getSession()                             src/net/session.ts
  │    ├─ Session 构造（CookieJar + origin）
  │    ├─ session.request('https://cn.bing.com/')  → Set-Cookie 进 jar + Salt
  │    ├─ jsCookies()                     → 补齐页面 JS 会写的 cookie
  │    └─ mergeSrchhpgusr(session, salt)  → HVE + 渲染窗口字段
  │
  └─ 重试循环（MAX_ATTEMPTS = 3，只有网络阶段在 try 里）
       ├─ requestPage(query, session, entrance)   src/search.ts
       │    ├─ 第 1 遍：session.request(searchUrl(q, cvid, entrance))
       │    └─ 第 2 遍：session.request(rdrUrl(url, IG))   （首遍非填充页时才发）
       │         URL 由 src/protocol.ts 构造；国际版只是多一个 ensearch=1；
       │         cookie 由 jar 自动带
       ├─ parseSearchPage(html, nowMs)        src/parse/index.ts
       │    ├─ collectContainers(doc)        （#b_results > li / .b_results_eml > li）
       │    ├─ 卡片循环 → pages: WebPage | PdfPage | VideoPage | NewsPage（文档顺序）
       │    └─ 全局字段 → overview / relatedQuestions / relatedSearches
       │                  / images / correct
       ├─ loadRelatedAnswers(questions, session)  src/net/paa.ts
       │    └─ POST /getanswerforclickedquestion（附加能力，失败降级）
       └─ applyResultShape(result, options)   src/shape.ts（出口裁剪）
```

## 分层约束

依赖方向严格单向，**不允许反向 import**：

```
src/index.ts ─→ search.ts ─→ net/{session,errors,paa,gec} ─→ net/headers → utils/ua
     │              │                    │
     │              └────────────────────┴──→ protocol.ts  （零依赖叶子）
     │              ↓
     │        parse/index.ts ─→ parse/{algo,cards,video,overview,questions,correction,rich}
     │              │                    │
     │              └────────────→ parse/{dom,urls} + utils/{time,url,collect}
     └─→ contract.ts（纯类型）· shape.ts（出口裁剪）

protocol.ts  →  （无同项目依赖，只有字符串与纯函数）
```

**没有任何反向依赖**：`net/` 不 import `parse/`，`parse/` 不 import `net/`，
两者的公共事实（站点基址、IG / Salt / AnswerFetcher 正则、搜索与接口 URL）
都放在 `protocol.ts`。历史上 `net/session.ts` 曾为了一个 `IG_RE` 反向依赖
`parse/urls.ts`，那不是「可接受的小例外」，而是常量放错了家。

- **parse/ 是纯函数层**：零 IO、零异步、零 `process.env`，唯一的外部输入是
  `(html, nowMs)`。这让它能在断网环境下被单测直接调用。
- **nowMs 必须从上层注入**，解析层自己不调 `Date.now()`。
  否则相对时间（"6 天之前"）的测试无法确定性断言。
- **出口裁剪不在 parse/ 里**：`shape.ts` 是策略，解析器只负责「能抓到就抓」。

## utils/ · protocol/ · parse/ 的边界

|             | 放什么                                            | 判据                                     |
| ----------- | ------------------------------------------------- | ---------------------------------------- |
| `utils/`    | UA 生成、时间换算、查询参数提取、相对地址绝对化   | **换一个站点也照样能用**                 |
| `protocol/` | 站点基址、页面内联常量正则、搜索与接口 URL        | 是 Bing 的**协议事实**，与 HTML 结构无关 |
| `parse/`    | 选择器、卡片结构、`ck/a` 解码、站内与资产链接补全 | 依赖 Bing 的 **HTML 形态**               |

三个都是叶子（`protocol.ts` 与 `utils/` 不 import 任何同项目模块；
`parse/` 内部向 `dom/urls → utils` 单向）。

**判据的历史教训**：`utils/url.ts` 曾自称「只放与站点无关的逻辑」，
同文件里却定义着 `CN_BING_ORIGIN` / `BING_ASSET_ORIGIN` / `absoluteAssetUrl`——
第一条规则在第一个文件里就被违反了。现在：

- 站点基址与内联常量 → `protocol.ts`（网络层与解析层都要，谁都不该依赖对方）
- 资产 URL 补全 `absoluteAssetUrl` → `parse/urls.ts`（只有解析器用它补 `/th?id=…`）
- `utils/url.ts` 只剩 `isHttpUrl` / `toAbsoluteUrl` / `readQueryParam`

## 传输与会话

传输用**全局 `fetch`**（Node 26 的 undici 8，ALPN 协商即 h2），不再手写 HTTP/2。
理由与实测见 [decisions/fetch-over-http2.md](decisions/fetch-over-http2.md)。

`Session` 持有 `tough-cookie` 的 `CookieJar`：

- **cookie 归 Session**：调方不传不管，`session.request` 每次从 jar 现取
  `Cookie` 头，响应里的 `Set-Cookie` 全部写回 jar（jar 自己处理 Domain/Path/过期）。
- **两遍请求共用同一个 jar**：第一遍响应重新下发的 `SRCHHPGUSR` 会被自动吸收，
  第二遍 `rdr=1` 直接用新 cookie（浏览器也是这样）。
- **写回 `SRCHHPGUSR` 必须复用原 cookie 的 Domain/Path**：jar 按
  (name, domain, path) 判重，换作用域会造出第二条同名 cookie，而
  `getCookieString` 返回**旧的那条**——值停在首页的 `SRCHLANG=zh-Hans`，
  HVE 根本没发出去。这是换用 jar 时唯一的真实坑，`mergeSrchhpgusr` 已处理。

### 为什么下游不需要关闭任何东西

`fetch` 的连接归 undici 的连接池管，**不产生 ref handle**，进程退出时不挂住
（实测：跑完两次请求不做任何清理，`exit=0`，`real 0.599s`）。
所以不存在 `closeSession()`：需要丢弃会话时调 `invalidateSession()`
（清空缓存，下一次 `getSession()` 重新握手）。

缓存里可以放**尚未完成的建连 Promise**（single-flight）：并发首调共用同一次
首页握手，而不是各做一次。建立失败不写缓存，下一次调用重新尝试。

失效处理（3 条路径）：

| 场景                     | 处理                                                            |
| ------------------------ | --------------------------------------------------------------- |
| 请求抛网络错误（含超时） | `searchByBing` 的重试循环调 `invalidateSession()`，下次重新握手 |
| 会话 cookie 老化         | 同上；`invalidateSession()` 后下一次调用重做首页握手            |
| 进程退出                 | **无需处理**（fetch 连接归 undici 池）                          |

> 旧的「HTTP/2 session 是 ref handle，空闲要 unref、请求期间要 ref」那套记账
> 随 `http2` 一起删掉了，历史与证据保留在
> [decisions/h2-session-lifecycle.md](decisions/h2-session-lifecycle.md)。

### 没有 TTL

会话缓存**没有过期时间**：能用就一直用，不能用就重新握手。

旧实现的 `SESSION_TTL_MS = 5min` 已删除，因为：

- 实际部署是短生命周期进程（一次查询 1~2s），5 分钟永远到不了，是死代码；
- 成本确定：每次到期重建要多付一次首页握手（实测约 0.85s）。

代价：若同一进程隔很久再查一次，undici 连接池已老化，首次会多一次
TCP+TLS 握手（约 250ms）。详见 [decisions/no-session-ttl.md](decisions/no-session-ttl.md)。

## 为什么解析层整页只 parse 一次

旧实现的 6 个 extractor 各自用正则扫一遍 400KB 原文，其中 6 个还各自调
`stripNoise` 去 style/script——同一份 HTML 被完整扫描了 6 遍。

现在 `parseSearchPage` 只调一次 `parseDocument`，所有模块共用同一棵 DOM；
结果流容器也只枚举一次（`collectContainers`），再按 class 分给各提取器。
实测总耗时基本持平，**收益在正确性不在速度**：

- 不用自己实现"按标签深度配对"（`sliceBalanced`/`splitTopLevel` 那套 142 行）
- 不用手工去噪（script 里的类名不会构成 DOM 节点）
- 文本天然只取文本节点，不会把 `<strong>` 高亮处劈出空格

## 模块职责

| 文件                      | 只做这件事                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`            | 门面：`searchByBing` + `SearchOptions` / `SearchResult` 两个 interface；按时区选择入口后转发到 search.ts          |
| `src/contract.ts`         | 对外契约：`SearchResult` / `SearchOptions` 与它们引用的全部类型（**只有类型**）                                   |
| `src/shape.ts`            | 出口裁剪：`ResultShape` / `stripIcons` / `applyResultShape`                                                       |
| `src/protocol.ts`         | Bing 协议事实：站点基址、IG / Salt / AnswerFetcher 正则、搜索与接口 URL（**零依赖**）                             |
| `src/search.ts`           | 编排：两遍请求、重试、PAA 答案加载；导出 `searchByCnBing` / `searchByInternationalBing` 两个具名入口              |
| `src/net/session.ts`      | 会话：`CookieJar` 持有、**会话内请求**（自动带 cookie / 吸收 Set-Cookie）、HVE 与渲染窗口合成、single-flight 缓存 |
| `src/net/headers.ts`      | 基线请求头（UA + Accept 系列 + `sec-ms-gec`，版本取自 UA）                                                        |
| `src/net/errors.ts`       | 错误模型：白名单状态码判定、fetch 异常归一、退避                                                                  |
| `src/net/gec.ts`          | `sec-ms-gec` 纯算法生成（版本由调用方传入）                                                                       |
| `src/net/paa.ts`          | PAA 答案正文加载（`/getanswerforclickedquestion`，附加能力）                                                      |
| `src/utils/ua.ts`         | 生成形态真实的 UA                                                                                                 |
| `src/parse/index.ts`      | 整页解析的**唯一入口**：容器枚举、卡片循环、全局字段                                                              |
| `src/parse/dom.ts`        | 解析 HTML、取文本、取属性、选元素                                                                                 |
| `src/parse/algo.ts`       | `li.b_algo` → `WebPage`（含 favicon/sideImage/rich/links/video）；wpt 网格主结果                                  |
| `src/parse/cards.ts`      | 相关搜索 / 资讯（展开为 `NewsPage`）/ 图片卡                                                                      |
| `src/parse/video.ts`      | 视频卡（展开为 `VideoPage`）+ 主结果内嵌视频                                                                      |
| `src/parse/overview.ts`   | 答案摘要（cht/gs + kind + 来源图标）                                                                              |
| `src/parse/questions.ts`  | PAA 问题与来源 URL（`RelatedQuestion`）                                                                           |
| `src/parse/correction.ts` | 查询纠错提示（`QueryCorrection`，原文搬运）                                                                       |
| `src/parse/rich.ts`       | 单条结果展开（`b_rcGbMod` / `b_richcard`）                                                                        |
| `src/parse/paa-answer.ts` | PAA 答案响应解析（`.paa-txt` / `.paa-cit-card`）                                                                  |
| `src/utils/time.ts`       | 日期前缀、相对时间换算（纯文本，与 DOM 无关）                                                                     |
| `src/utils/collect.ts`    | 通用去重收集（seen + 上限），四个卡片模块共用                                                                     |
| `src/parse/urls.ts`       | Bing 链接统一出口 `resolveBingUrl`（ck/a 还原 + 相对补全，幂等）、`absoluteAssetUrl`                              |
| `src/utils/url.ts`        | 查询参数提取、相对地址绝对化（站点无关）                                                                          |

> `text()` / `textExcept()` 是**唯一的文本化入口**：
> 块级边界补空格、折叠空白都在这里。overview 需要「跳过引用链接子树」，
> 走的是 `textExcept` 的谓词，而不是再写一份递归。

## 对外契约

只导出 `searchByBing` 与 `SearchResult`（外加其引用的类型）。

入口由 `SearchOptions.bingEnterance` 决定：`'cn'` / `'international'`，
不传时按运行时时区推测（中国大陆时区 → cn，其余 → international）。
两个入口共用同一套会话、页面结构、解析器与错误模型，差异只在搜索 URL 上的
`ensearch=1`（见 [PROTOCOL.md](PROTOCOL.md) 的「国际版入口」）。

门面**不导出** `parseSearchPage`——它属于内部实现，单测直接从解析层引入。

契约类型放在一个**纯类型文件**里，出口裁剪是独立的策略层。
两者都不从 `parse/index.ts` 转出：解析层只负责「HTML → SearchResult」，
它不该是契约的出处，更不该装出口策略。

```ts
SearchResult {
    pages: (WebPage | PdfPage | VideoPage | NewsPage)[]  // 结果流，文档顺序
    overview?: Overview                         // kind: 'cht' | 'gs'
    relatedQuestions: RelatedQuestion[]         // PAA；searchByBing 默认加载答案正文
    relatedSearches: string[]
    images?: ImageCard                          // 顶层聚合（不进入 pages）
}
```

- **默认只返回文字**：`favicon` / `logo` / 来源图标、顶层 `images` 图片卡、
  `pages` 里的视频卡（`type:'video'`）都由 `searchByBing` 在出口裁剪
  （实测图标约占返回字符数 19%，图片卡单次可达 60%）。
  `parseSearchPage` 仍完整解析；需要画界面时传
  `includeIcons` / `includeImages` / `includeVideos`。
- `WebPage`（type:'page'）：title/url/snippet/date/site + sideImage/rich/links/video
- `PdfPage`（type:'pdf'）：Bing 打了 `[PDF]` 标记的文档型主结果，**字段与 `WebPage` 完全同构**，
  只有判别值不同（下游据它走「下载并解析文档」而不是「抓网页」）。判别只认标记，不看 URL 后缀。
- `VideoPage`（type:'video'）：视频卡展开为多条；`card` 带卡头标题/更多链接
- `NewsPage`（type:'news'）：资讯卡逐条展开；`card` 带卡头标题
- 内嵌视频（`WebPage.video`）不单独成条，**不受 `includeVideos` 影响**

失败语义：

- **网络 / 服务端故障**：重试耗尽后返回空 `pages`（不抛错），调用方以
  `pages.length === 0` 判定。
- **解析器抛异常**：直接冒泡。它意味着代码 bug，伪装成「Bing 没结果」
  会让真实原因被永久掩盖。
- **PAA 答案加载失败**：只丢 `answer` / `citations`。
