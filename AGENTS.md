# bing-search-reverse

这是一个零浏览器依赖的 Bing 搜索库：用 **`fetch`（undici，ALPN 协商 h2）+ HTML SSR 直接抓
`cn.bing.com` 的搜索结果**，不跑 CDP、不启 headless Chrome。

## 项目是什么

| 项               | 内容                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 对外入口         | `searchByBing(query, options?): Promise<SearchResult>`，见 [src/index.ts](src/index.ts)（门面：一个函数 + `SearchOptions` / `SearchResult` 两个 interface；契约类型在 [src/contract.ts](src/contract.ts)）。入口由 `options.bingEnterance`（`'cn'` / `'international'`）指定，缺省按运行时时区推测（中国大陆与港澳台 → 国内版，其余 → 国际版） |
| 手测入口         | `npx tsx only_for_develop_fast_test.ignored.ts "查询词"` → 打印整个 `SearchResult`（8 行）。脚本被 `.gitignore` 的 `*.ignored.ts` 排除，**不入库也不删除**，仅供本机手测                                                                                                                                                                       |
| 双入口 A/B       | `npx tsx sandbox/ab.ts`（默认 20 题 × 2 入口；`--domains` / `--cases` 收窄）。结论：中文主题两边都行，英文原典主题（RFC / 官方文档 / 外国文学原文）国际版更优，token 省约 21%                                                                                                                                                                  |
| 构建产物         | `dist/bing.js`（约 43KB）+ `dist/bing.d.ts`（约 12KB）；外部依赖 `htmlparser2` / `css-select` / `tough-cookie`，其余走全局 `fetch` / `node:crypto`                                                                                                                                                                                             |
| 工具链           | Node 26（测试用内置 `node:test`）、TypeScript 7、`tsx`、rollup + esbuild                                                                                                                                                                                                                                                                       |
| 返回什么         | `pages`（`page`/`pdf`/`video`/`news` 四型，文档顺序）+ `overview`（AI 摘要，覆盖率约 8%~33%）+ `relatedQuestions`（PAA）+ `relatedSearches` + `images`（顶层聚合）                                                                                                                                                                             |
| 明确不做         | 翻页（`first` 会杀掉 AI Overview）、结果裁决 / 可信度打分、时间过滤、`host` 派生字段                                                                                                                                                                                                                                                           |
| 为什么不用浏览器 | 首遍填充页 350–480KB，AI Overview 与富化模块全在 SSR 里；纯 HTTP 路径实测 **~144ms/词**（24 词 × 3 轮压测，2026-10-23），远优于纯 CDP 的 ~3.3s/词                                                                                                                                                                                              |

最小用法：

```ts
import { searchByBing } from './dist/bing.js'

const r = await searchByBing('向量数据库 原理')
r.pages[0].title // 第一条结果
r.pages[0].date // 按精度截断，如 '2026-10-05'
r.pages[0].datePrecision // 'day'
r.overview?.paragraphs // AI 摘要正文（Markdown 片段），可能不存在
r.relatedQuestions[0].answer // PAA 答案正文，默认加载
```

失败语义：网络 / 服务端故障重试耗尽后返回**空 `pages`**（不抛错），
调用方以 `pages.length === 0` 判定。PAA 答案加载失败只丢 `answer` / `citations`。
**解析器抛异常会直接冒泡**（那是代码 bug，不伪装成「没结果」）。

```
src/index.ts     门面：searchByBing + 两个契约 interface        src/contract.ts   对外契约（纯类型）
src/shape.ts     出口裁剪                  src/protocol.ts   Bing 协议事实（零依赖）
src/search.ts    编排：两遍请求 + 重试 + 出口裁剪（searchByCnBing / searchByInternationalBing）
src/net/session.ts  CookieJar / 会话内请求 / HVE   src/net/headers.ts  基线请求头
src/net/errors.ts   白名单状态码 / 异常归一 / 退避   src/net/gec.ts   sec-ms-gec 算法生成
src/net/paa.ts   PAA 答案正文加载（附加能力）
src/parse/       纯函数解析层（零 IO，无 layout 中间层）   src/utils/   UA / 时间 / URL / 去重
```

