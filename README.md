# bing-search-reverse

[English](README_en.md) | 中文

用 `fetch` 直接取 `cn.bing.com` 的 HTML SSR 响应并解析出搜索结果，**零浏览器依赖**。

## 特点

- **不启动浏览器**。不跑 CDP、不装 Puppeteer、不执行任何页面脚本。Bing 的结果由服务端渲染，
  首遍填充页 350–480KB，AI Overview 与全部富化模块都在 SSR 里。
- **约 144ms/词**（24 词 × 3 轮压测）。同机纯 CDP 路径约 3.3s/词。
- **返回结构化数据**：结果流（网页 / PDF / 视频 / 新闻）、AI 摘要、PAA 问答、相关搜索、图片聚合、
  查询纠错提示。
- **双入口**：国内版 `cn.bing.com` 与国际版（`ensearch=1`），默认按运行时时区推测。
- 运行期只依赖 `htmlparser2` / `css-select` / `tough-cookie`。
- **GEC 支持**：`sec-ms-gec` 头的生成方式逆向自 `msedge.dll`，带上它才能走 Bing 给 Edge 开的快速通道。

## 安装

```bash
# 推荐使用 pnpm
pnpm install bing-search-reverse
```

## 用法

```ts
import { searchByBing } from 'bing-search-reverse'

const r = await searchByBing('something to search')

for (const p of r.pages) console.log(p.type, p.title, p.url)
r.overview?.paragraphs // AI 摘要正文，可能不存在
r.relatedQuestions[0].answer // PAA 答案正文，默认已加载
```

## 接口

