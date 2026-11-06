# bing-search-reverse

零浏览器依赖的 Bing 搜索库：用 **`fetch`（undici，ALPN 协商 h2）+ HTML SSR 直接抓
`cn.bing.com` 的搜索结果**，不跑 CDP、不启 headless Chrome。

## 项目是什么

| 项       | 内容                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 对外入口 | `searchByBing(query, options?): Promise<SearchResult>`，见 [src/index.ts](src/index.ts)                                                                      |
| 契约出处 | 手写的 [types/bing-search-reverse.d.ts](types/bing-search-reverse.d.ts) 是对外契约的**唯一出处**；`src/contract.ts` 是实现侧类型，必须与它对齐               |
| 手测入口 | `npx tsx only_for_develop_fast_test.ignored.ts "查询词"` → 打印整个 `SearchResult`。被 `.gitignore` 的 `*.ignored.ts` 排除，**不入库也不删除**，仅供本机手测 |
| 构建产物 | `dist/bing.js`（约 45KB）+ `dist/bing.d.ts`；外部依赖 `htmlparser2` / `css-select` / `tough-cookie`                                                          |
| 工具链   | 开发用 Node 26 + TypeScript 7（`package.json` 的 `engines` 是`>=20.19`，那是**运行这个包**的下限，两回事）；测试用内置 `node:test`、`tsx`、rollup + esbuild  |
| 明确不做 | 翻页、结果裁决、时间过滤、`host` 派生字段——逐条理由见 [README.md](README.md) 的「已知边界」                                                                  |
| 为什么不 | 首遍填充页 350–480KB，AI 摘要与富化模块全在 SSR 里                                                                                                           |

**返回什么、失败语义、字段含义、安装与用法一律看 [README.md](README.md)，那里是唯一出处，
本文件不重复。**

## 文档地图

改代码前只需要读四份。领域知识在 `docs/`，工作约定在本文件，契约与用法在 README，
三者互不复制。

| 想知道                                | 去读                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| 数据怎么流、分层约束、会话            | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               |
| 请求怎么发（URL / 头 / cookie / rdr） | [docs/PROTOCOL.md](docs/PROTOCOL.md)                       |
| 页面怎么读（选择器表 / 字段来源）     | [docs/PARSING.md](docs/PARSING.md)                         |
| 国内版 vs 国际版、该默认哪个          | [docs/ENTRANCES.md](docs/ENTRANCES.md)                     |
| 最容易踩的坑（唯一出处）              | 下一节 + 每条的展开位置见 [docs/README.md](docs/README.md) |
| 测试怎么组织、怎么跑                  | [tests/](tests/) + 下方「验收」                            |
| 调「工具返回什么形态」（给 LLM 用）   | `sandbox/README.md`（本地独占，不入库）                    |

研究沙盒 `sandbox/`（不入库）：OpenAI SDK + DeepSeek API，把 `searchByBing` 与
`downloadHTMLToMarkdown` 暴露成 LLM 的工具，用于反复调「工具返回什么形态」。
RAG 侧的实验记录与成本分析在 `sandbox/docs/`，**不进主文档树**。

---

## 终端工作流（重要）

- **新会话第一个命令先执行**：`[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()`——从根上解决中文乱码（pwsh7 默认 Console 编码是 gb2312）
- 长命令 / 多行逻辑：写成 `./*.ignored.sh`，用 sh/bash 执行，输出以 **UTF-8 格式** 重定向到 `*.ignored.txt`，再读文件——终端反馈捕获层会丢多行命令的输出
- native 命令（git 等）中文经 `>` 重定向会乱码 → 用 `| Out-File -FilePath x -Encoding utf8`
- 命令显示「无输出」时先怀疑捕获层而非执行失败：用文件状态（Test-Path / 读文件）交叉确认
- 运行结束后处理临时文件（`.ignored.{sh, txt}`）：有价值的去掉 `.ignored.` 保留，无价值的删除

## 🔴 第一原则：正向工程（照做），不要逆向验证

> 「与其构造奇奇怪怪的请求去检查那个头是必须的，我们反而可以照着做，并且代价跟没有一样。」

**浏览器发什么，我们发什么**（URL 参数、请求头、cookie 形态、请求序列）。

- ❌ **不要**构造简化探针去验证生产代码里某字段是否必要——拆开行为本身就改变了被测对象。历史上所有误判都发生在这一刻。
- ❌ **不要**为几十 ms 做实验。当前 ~144ms/词已远优于纯 CDP 的 ~3.3s/词。
- ✅ 实验只在两种情况做：① 生产代码**确实报错**；② 需要**新增**能力。
- ✅ 把「可能的失效点」记成**文档 + 断言**（如 `tests/live/request-shape.test.ts`），而不是提前堆防御代码。

**依据**：Bing 是大众 web 搜索引擎，必须服务任意浏览器与合规 HTTP 请求 →
必然存在一条「按规范照做就能工作」的长期稳定路径。

## 最容易踩的坑（唯一出处）

细则（表格、实测数据、为什么）在 [docs/PROTOCOL.md](docs/PROTOCOL.md)，此处只列条目。

1. URL 里**不能带 `first`** —— 会杀掉 AI Overview 与全部富化模块。
2. `rdr=1` **必须以前置的普通请求为前提**，不能合并成一次请求。
   国际版的唯一开关是 URL 上的 `ensearch=1`（页面结构同构，会话握手不区分入口）。
3. 不要用「低降级率时段」的结论否定某条路径——那是无区分度基线。

## 验收

```bash
pnpm test          # 全部：类型 + 离线 + 在线（含 24 词压测）≈ 20s。改完只跑这一条
pnpm test:offline  # 只有离线 ≈ 3s（改解析器时）
pnpm test:live     # 只有在线 ≈ 17s，随网络波动（改请求层时）
pnpm build         # dist/bing.js + dist/bing.d.ts
```