研究沙盒（不是对外契约，本地私有，不入库）：`sandbox/`——OpenAI SDK + DeepSeek API，
把 `searchByBing` 与 `downloadHTMLToMarkdown` 暴露成 LLM 的两个工具，
用于反复调「工具返回什么形态」。默认 `deepseek-flash`，不限轮数、不限输出 token。
`sandbox/ab.ts` 是双入口 A/B 驱动（题单在 `sandbox/ab-cases.ts`）。
两个入口的机制差别、检索质量对比、该默认哪个，见 [docs/ENTRANCES.md](docs/ENTRANCES.md)；
抓取层的成本与边界见 [docs/FETCH-LIMITS.md](docs/FETCH-LIMITS.md)。

正式文档入口：[docs/README.md](docs/README.md)（项目地图）。

---

## 终端工作流（重要）

- **新会话第一个命令先执行**：`[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()`——从根上解决中文乱码（pwsh7 默认 Console 编码是 gb2312，显示层把 UTF-8 字节按 GBK 显示；设置后 python 输出中文正常）
- 长命令 / 多行逻辑：写成 `./*.ignored.sh`，用 sh/bash 执行，输出以 **UTF-8 格式** 重定向到 `*.ignored.txt`，再用读文本工具读取结果——终端反馈捕获层会丢多行命令的输出，脚本 + 文件的方式更可靠
- native 命令（git 等）中文经 `>` 重定向会乱码 → 用 `| Out-File -FilePath x -Encoding utf8`
- 命令显示「无输出」时先怀疑捕获层而非执行失败：用文件状态（Test-Path / 读文件）交叉确认
- 运行结束后处理本次生成的临时脚本和重定向文本文件（`.ignored.{sh, txt}`）：有价值的去掉 `.ignored.` 保留，无价值的删除。

## 🔴 第一原则：正向工程（照做），不要逆向验证

> 「与其构造奇奇怪怪的请求去检查那个头是必须的，我们反而可以照着做，并且代价跟没有一样。」

**浏览器发什么，我们发什么**（URL 参数、请求头、cookie 形态、请求序列）。

- ❌ **不要**构造简化探针去验证生产代码里某字段是否必要——拆开行为本身就改变了被测对象。
  历史上所有误判（UA 黑名单、rdr 无效、rdr 冗余）都发生在这一刻。
- ❌ **不要**为几十 ms 做实验。当前 ~144ms/词（24 词 × 3 轮压测，2026-10-23；
  历史上测到过 86ms/词，随窗口与词表漂移）已远优于纯 CDP（~3.3s/词）。
- ✅ 实验只在两种情况做：① 生产代码**确实报错**；② 需要**新增**能力。
- ✅ 把「可能的失效点」记成**文档 + 断言**（如 `tests/live/request-shape.test.ts`），而不是提前堆防御代码。

**依据**：Bing 是大众 web 搜索引擎，必须服务任意浏览器与合规 HTTP 请求 → 必然存在
一条「按规范照做就能工作」的长期稳定路径。

## 文档地图

> | 想知道                                           | 去读                                         |
> | ------------------------------------------------ | -------------------------------------------- |
> | 模块划分、数据流                                 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
> | 请求形态、cookie、rdr                            | [docs/PROTOCOL.md](docs/PROTOCOL.md)         |
> | 页面结构、容器与选择器表                         | [docs/PARSING.md](docs/PARSING.md)           |
> | 国内版 vs 国际版：机制、质量、默认哪个           | [docs/ENTRANCES.md](docs/ENTRANCES.md)       |
> | 下游抓取的成本与失真（PDF 黑洞 / 上下文预算）    | [docs/FETCH-LIMITS.md](docs/FETCH-LIMITS.md) |
> | 为什么不能那么改                                 | [docs/decisions/](docs/decisions/)           |
> | 实验史（推翻清单 / 无影响清单）                  | [docs/HISTORY.md](docs/HISTORY.md)           |
> | 测试怎么组织、怎么跑                             | [tests/](tests/) + 下方「验收」              |
> | 调「工具返回什么形态」（搜索/网页获取给 LLM 用） | `sandbox/README.md`（本地独占，不入库）      |
>
> 拆分理由：原文件 7058 行 / 394KB，其中约 40% 是已作废的结论
> （CDP、降级窗口、`status`/`fallbackQuery`），每次查阅都要把全部历史读一遍。
> 按「是否影响你下次改代码」分层之后，改代码只需要读 ARCHITECTURE + PARSING。