```ts
function searchByBing(
    query: string,
    options?: SearchOptions
): Promise<SearchResult>

interface SearchOptions {
    /**
     * 入口：'cn' 国内版 / 'international' 国际版。
     * 缺省按运行时的时区推测：中国大陆与港澳台 → 'cn'，其余 → 'international'。
     */
    bingEnterance?: 'cn' | 'international'
    /** 是否加载 PAA 答案正文（默认 true）。关掉能省一轮请求。 */
    loadRelatedAnswers?: boolean
    /** PAA 答案并发上限（默认 3）。 */
    relatedAnswerConcurrency?: number
    /** 保留 favicon / logo / 来源图标（默认 false）。实测图标约占返回字符数 19%。 */
    includeIcons?: boolean
    /** 保留顶层 images 图片卡（默认 false）。单次可达返回字符数 60%。 */
    includeImages?: boolean
    /** 保留 type:'video' 的视频条目（默认 false）。不影响内嵌 WebPage.video。 */
    includeVideos?: boolean
}

interface SearchResult {
    /** 结果流，文档顺序。四型混排，用 type 判别。 */
    pages: SearchResultPage[]
    /** AI 摘要。覆盖率约 8%~33%，查询不触发时整个字段缺失。 */
    overview?: Overview
    /** PAA（用户还问）。答案正文默认已加载；加载失败只丢 answer。 */
    relatedQuestions: RelatedQuestion[]
    /** 相关搜索词。实测 0~10 条，长 query 常为 0。 */
    relatedSearches: string[]
    /** 图片卡，顶层聚合，不进入 pages。默认被裁掉。 */
    images?: ImageCard
    /** Bing 判定"打错字"时的纠错提示。正常查询缺失。 */
    correct?: QueryCorrection
}

/** 结果流中的一项，用 type 区分四型。 */
type SearchResultPage = WebPage | PdfPage | VideoPage | NewsPage

interface WebPage {
    type: 'page'
    /** 标题。不含 Bing 下发的 [PDF] 之类文档标记。 */
    title: string
    /** 已解码的绝对 URL（ck/a 跳转已还原，相对路径已补全）。 */
    url: string
    /** 摘要正文，已剥掉开头的收录日期前缀。 */
    snippet?: string
    /**
     * Bing 的收录/更新日，按精度截断，如 '2026-10-05'。
     * 是页面的索引时间，不是内容事件的发生时间。缺失 = Bing 没给。
     */
    date?: string
    /** date 的精度：'day' / 'hour' / 'minute'，与 date 的截断粒度一致。 */
    datePrecision?: DatePrecision
    /** Bing 展示名，原样搬运，可能错标。来源以 url 的 hostname 为准。 */
    site?: string
    /** 站点图标 URL。默认被出口裁剪掉，需 includeIcons。 */
    favicon?: string
    /** 右侧配图。 */
    sideImage?: SideImage
    /** 富卡片：展开的侧栏内容。 */
    rich?: RichCard
    /** 深链接 / 子链接，上限 20 条，按 URL 去重。 */
    links?: LinkItem[]
    /** 内嵌视频富摘要。不受 includeVideos 影响。 */
    video?: InlineVideo
}

/** 文档型主结果：Bing 打了 [PDF] 标记的条目。 */
/** 字段与 WebPage 完全同构，只有判别值不同。判别只认标记，不看 URL 后缀。 */
interface PdfPage extends Omit<WebPage, 'type'> {
    type: 'pdf'
}

interface VideoPage {
    type: 'video'
    /** 视频卡展开的条目固定为 'card'；内嵌视频是 'inline' 且不单独成条。 */
    source: 'card'
    title: string
    url: string
    /** 卡头：标题与「更多视频」链接。 */
    card: { title: string; moreUrl?: string }
    /** 缩略图 URL。 */
    thumbnail?: string
    /** 时长原文，如 '12:34'。 */
    duration?: string
    /** 来源站点名。 */
    site?: string
    /** 上传人 / UP 主。 */
    uploader?: string
    /** 播放量原文，如 '1.2万次观看'。 */
    views?: string
    /** 上传时间，按精度截断。 */
    published?: string
    /** published 的精度。 */
    publishedPrecision?: DatePrecision
    /** 视频简介。 */
    description?: string
}

interface NewsPage {
    type: 'news'
    title: string
    url: string
    /** 摘要正文。 */
    snippet?: string
    /** 媒体来源名，如 '凤凰网科技'。 */
    source?: string
    /** 发布时间，按精度截断。 */
    time?: string
    /** time 的精度。 */
    timePrecision?: DatePrecision
    /** 媒体 logo URL。默认被出口裁剪掉，需 includeIcons。 */
    logo?: string
    /** 卡头：整个资讯卡的标题。 */
    card: { title?: string }
}

/** 时间精度：只到分 / 只到小时 / 只到天。 */
type DatePrecision = 'minute' | 'hour' | 'day'

interface Overview {
    /** 两套 DOM，正文形态不同：'cht' 是 Markdown 渲染，'gs' 是分段文本。 */
    kind: 'cht' | 'gs'
    /** 摘要标题。gs 型缺标题时会取正文首 80 字。 */
    title: string
    /** 正文块，Markdown 片段。列表、代码块、## 标题都已还原成 Markdown。 */
    paragraphs: string[]
    /** 引用来源，按 URL 去重。 */
    sources: OverviewSource[]
}

interface OverviewSource {
    /** 来源站点名。gs 型缺失时回退成 url 的 hostname。 */
    name: string
    url: string
    /** 来源图标。默认被裁剪，需 includeIcons。 */
    favicon?: string
}

interface RelatedQuestion {
    /** 问题原文。 */
    question: string
    /** 答案来源页 URL，来自 .b_paa_ansContainer 的 data-url。 */
    sourceUrl?: string
    /** 答案正文。默认已加载；加载失败时该字段缺失，问题本身仍保留。 */
    answer?: string
    /** 答案里引用的来源列表。 */
    citations?: RelatedAnswerCitation[]
}

interface RelatedAnswerCitation {
    title?: string
    /** 来源站点名。 */
    site?: string
    url: string
    /** 来源图标。默认被裁剪，需 includeIcons。 */
    favicon?: string
}

interface ImageCard {
    /** 卡头标题。 */
    title: string
    /** 卡头链接，指向「查看更多图片」。 */
    url?: string
    moreUrl?: string
    /** 图片条目，上限 20 条，按缩略图 URL 去重。 */
    items: ImageItem[]
}

interface ImageItem {
    /** 缩略图 URL。这是 items 的去重键，必填。 */
    thumbnailUrl: string
    /** 图片标题，来自 .imgInfo 的 title 或链接的 aria-label。 */
    title: string
    /** Bing 的图片详情页 URL（已还原 ck/a）。 */
    detailUrl: string
    /**
     * 原图直链，从 detailUrl 的 mediaurl 参数解出。
     * 若外层是 Bing 的 R-C 代理，sourceUrl 会再解一层 riu。
     */
    mediaUrl?: string
    /** 图片来源页 URL。 */
    sourceUrl?: string
    /** 缩略图展示宽高，取自 .cico 的 style。 */
    width?: number
    height?: number
    /** 原图宽高，取自 detailUrl 的 expw / exph 参数。 */
    originalWidth?: number
    originalHeight?: number
    /** Bing 的图片 ID，取自 detailUrl 的 thid 参数。 */
    id?: string
}

/** 查询纠错提示。hint 与 correctedQuery 都是逐字搬运，不生成。 */
interface QueryCorrection {
    /**
     * 整句提示，由两个 .b_promtxt 按文档顺序拼接。
     * 必须整句给出：单给前段读起来像正常标题，点破「搜错了」的是后段。
     */
    hint: string
    /** Bing 建议的查询词。 */
    correctedQuery: string
}

interface RichCard {
    /** 卡头标题（b_rcGbMod 的 hero 文本）。 */
    title?: string
    /** 卡头链接。 */
    url?: string
    /** 展开的各个分区，上限 20 条。 */
    sections: RichSection[]
    /** 卡片内图片，取自各节点的 data-src。 */
    images?: string[]
}

interface RichSection {
    title: string
    /** 正文。b_richcard 型是多个列表项用换行拼接。 */
    text: string
    url?: string
}

interface SideImage {
    /** 缩略图 URL。 */
    thumbnailUrl: string
    /** 点开后的详情页 URL。 */
    detailUrl?: string
    /** 原图宽高，取自 img 的 data-width / data-height。 */
    width?: number
    height?: number
}

interface LinkItem {
    title: string
    /** 已还原成绝对地址。 */
    url: string
}

/** 主结果里内嵌的视频富摘要，挂在 WebPage.video 上。 */
interface InlineVideo {
    source: 'inline'
    url?: string
    thumbnail?: string
    duration?: string
    site?: string
    uploader?: string
    views?: string
    published?: string
    publishedPrecision?: DatePrecision
    description?: string
}
```