**只有这一套验收，没有需要人工判断的第二套。**

```
tests/offline/   零网络：解析器（含词条卡/汇率卡/纠错卡）/ GEC / UA / 样本完整性 / 错误模型
tests/live/      需网络：端到端契约 / 请求形态 / 会话层 / 压测
tests/fixtures/  离线样本（真实响应 HTML）+ session-exit-child.ts（子进程被观测对象）
tools/           只放主线产出物脚本：capture-samples.ts（构建直接 rollup -c）
sandbox/         LLM 工具沙盒：browser.ts + cdp-client.ts 是**唯一的浏览器通道**
```

三条纪律：

1. **测试必须 import 生产模块**，不要复制实现。
2. **有断言的进 `tests/`，没有的删掉**。禁止出现「打印统计 + `exit 0`」的脚本——它永远绿。
3. **联网测试每个词只请求一次**（`tests/live/shared.ts` 的 Map 缓存），
   压测写成**单个 `it` 内并发**（`node --test` 默认串行跑用例）。

> `sec-ms-gec` 是**必需项**：无它时首遍只有 105KB 骨架，rdr 也兜不住底。
> 它由 `forgeGec()` 纯算法生成，默认随每个请求注入；细节见
> [docs/PROTOCOL.md](docs/PROTOCOL.md)「sec-ms-gec」。

## 编码规范

- 4 空格缩进，无分号，字符串用单引号（与 [.prettierrc.json](.prettierrc.json) 一致：`printWidth` 79、`endOfLine` crlf、`trailingComma` es5）。
- git 提交格式：`feat|fix|project|refactor|example|chore: 一句话英文描述`，例如 `feat: add a new ui button`。
  默认情况不需要正文，只需要概要。

## 发版（GitHub Actions → npm）

**包名 `bing-search-reverse`，仓库 `github.com/tq-xyy/bing-search-reverse`**，
两者名字一致但不要混：npm 上是包名，GitHub 上是仓库名。改任一处都要同步改
`package.json` 的 `name` / `repository` / `homepage` / `bugs`，以及两个 README 里的安装命令。

唯一发布入口：[.github/workflows/publish.yml](.github/workflows/publish.yml)。

- **触发是版本号驱动，不是 tag**：push 到 `main` 都会跑，但只有
  `package.json` 的 `version` 在 registry 上**尚不存在**时才真正 `npm publish`。
  只改代码不改版本号 → 走「跳过发布」分支，发版动作不发生。
- **发版三步**：改 `version`（`npm version patch|minor|major` 或手改）→ commit → `git push`。
- **认证走 OIDC Trusted Publishing，仓库里不存任何 npm token**。两个极易踩的坑：
  ① `actions/setup-node` **不能写 `registry-url`**，写了它会生成带 `_authToken=${NODE_AUTH_TOKEN}` 的
  `.npmrc` 并注入**空字符串**的 `NODE_AUTH_TOKEN`；② npm 11.x 判断「走 OIDC」的条件是
  `process.env.NODE_AUTH_TOKEN === undefined`，**空串仍算 token 认证** → 报 ENEEDAUTH / 404。
  所以 workflow 里既要去掉 `registry-url`，publish 步骤还要 `unset NODE_AUTH_TOKEN` 兜底。
- npm **不支持为尚不存在的包预配置** Trusted Publisher，所以首个版本必须先用
  `npm publish --access public` 在本机手工发一次，之后才能配发布者
  （Organization/user = `tq-xyy`，Repository = `bing-search-reverse`，
  Workflow filename = 只填 `publish.yml`，不带路径）。
- **workflow 文件名是认证的一部分**：重命名 / 移动 `publish.yml` 必须同步改 npm 后台，否则 OIDC 直接 403。
- **CI 报 `ENEEDAUTH` 的唯一含义**：OIDC 令牌换不到发布权限，即 trusted publisher 未配 /
  文件名或仓库名对不上 / 包还没建。**打包成功不代表认证通过**。自检：
  `npx npm@latest trust list bing-search-reverse`。
- **配 trusted publisher 不必打开网页**：`www.npmjs.com` 只是前端，命令行走的是
  `registry.npmjs.org` 的 API（本机 npm 10.x 没有 `trust` 子命令，必须经 `npx npm@latest`）：
  `npx --yes npm@latest trust github bing-search-reverse --file publish.yml --repo tq-xyy/bing-search-reverse --allow-publish --registry https://registry.npmjs.org --otp=<6位码>`。
  `--allow-publish` 不能省，否则只放行 `npm stage publish`。
- **发布门禁只跑 `pnpm typecheck` + `pnpm test:offline`，故意不跑 `test:live`**：
  live 用例打 `cn.bing.com`，GitHub runner 是海外出口，会变成随机红灯。
- **`--provenance` 要求仓库公开**：仓库转私有就去掉这个参数。
- **本机 `~/.npmrc` 的 `registry` 指向 npmmirror 镜像**，镜像不可发布。所以
  `package.json` 里固定了 `publishConfig.registry = https://registry.npmjs.org`，
  手工发版不要只写 `npm publish`，否则会被推到镜像域名上。
- 发布前确认打进去什么：`npm pack --dry-run`（应为 6 个文件 ≈ 22 kB）。
- CI 里用 `npm publish --ignore-scripts` 避免 `prepare` 重复 build；
  但**本机手工发布时必须让 `prepare` 跑**，否则没有 `dist/` 可发。

## 对话要求

用中文思考和回答用户问题，以便利用中文分词优化，节约 tokens。（硬性要求）
