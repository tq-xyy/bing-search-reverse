# bing-search-reverse

[English](README_en.md) | 中文

用 `fetch`（undici，ALPN 协商 h2）+ HTML SSR 直接抓 `cn.bing.com` 的搜索结果，**零浏览器依赖**。

## 特点

- **不启浏览器**。不跑 CDP、不装 Puppeteer、不执行任何页面脚本。Bing 的结果是服务端渲染的，
  首遍填充页 350–480KB，AI Overview 与全部富化模块都在 SSR 里。
- **约 144ms/词**（24 词 × 3 轮压测）。同机纯 CDP 路径约 3.3s/词。
- **返回结构化结果**：结果流（网页 / PDF / 视频 / 新闻）、AI 摘要、PAA 问答、相关搜索、图片聚合、
  查询纠错提示。
- **双入口**：国内版 `cn.bing.com` 与国际版（`ensearch=1`），缺省按时区推测。
- 运行期只依赖 `htmlparser2` / `css-select` / `tough-cookie`。

## 安装

尚未发布到 npm registry，直接从 GitHub 装：

```bash
npm i github:tq-xyy/bing-search-reverse
```

`dist/` 不进仓库，由 `package.json` 的 `prepare` 脚本在安装时自动构建。

> **pnpm ≥ 12 用户**：默认不信任 git 依赖的构建脚本，会报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`。
> 需在 `pnpm-workspace.yaml` 里精确放行（键必须是完整的包 spec）：
>
> ```yaml
> allowBuilds:
>     'bing-search-reverse@git+https://github.com/tq-xyy/bing-search-reverse': true
> ```

要求 Node **≥ 20.19**。包是 ESM，但两种写法都能用：

```js
import { searchByBing } from 'bing-search-reverse' // ESM
const { searchByBing } = require('bing-search-reverse') // CJS
```

## 用法

```ts
import { searchByBing } from 'bing-search-reverse'

const r = await searchByBing('向量数据库 原理')

for (const p of r.pages) console.log(p.type, p.title, p.url)
r.overview?.paragraphs // AI 摘要正文，可能不存在
r.relatedQuestions[0].answer // PAA 答案正文，默认已加载
```

## 接口

```ts
searchByBing(query: string, options?: SearchOptions): Promise<SearchResult>

interface SearchOptions {
    /** 入口：'cn' 国内版 / 'international' 国际版；缺省按运行时时区推测。 */
    bingEnterance?: 'cn' | 'international'
    /** 是否加载 PAA 答案正文（默认 true）。 */
    loadRelatedAnswers?: boolean
    /** PAA 答案加载并发上限（默认 3）。 */
    relatedAnswerConcurrency?: number
    /** 三个 include* 语义一致：默认关，显式 true 才保留。 */
    includeIcons?: boolean
    includeImages?: boolean
    includeVideos?: boolean
}

interface SearchResult {
    pages: SearchResultPage[] // 结果流，文档顺序
    overview?: Overview // AI 摘要，覆盖率约 8%~33%
    relatedQuestions: RelatedQuestion[] // PAA，默认已加载答案正文
    relatedSearches: string[] // 实测 0~10 条（长 query 常为 0）
    images?: ImageCard // 顶层聚合，不进 pages
    correct?: QueryCorrection // 打错字时 Bing 的纠错提示
}

type SearchResultPage = WebPage | PdfPage | VideoPage | NewsPage

interface WebPage {
    type: 'page'
    title: string
    url: string // 已解码（ck/a 跳转已还原）
    snippet?: string
    date?: string // Bing 的收录/更新日，按精度截断
    datePrecision?: DatePrecision
    site?: string // Bing 展示名，可能错标；来源以 url 的 hostname 为准
    favicon?: string
    sideImage?: SideImage
    rich?: RichCard // 富卡片（展开的侧栏内容）
    links?: LinkItem[] // 卡片内子链接，上限 20 条
    video?: InlineVideo
}

interface PdfPage extends Omit<WebPage, 'type'> {
    type: 'pdf'
}