### 时间字段按精度截断

`WebPage.date` / `VideoPage.published` / `NewsPage.time` 不是精确时刻，精度见对应
`*Precision` 字段：`day` → `YYYY-MM-DD`、`hour` → `YYYY-MM-DD HH`、`minute` → `YYYY-MM-DD HH:mm`。
Bing 的相对表述（“6 天之前”）会根据本地时间反推成绝对时间，但不会补伪造时刻。

### 已知边界

- **不支持翻页**：URL 带 `first` 会让 Bing 判定为翻页请求，跳过 AI Overview 与全部富化模块。
- AI Overview 覆盖率约 8%~33%，具体取决于查询内容。

## 开发

```bash
pnpm install

pnpm test          # 全部：类型 + 离线 + 在线（含 24 词压测）≈ 15s
pnpm test:offline
pnpm test:live     # 真实访问 Bing
pnpm build         # → dist/bing.js + dist/bing.d.ts
pnpm lint          # prettier 格式化
```

模块划分、请求协议、解析规则与设计取舍见 [`docs/`](docs/README.md)。

## 免责声明

本项目仅用于**学习与技术研究**，不做大规模抓取、不存储用户数据。
使用前请自行确认符合 Bing 的服务条款与你所在地区的法律法规。
作者不对使用本库产生的后果负责。

## License

[MIT](LICENSE) © Li yan (tq-xyy)