## 现行契约（速查）

```ts
searchByBing(query: string, options?: SearchOptions): Promise<SearchResult>

SearchOptions {
    bingEnterance?: 'cn' | 'international'   // 缺省按运行时时区推测
    includeIcons? / includeImages? / includeVideos?
    loadRelatedAnswers? / relatedAnswerConcurrency?
}

SearchResult {
    pages: (WebPage | PdfPage | VideoPage | NewsPage)[]  // 结果流，文档顺序
    overview?: Overview                        // kind: 'cht' | 'gs'，覆盖率约 8%~33%
    relatedQuestions: RelatedQuestion[]        // PAA；“搜索层”默认加载答案正文
    relatedSearches: string[]                  // 实测 0~10 条（长 query 常为 0）
    images?: ImageCard                         // 顶层聚合（不进入 pages）
    correct?: QueryCorrection                  // 打错字时 Bing 的纠错提示（原文，不生成）
}
```

（失败语义见上文「项目是什么」之后的同一段，不重复。）

`correct` 只在 Bing 判定「打错字」时出现（实测 `Pyton socket` → `Python socket`），
只有两个字段：`hint` 与 `correctedQuery`，**逐字搬运**，不给 URL。

`hint` 是**两个 `.b_promtxt` 拼起来的整句**（Bing 分两段下发），必须一起给：
「以下是 Python socket 的结果。改为搜索 Pyton socket?」——单给前段读起来像
正常结果页的标题，**没有明示「搜错了」**，点破这件事的是后段。
两段的文案是**灰度可变的**（同日见过「包含…/是否只需要…?」与「以下是…/改为搜索…?」），
所以解析器只认结构不认字面。

正常查询该字段缺省。纠错页首屏的 wpt 卡（`li.b_ans` 里的 `.b_wpt_bl`）中，
**只有带 `.b_tpcn` 来源行的块**是主结果，会被收进 `pages`。

时间字段（`WebPage.date` / `VideoPage.published` / `NewsPage.time`）
**按精度截断**，不是精确时刻：`day`→`YYYY-MM-DD`、`hour`→`YYYY-MM-DD HH`、
`minute`→`YYYY-MM-DD HH:mm`，精度见对应 `*Precision` 字段。
Bing 的相对表述（「6 天之前」「8 小时」）按注入的 `nowMs` 反推；
**不补 `00:00` 伪造时刻**（2026-10-18 修）。

`date` 是 Bing 的**页面收录/更新日**，不是内容事件的发生时间，且相当一部分条目
本来就没有该字段（缺失 = Bing 没给）。它只能做排序参考，不足以当过滤判据。

`site` 是 Bing 展示名，原样搬运，**可能错标**（`query.libretexts.org` 曾标成
「知乎专栏」）；来源一律以 `url` 的 hostname 为准——不需要额外的 host 字段。

## 六条最容易踩的坑

1. URL 里**不能带 `first`** —— 会杀掉 AI Overview 与全部富化模块。
2. `rdr=1` **必须以前置的普通请求为前提**，不能合并成一次请求。
   国际版的唯一开关是 URL 上的 `ensearch=1`（页面结构同构，会话握手不区分入口）。
3. **第一遍响应的 `Set-Cookie` 必须合并进第二遍**（由 `Session.request` 自动做）。
   漏掉会让富化模块整体消失而主结果照常，极易误判成「风控/CSR 改版」。
