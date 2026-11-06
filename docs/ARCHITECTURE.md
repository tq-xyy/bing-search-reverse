# 架构

## 数据流

```
searchByBing(query, options?)                 src/index.ts
  ├─ searchByCnBing / searchByInternationalBing   src/search.ts
  ├─ getSession()                             src/net/session.ts
  │    ├─ Session 构造（CookieJar + origin）
  │    ├─ 首页握手 → Set-Cookie 进 jar + Salt
  │    └─ jsCookies() + mergeSrchhpgusr()      → HVE + 渲染窗口字段
  │
  └─ 重试循环（MAX_ATTEMPTS = 3，只有网络阶段在 try 里）
       ├─ requestPage(query, session, entrance)
       │    ├─ 第 1 遍：searchUrl(q, cvid, entrance)
       │    └─ 第 2 遍：rdrUrl(url, IG)（首遍非填充页时才发）
       ├─ parseSearchPage(html, nowMs)        src/parse/index.ts
       ├─ loadRelatedAnswers(questions, session)  src/net/paa.ts
       └─ applyResultShape(result, options)   src/shape.ts（出口裁剪）
```

URL 由 `src/protocol.ts` 构造；国际版只是多一个 `ensearch=1`。

## 三条分层约束

依赖方向严格单向：`index → search → net → utils`，`search → parse → {dom,urls} → utils`，
`net/` 与 `parse/` **互不 import**。两者的公共事实（站点基址、IG / Salt 正则、接口 URL）
都放在零依赖叶子 `protocol.ts`。

- **`parse/` 是纯函数层**：零 IO、零异步、零 `process.env`，唯一输入是 `(html, nowMs)`，
  所以断网也能单测。`nowMs` 必须由上层注入，解析层自己不调 `Date.now()`，
  否则相对时间（「6 天之前」）无法确定性断言。
- **出口裁剪不在 `parse/` 里**：`shape.ts` 是策略，解析器只负责「能抓到就抓」。
- **`utils/` 与 `protocol/` 的界线**：换一个站点也照样能用的放 `utils/`；
  是 Bing 协议事实的放 `protocol.ts`。站点基址在 `protocol.ts`，
  资产 URL 补全 `absoluteAssetUrl` 在 `parse/urls.ts`，`utils/url.ts` 只剩三个通用函数。

## 传输与会话

传输用**全局 `fetch`**（undici，ALPN 协商即 h2）。

`Session` 持有 `tough-cookie` 的 `CookieJar`：

- **两遍请求共用同一个 jar**：第一遍响应重新下发的 `SRCHHPGUSR` 会被自动吸收，
  第二遍 `rdr=1` 直接用新 cookie（浏览器也是这样）。
- **写回 `SRCHHPGUSR` 必须复用原 cookie 的 Domain/Path**：jar 按
  `(name, domain, path)` 判重，换作用域会造出第二条同名 cookie，而
  `getCookieString` 返回**旧的那条**——HVE 根本没发出去。这是换用 jar 时唯一的真实坑。

## 对外契约

只导出 `searchByBing` 与 `SearchResult`（外加其引用的类型）。门面**不导出**
`parseSearchPage`——它属于内部实现，单测直接从解析层引入。

契约类型放在纯类型文件 `contract.ts`，出口裁剪是独立的策略层。两者都不从
`parse/index.ts` 转出：解析层只负责「HTML → SearchResult」，它不该是契约的出处。

- **默认只返回文字**：`favicon` / 来源图标、顶层 `images` 图片卡、`pages` 里的视频卡
  都由 `searchByBing` 在出口裁剪（实测图标约占返回字符数 19%，图片卡单次可达 60%）。
  `parseSearchPage` 仍完整解析；需要画界面时传
  `includeIcons` / `includeImages` / `includeVideos`。
- `PdfPage` 字段与 `WebPage` **完全同构**，只有判别值 `type:'pdf'` 不同。
- 内嵌视频（`WebPage.video`）不单独成条，**不受 `includeVideos` 影响**。

字段语义与失败语义见 [README.md](../README.md)（唯一出处）。