interface VideoPage {
    type: 'video'
    source: 'card'
    title: string
    url: string
    card: { title?: string; url?: string }
    thumbnail?: string
    duration?: string
    site?: string
    uploader?: string
    views?: string
    published?: string
    publishedPrecision?: DatePrecision
    description?: string
}

interface NewsPage {
    type: 'news'
    title: string
    url: string
    snippet?: string
    source?: string
    time?: string
    timePrecision?: DatePrecision
    logo?: string
    card: { title?: string; url?: string }
}

type DatePrecision = 'minute' | 'hour' | 'day'

interface Overview {
    kind: 'cht' | 'gs'
    title: string
    paragraphs: string[] // 正文块，Markdown 片段
    sources: OverviewSource[]
}

interface OverviewSource {
    name: string
    url: string
    favicon?: string
}

interface RelatedQuestion {
    question: string
    sourceUrl?: string
    answer?: string
    citations?: RelatedAnswerCitation[]
}

interface RelatedAnswerCitation {
    title?: string
    site?: string
    url: string
    favicon?: string
}

interface ImageCard {
    title: string
    url?: string
    moreUrl?: string
    items: ImageItem[]
}

interface ImageItem {
    thumbnailUrl: string
    title: string
    detailUrl: string
    mediaUrl?: string
    sourceUrl?: string
    width?: number
    height?: number
    originalWidth?: number
    originalHeight?: number
    id?: string
}

/** 查询纠错提示：hint 是两句拼成的整句，correctedQuery 为建议查询词。 */
interface QueryCorrection {
    hint: string
    correctedQuery: string
}

interface RichCard {
    title?: string
    url?: string
    sections: RichSection[]
    images?: string[]
}

interface RichSection {
    title: string
    text: string
    url?: string
}

interface SideImage {
    thumbnailUrl: string
    detailUrl?: string
    width?: number
    height?: number
}

interface LinkItem {
    title: string
    url: string
}
```

### 失败语义

- 网络 / 服务端故障重试耗尽 → 返回**空 `pages`**，不抛错。调用方以 `pages.length === 0` 判定。
- PAA 答案加载失败 → 只丢 `answer` / `citations`，问题本身还在。
- **解析器抛异常会直接冒泡**——那是代码 bug，不伪装成"没结果"。

### 时间字段按精度截断

`WebPage.date` / `VideoPage.published` / `NewsPage.time` 不是精确时刻，精度见对应
`*Precision` 字段：`day` → `YYYY-MM-DD`、`hour` → `YYYY-MM-DD HH`、`minute` → `YYYY-MM-DD HH:mm`。
Bing 的相对表述（"6 天之前"）会反推成绝对时间，但不补 `00:00` 伪造时刻。

### 已知边界

- **不支持翻页**：URL 带 `first` 会让 Bing 判定为翻页请求，跳过 AI Overview 与全部富化模块。
- 不做结果裁决 / 可信度打分、时间过滤、`host` 派生字段。
- AI Overview 覆盖率约 8%~33%，取决于查询。

## 开发

```bash
pnpm install

pnpm test          # 全部：类型 + 离线 + 在线（含 24 词压测）≈ 15s
pnpm test:offline  # 只有离线 ≈ 2s（改解析器时用这个）
pnpm test:live     # 只有在线 ≈ 12s（改请求层时）
pnpm build         # → dist/bing.js + dist/bing.d.ts
pnpm lint          # prettier 格式化
```

手测单个查询：

```bash
npx tsx only_for_develop_fast_test.ts "查询词"
```

> 开发本仓库需要 **Node ≥ 22** —— `node --test` 从 22 起才支持 glob 形式
> （`tests/offline/**/*.test.ts`）。库本身在 20.19 上可用，只是跑不了这套测试脚本。
>
> `pnpm test:live` 会真实请求 `cn.bing.com`，机房 IP 容易被限流。

模块划分、请求协议、解析规则与设计取舍见 [`docs/`](docs/README.md)。

## 免责声明

本项目仅用于**学习与技术研究**，不做大规模抓取、不绕过付费墙、不存储用户数据。
使用前请自行确认符合 Bing 的服务条款与你所在地区的法律法规。
作者不对使用本库产生的任何后果负责。

## License

[MIT](LICENSE) © Li yan (tq-xyy)