4. 不要用「低降级率时段」的结论否定某条路径——那是无区分度基线。
5. **归因要看唯一变量**：`--user-agent` 决定 CDP 通道能否拿到富化页，
   不是 `navigator.webdriver` 覆盖（2026-10-24 纠正，两变量同时存在时曾被归错）。
6. **国际版的外链几乎全是 `ck/a` 跳转**（国内版约 0~10%）。解析器取链接一律走
   `src/parse/urls.ts` 的 `resolveBingUrl`（还原 ck/a + 补相对，幂等），
   不要在字段处自己拼 `toAbsoluteUrl`，否则国际版的视频/图片/富卡片会漏解。

详见 [docs/decisions/](docs/decisions/)。

## 验收

```bash
pnpm test          # 全部：类型 + 离线 + 在线（含 24 词压测）≈ 15s。改完只跑这一条
pnpm test:offline  # 只有离线 ≈ 1.8s（改解析器时）
pnpm test:live     # 只有在线 ≈ 12s（改请求层时）
pnpm build         # dist/bing.js + dist/bing.d.ts
```

**只有这一套验收，没有需要人工判断的第二套**（2026-10-24 起）。

目录与纪律：

```
tests/offline/   零网络：解析器（含词条卡/汇率卡/纠错卡）/ GEC / UA / 样本完整性 / 错误模型（232 项）
tests/live/      需网络：端到端契约 / 请求形态 / 会话层 2 项 / 压测 1 项（48 项 + 13 skip）
tests/fixtures/  离线样本（真实响应 HTML）+ session-exit-child.ts（子进程被观测对象）
tools/           只放主线产出物脚本：capture-samples.ts（构建直接 rollup -c）
sandbox/         LLM 工具沙盒：browser.ts + cdp-client.ts 是**唯一的浏览器通道**
```

三条纪律：

1. **测试必须 import 生产模块**，不要复制实现（历史上 26 个脚本复制 `h2get`，
   其中 `request-shape-check` 甚至拼了生产禁止的 `&first=1`）。
2. **有断言的进 `tests/`，没有的删掉**。禁止出现「打印统计 + `exit 0`」的脚本——
   它永远绿，在 AI-only 语境下是纯负担（`layout-check` / `attribute-check` 已按此删除）。
3. **联网测试每个词只请求一次**（`tests/live/shared.ts` 的 Map 缓存），
   压测写成**单个 `it` 内并发**（`node --test` 默认串行跑用例，24 个 `it` 会慢 5 倍）。

> `sec-ms-gec` 是**必需项**：无它时首遍只有 105KB 骨架，rdr 也不再可靠兜底。
> 它由 `src/net/gec.ts` 的 `forgeGec()` **纯算法生成**（0.5ms，无浏览器、无网络、无缓存文件），
> 是唯一来源，默认随每个请求注入。`sec-ms-gec-version` 的版本号取自
> `resolveUaProfile().edgeVersion`，与 UA 里的 `Edg/` 段一致——
> 「只有 Edge 才发这个头」由类型保证（`gecHeaders` 只收版本号），不做 UA 正则嗅探。
> 详见 [docs/PROTOCOL.md](docs/PROTOCOL.md) 的「sec-ms-gec」一节。

## 编码规范

- 4 空格缩进，无分号，字符串用单引号（与 [.prettierrc.json](.prettierrc.json) 一致：`printWidth` 79、`endOfLine` crlf、`trailingComma` es5）。
- git 提交格式：`feat|fix|project|refactor|example|chore: 一句话英文描述`，例如 `feat: add a new ui button`。
  默认情况不需要正文，只需要概要。

## 发版（GitHub Actions → npm）

**包名 `bing-search-reverse`，仓库 `github.com/tq-xyy/bing-search-reverse`**，
两者名字一致但不要混：npm 上是包名，GitHub 上是仓库名。改任一处都要同步改
`package.json` 的 `name` / `repository` / `homepage` / `bugs`，以及两个 README 里的安装命令。

