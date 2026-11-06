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

完整类型参见 [TS 类型定义](https://github.com/tq-xyy/bing-search-reverse/blob/main/types/bing-search-reverse.d.ts)，那是对外契约的唯一出处。三条要点：

- **四型结果共用一套归一化字段**：`type` / `title` / `url` / `snippet` / `site` / `publishedAt`。
  各型特有的字段与纯渲染素材（图标、配图、富卡片、深链接、缩略图）统一收进 `richContents`，
  默认不下发，需要时传 `includeRichContents`。另外两个开关管聚合层级：
  `includeImages` 控制顶层 `images`，`includeVideos` 控制 `pages` 里的 `video` 条目
  （内嵌在网页里的那个视频跟着 `includeRichContents` 走，不受 `includeVideos` 影响）。
- **失败抛错，不返回空结果**：网络错误与 HTTP 错误都会抛出，重试耗尽后同样抛。
  `pages` 为空只表示 Bing 确实没给结果。
- **元信息在顶层**：`entrance` 是实际生效的入口（显式传入或按时区推测），
  `elapsedMs` 是含重试与 PAA 加载的墙钟耗时。

### 时间只有字符串，精度由长度表达

`publishedAt` 不是精确时刻，也不配 `*Precision` 字段——可信到哪一级由字符串长度说明：

| 长度 | 形态               | 含义     |
| ---- | ------------------ | -------- |
| 10   | `2026-10-05`       | 只信到日 |
| 13   | `2026-10-05T14`    | 只信到时 |
| 16   | `2026-10-05T14:30` | 只信到分 |

三种长度的字典序就是时间序，排序不必解析成 `Date`。Bing 的相对表述（“6 天之前”）会按本地
时间反推成绝对时间，但**不补伪造的 `00:00:00`**。

### 已知边界

- **不支持翻页**：URL 带 `first` 会让 Bing 判定为翻页请求，跳过 AI Overview 与全部富化模块。
- **不做结果裁决与可信度打分**：`pages` 就是 Bing 的返回，不额外判定「降级 / 垃圾」。
- **不做时间过滤**：`publishedAt` 在网页结果上是收录/更新日，不是事件发生时间，只能排序参考。
- **不派生 `host` 字段**：来源以 `url` 的 hostname 为准。
- AI Overview 覆盖率约 8%~33%，具体取决于查询内容。

## 开发

```bash
pnpm install

pnpm test          # 全部：类型 + 离线 + 在线（含 24 词压测）≈ 20s
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