唯一发布入口：[`.github/workflows/publish.yml`](.github/workflows/publish.yml)。

- **触发是版本号驱动，不是 tag**：push 到 `main` 都会跑，但只有
  `package.json` 的 `version` 在 registry 上**尚不存在**时才真正 `npm publish`。
  只改代码不改版本号 → 走「跳过发布」分支，发版动作不发生。
- **发版三步**：改 `version`（`npm version patch|minor|major` 或手改）→ commit → `git push`。
- **认证走 OIDC Trusted Publishing，仓库里不存任何 npm token**。有两个极易踩的坑：
  ① `actions/setup-node` **不能写 `registry-url`**，写了它会生成带 `_authToken=${NODE_AUTH_TOKEN}` 的
  `.npmrc` 并注入**空字符串**的 `NODE_AUTH_TOKEN`；② npm 11.x 判断「走 OIDC」的条件是
  `process.env.NODE_AUTH_TOKEN === undefined`，**空串仍算 token 认证** → 报 ENEEDAUTH / 404，OIDC 不会被触发。
  所以 workflow 里既要去掉 `registry-url`，publish 步骤还要 `unset NODE_AUTH_TOKEN` 兜底。
- 但 npm **不支持为尚不存在的包预配置** Trusted Publisher，所以首个版本必须先用
  `npm publish --access public` 在本机手工发一次，之后才能在
  `npmjs.com/package/bing-search-reverse/settings` 配 GitHub Actions 发布者（Organization/user = `tq-xyy`，
  Repository = `bing-search-reverse`，Workflow filename = 只填 `publish.yml`，不带路径）。
- **workflow 文件名是认证的一部分**：重命名 / 移动 `publish.yml` 必须同步改 npm 后台，否则 OIDC 直接 403。
- **CI 报 `ENEEDAUTH` 的唯一含义**：OIDC 令牌换不到发布权限，即 trusted publisher 未配 /
  文件名或仓库名对不上 / 包还没建。**打包成功不代表认证通过**——日志里 tarball 明细正常、
  紧跟着 ENEEDAUTH，就是这一条。可用 `npx npm@latest trust list bing-search-reverse` 自检。
- **配 trusted publisher 不必打开网页**：`www.npmjs.com` 只是前端，命令行走的是
  `registry.npmjs.org` 的 API。用（本机 npm 10.x 没有 `trust` 子命令，必须经 `npx npm@latest`）：
  `npx --yes npm@latest trust github bing-search-reverse --file publish.yml --repo tq-xyy/bing-search-reverse --allow-publish --registry https://registry.npmjs.org --otp=<6位码>`。
  `--allow-publish` 不能省，否则只放行 `npm stage publish`。
- **发布门禁只跑 `pnpm typecheck` + `pnpm test:offline`，故意不跑 `test:live`**：
  live 用例打 `cn.bing.com`，GitHub runner 是海外出口，会变成随机红灯。要全跑就换成 `pnpm test`。
- **`--provenance` 要求仓库公开**：仓库转私有就去掉这个参数，否则 publish 失败。
- **本机 `~/.npmrc` 的 `registry` 指向 npmmirror 镜像**，镜像不可发布。所以
  `package.json` 里固定了 `publishConfig.registry = https://registry.npmjs.org`，
  手工发版不要只写 `npm publish`，否则会被推到镜像域名上。
- 发布前想确认打进去什么：`npm pack --dry-run`（本地验证是 6 个文件 ≈ 22 kB，
  含 `dist/bing.js` / `dist/bing.d.ts` / 两个 README / LICENSE / package.json）。
- CI 里用 `npm publish --ignore-scripts` 避免 `prepare` 重复 build；
  但**本机手工发布时必须让 `prepare` 跑**，否则没有 `dist/` 可发。

## 对话要求

用中文思考和回答用户问题，以便利用中文分词优化，节约 tokens。（硬性要求）
