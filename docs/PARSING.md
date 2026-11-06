# 页面解析

## 文本化：块级元素补空格，行内元素不补

解析走 `htmlparser2` + `css-select`：正则没有计数器，做不到按标签深度配对；剥标签还会在标题的 `<strong>` 高亮处劈出空格——49 条标题里有 42 条踩到。

**唯一的文本化入口**（`text()`）与 `DomUtils.textContent` 的差别只有一条：

- **块级**元素（`br`/`p`/`div`/`li`/`h2`…）边界补一个空格 → 否则 snippet 的多行会粘连
- **行内**元素（`strong`/`b`/`em`/`span`/`a`）边界不补 → 否则高亮词会和相邻文字被劈开

这条规则是“空格在标签内还是标签外”的直接翻译：
`<strong>洛天依</strong> 官网` 里的空格**在标签外**，只删标签就自动保留；
`<strong>洛天依</strong>歌手` 本来就没有空格，删标签后自然贴上。

## 时间：按精度截断，不伪造时刻

Bing 的时间有三种写法，页面上**没有**机器可读的绝对时间：

| 写法                           | 出现位置          | 输出（精度）          |
| ------------------------------ | ----------------- | --------------------- |
| `2026年8月17日` / `2026-09-20` | 静态页面          | `2026-08-17`（day）   |
| `6 天之前` / `1 天前`          | 近期页面          | 按 `nowMs` 反推，day  |
| `10 小时之前` / `8 小时`       | 近期页面 / 资讯卡 | 按 `nowMs` 反推，hour |

**唯一的时间解析函数**（`parseDateTime()`）返回 `{ value, precision }`：

- **值按精度截断**：day→10 位、hour→13 位、minute→16 位；日期与时钟之间用大写
  `T` 分隔（`2026-10-17T04`）。不用空格：`T` 形态是合法的 ISO 8601 前缀，
  补上 `:00` 就能直接喂 `new Date()`。
- 字符串仍是**前缀可比**的：字典序 == 时间序，排序不需要解析成 Date
- 月按 30 天、年按 365 天近似；误差上限是一个精度单位（day 精度 ±1 天）
- 认不出的（“昨天”、“刚刚”、“3 days ago”）返回 `undefined`，**不猜**
- 搜索结果的日期前缀必须满足「行首 + 后接 `·`」，否则正文年份会被误判
  （见 `extractDatePrefix`）；资讯卡 footer 形如 `凤凰网科技 · 10 小时`，
  时间取最后一个 `·` 之后

对外的四型结果统一用 `publishedAt`，**不保留相对原文，也不带 `*Precision` 字段**——
可信到哪一级由字符串长度自证（10 位 day / 13 位 hour / 16 位 minute），
与 `trimByPrecision` 的截断口径一一对应。精度存两遍会出现自相矛盾
（`{ value: '2026-10-05', precision: 'minute' }` 类型合法但语义非法），故只留一份。

**语义边界**：网页结果的 `publishedAt` 是 Bing 的页面收录/更新日，不是内容所指事件的发生时间；
**很多条目本来就没有该字段**（缺失 = Bing 没给）。所以它只能做排序参考，
不足以当过滤判据——把「没有 publishedAt」当成「不满足时间条件」是错的。

**明确不做**：不派生 `host` 字段（`new URL(url).hostname` 永远正确，重复信息）；
不做时间过滤、不做可信度打分。

## 来源：以 url 为准

`site` 透传 Bing 的 `.tptt` 展示名，**实测会错标**：`query.libretexts.org` 被标成
「知乎专栏」、两条 LibreTexts 结果被标成「知乎」。

但不需要为此新增字段：页面地址就在 `url` 里，`new URL(url).hostname` 永远正确。
按站聚合、去重、抓取分档都从 url 取 host。

## 容器枚举与分流

顶层先枚举结果流容器，再按 class 分流。字段级选择器仍留在各提取器内。

```
items = #b_results > li  +  .b_results_eml > li        （文档顺序）
      （为空时回退全页 li.b_algo, li.b_ans）
```

枚举只有这 5 行，直接写在 `parse/index.ts` 的 `collectContainers()` 里。

### 三类组件，三种相处方式

`parseSearchPage` 的主体就是这三段的顺序执行，没有中间抽象层：

| 类别     | 输入           | 产出               | 成员                                                    |
| -------- | -------------- | ------------------ | ------------------------------------------------------- |
| **卡片** | 一个容器       | 0~N 条，进 `pages` | wpt / news / video / algo                               |
| **全局** | 整页或容器列表 | 一个顶层字段       | overview / relatedQuestions / relatedSearches / correct |
| **聚合** | 容器集合       | 一个顶层字段       | images                                                  |

卡片之间**顺序即语义**：

```ts
for (const item of items) {
    wpt  → 只收带 .b_tpcn 来源行的主结果块
    news → 资讯可嵌在 b_algo 里，与 page 不互斥
    video（class 含 b_vidAns）→ 产出后 continue，与 algo 互斥
    algo（class 含 b_algo）→ 一条 WebPage 或 PdfPage（看 [PDF] 标记）
}
```

| 容器                                         | 分流目标                                                |
| -------------------------------------------- | ------------------------------------------------------- |
| class 含 `b_algo`                            | `WebPage` 或 `PdfPage`（主结果；素材在 `richContents`） |
| class 含 `b_vidAns`                          | 视频卡 → 每条展开为 `VideoPage`                         |
| 容器内 `a.nscjk_card_link` / `a.nscard_link` | 资讯 → 每条展开为 `NewsPage`                            |
| 容器内 `#df_listaa`                          | PAA → 顶层 `relatedQuestions`                           |
| 容器内 `.cht_text` / `.gs_text`              | 顶层 `overview`（cht 优先，gs 次之）                    |
| `#brsv3` / `#inline_rs`                      | 顶层 `relatedSearches`（brsv3 优先）                    |
| class 含 `b_imgansacf`                       | 顶层 `images`（聚合，不进入 pages）                     |

关键点：

- **必须同时枚举 `.b_results_eml`**：dsv41 的资讯卡整个在
  `ol#b_topw.b_results_eml` 里，只枚举 `#b_results` 会漏 3 条。
- **视频卡按 class 而不是“有没有 h2 a”分流**：视频卡容器内有 2 个
  `.btitle` 的 `h2 a`，按内容特征会把视频当主结果。
- 一个容器可以同时进入多个内容模块（PAA/news/overview 不互斥）。
- **相关搜索必须分组枚举**：`#brsv3`（可见，8~10 条）是 `#inline_rs`
  （隐藏，6 条）的超集。写成 `all('#brsv3, #inline_rs', doc)` 会按文档顺序
  混排，隐藏容器在前时就会先命中它——所以用 `['#brsv3','#inline_rs']`
  逐个 `all` 再拼接。

新增卡片类型要做什么：在 `parse/index.ts` 的循环里加分支，并补一个离线样本。

### pages 生成规则

- `li.b_algo` → 1 条 `WebPage`（type:'page'）；**带 `.sb_doct_txt` 标记的则是 `PdfPage`（type:'pdf'）**
- `li.b_vidAns` → 卡内每个视频 1 条 `VideoPage`（type:'video'）；**卡头本身不输出**。
  卡头那两个链接（`<查询词> 的视频` 与「更多视频」）都只是
  `/videos/search?q=<查询词>` 的两种写法，能从 query 推出来，故不进契约
- 资讯 → 每条 1 条 `NewsPage`（type:'news'）
- 内嵌视频不单独成条，放 `WebPage.richContents.video`
- 图片卡不进入 pages，保持顶层 `images`

## 文档型主结果（`type:'pdf'`）

Bing 会给一部分主结果打文件类型标记——样本里只有 `[PDF]`：

```html
<div class="b_title">
    <span class="sb_doct_txt">[PDF]</span>
    <!-- 标记；国际版是 sb_doct_txt b_float -->
    <h2><a href="…/090631-01.pdf">决策树 - 清华大学出版社</a></h2>
</div>
```

产物是 `PdfPage`（`type:'pdf'`），**字段与 `WebPage` 完全同构**，只有判别值不同。
两条形状差异只存在于解析层：`PdfPage` 是 `Omit<WebPage,'type'> & { type:'pdf' }`，
所以「PDF 有没有 snippet/site/rich」跟着正文页走，不需要各写一套。

**判别只认标记，不看 URL 后缀。** 理由是定位：我们是 Bing 的封装，Bing 打什么标就信
什么标；后缀只是站点自己的命名习惯（`/serve?id=42` 也可能是 PDF）。现有样本里两者
3/3 重合（国际版那条被 `ck/a` 包着，解出来同样是 `.pdf`），**互相印证但无法互相证伪**
——所以离线用例锁的是「标记决定 type」这个语义，包括：
标记在而 URL 不是 `.pdf` → `pdf`；URL 像 PDF 而没有标记 → `page`。

三条实现细节：

- 标记是 `h2` 的**兄弟节点**，不在标题里，所以 `text(h2 a)` 天然不含 `[PDF]`；
  标记文本**不进任何输出字段**。
- class 是**多值**（`sb_doct_txt b_float`），按类名匹配、按文本定类型，不能等值比 class。
- 类型映射表只有 `'[PDF]' → 'pdf'` 一项。没见过的标记（`[DOC]`/`[XLS]`/`[PPT]`）
  **一律按 `page` 处理**，不猜、不提前建类型；线上至今也只见过 PDF。

判别和字段提取在**同一次**遍历里完成（`extractWebDigest` 返回 `{ docType, fields }`）：
wpt 网格与结果流都会把同一个块喂进来，拆成「先问类型再取字段」会白跑两遍 DOM 查询。

`type` 是下游分叉的依据。出口裁剪**不按 type 分派**：它统一删掉每条结果的
`richContents`，PDF 与网页走同一条路径，不存在"漏了 pdf 就逃过裁剪"的可能。
`tests/offline/parsers.test.ts` 有一条用例专门盯 PDF 的素材也被裁掉。

## 新增组件与字段来源

| 字段                               | 来源                                                                         | 说明                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `WebPage.richContents.favicon`     | `li.b_algo .cico.siteicon .rms_iac[data-src]`（退 `.wr_fav`、`img.res_img`） | Bing ODF URL，原样输出；离线样本 80/80 覆盖                         |
| `WebPage.richContents.sideImage`   | `li.b_algo > .b_imgcap_altitle > .b_imgcap_img`                              | 图文并排的缩略图；`detailUrl` 是点击目标（Bing 图片详情页或来源页） |
| `WebPage.richContents.rich`        | `.b_rcGbMod`（hero + 卡片）/ `.b_richcard`（tabs + b_vList）                 | 单条结果的展开；两形态统一为 sections                               |
| `WebPage.richContents.links`       | `.b_vtl_deeplinks a` / `.b_vlist2col.b_deep a`                               | 深链接/扩展链接；当前样本时有时无，存在才填                         |
| `WebPage.richContents.video`       | `.rc_videocap`                                                               | 内嵌视频富摘要，不拆条                                              |
| `NewsPage.richContents.favicon`    | `img.pubimg[data-src-hq]`                                                    | 相对 `/th?...` 补 `https://www.bing.com`                            |
| `NewsPage.richContents.thumbnail`  | `.imagewrap img.itm_img[data-src-hq]`                                        | 右侧配图；只有 `nscjk` 变体下发，`nscard` 变体没有                  |
| `VideoPage.richContents.thumbnail` | `.mc_vtvc_th .cico .rms_iac[data-src]`                                       | 视频封面                                                            |
| `VideoPage.richContents.favicon`   | `.cico.siteicon .rms_iac[data-src]`（退 `.wr_fav`）                          | 当前样本不下发，有则填；不编造选择器                                |
| `Overview.citations[].favicon`     | `img.md_citlink__fav-img[data-src]` / `.gs_cit .rms_iac[data-src]`           | 来源图标                                                            |
| `Overview.citations[].title`       | 无                                                                           | 引用链接里只有图标与站点名，没有页标题；**留空不猜**                |
| `SearchResult.relatedQuestions[]`  | `#df_listaa .acf-accn-itm`                                                   | 问题 + 来源 URL（`.b_paa_ansContainer[data-url]`）                  |
| `…relatedQuestions[].answer`       | `POST /getanswerforclickedquestion` 的 `.paa-txt`                            | 异步加载，见 [PROTOCOL.md](PROTOCOL.md) 的「PAA 答案接口」          |

## 深链接/扩展链接的限制

用户可能在浏览器里看到 `li.b_algo.b_vtl_deeplinks.qbrs`，但服务端响应并不稳定下发该节点。
解析层只做“存在则解析”：未下发即没有，不承诺覆盖率。

## 字段选择器表

顶层锚点（容器枚举与分流）在唯一的整页解析入口里
与紧随其后的卡片循环里。下面列的是各提取器内部的**字段级**选择器——
它们是局部结构，不是顶层锚点，页面结构变化时改这里。

### 主结果

| 目标      | 选择器                    | 备注                                                        |
| --------- | ------------------------- | ----------------------------------------------------------- |
| 条目      | `li.b_algo`               | class 是**多值**（`b_algo b_rc_gb_template`），不能精确等值 |
| 标题/链接 | `h2 a`                    | href 可能是 `/ck/a` 重定向，需解码                          |
| 摘要      | `p[class*="b_lineclamp"]` | 数字变体 2/3/4 都认                                         |
| 站点名    | `.tptt`                   | 是**注册域**（zhihu.com），不是完整主机名                   |
| 文档标记  | `.sb_doct_txt`            | 文本 `[PDF]` → `type:'pdf'`；见上文                         |

### 相关搜索

| 容器         | class          | 条数 | 说明                 |
| ------------ | -------------- | ---- | -------------------- |
| `#brsv3`     | `b_rs rsExplr` | 8    | **可见**，优先取     |
| `#inline_rs` | `b_hide`       | 6    | 被隐藏，是前者的子集 |

词在 `.b_suggestionText` 内，可能含 `<strong>`，**不能补空格**。

### 视频

| 目标        | 选择器                           | 备注                                             |
| ----------- | -------------------------------- | ------------------------------------------------ |
| 卡片        | `li.b_vidAns`                    | 必须先锁定它，再取 `.mc_vtvc`                    |
| 条目        | `.mc_vtvc`                       | 卡尾 `<template>` 里也有同名元素，需排除         |
| 链接/aria   | `a.mc_vtvc_link`                 | aria-label 是超长拼接串，只作兜底                |
| 标题        | `.mc_vtvc_title` 的 `title` 属性 | 比取文本干净                                     |
| 时长        | `.mc_bc.items`                   | “5:31” / “2:40:13”                               |
| 站点/上传者 | `.mc_vtvc_meta_channel span`     | 第 2 个带 `mc_vtvc_meta_row_channel`             |
| 播放量      | `.meta_vc_content`               | —                                                |
| 发布时间    | `.meta_pd_content`               | —                                                |
| 内嵌视频    | `li.b_algo .rc_videocap`         | 标题取 b_algo 的 h2；作者/播放量在 `.b_factrow`  |
| 封面        | `.mc_vtvc_th .cico .rms_iac`     | `data-src`；进 `richContents.thumbnail`          |
| 卡头        | `.btitle`                        | **不输出**：标题与「更多视频」都只是查询词的函数 |

### 资讯

两个变体的类名完全不同，必须都认：

| 变体       | 链接类            | 标题                               | 时间           |
| ---------- | ----------------- | ---------------------------------- | -------------- |
| 嵌在结果流 | `nscjk_card_link` | `.nscjk_card_title` 或 `titletext` | `.cap_txt`     |
| 独立资讯块 | `nscard_link`     | `.nscard_caption`                  | `.news_footer` |

来源取 `<cite>` 的 `title` 属性——cite 里嵌了 base64 占位图，不能取文本。

两张变体的配图位置也不同：`nscjk` 在标题右侧的 `.imagewrap img.itm_img[data-src-hq]`，
`nscard` 没有配图。**两者都进 `richContents.thumbnail`**，不参与 `snippet`。

### 图片

| 目标     | 选择器                                  | 备注                                                                 |
| -------- | --------------------------------------- | -------------------------------------------------------------------- |
| 卡片     | `li.b_imgansacf`                        | —                                                                    |
| 条目     | `a.iacf_imglnk`                         | 只认它内部的 `data-src`                                              |
| 缩略图   | `[data-src]`                            | 卡内**没有 `<img>`**，且共 11 个 data-src（10 真图 + 1 个 svg 图标） |
| 标题     | `.imgInfo` 的 `title` → `a[aria-label]` | —                                                                    |
| 显示尺寸 | `.cico` 的 `style`                      | “width:122px;height:128px”                                           |
| 原图     | detailUrl 的 `mediaurl` 参数            | 只解一层；R-C 代理时内部 `riu` 再解一层                              |
| 原图尺寸 | `expw` / `exph`                         | —                                                                    |

### 答案摘要

两套完全不同的 DOM：

| 类型                         | 容器        | 正文                                                | 引用                                                 |
| ---------------------------- | ----------- | --------------------------------------------------- | ---------------------------------------------------- |
| `cht_*`（AI Overview）       | `.cht_text` | Markdown 片段：`p` / `ul,ol` / `pre>code` / `h2,h3` | `a.md_citlink` 的 href，站点名在 `.md_citlink__site` |
| `gs_*`（Generative Summary） | `.gs_text`  | `.gs_p`                                             | `.gs_cit` 的 `data-url`                              |

只支持 cht 型时，gs 型答案卡会被整体判为“没有 overview”。

cht 型正文是 **Markdown 渲染结果**，`paragraphs` 直接还原成 Markdown 片段
：

| 原 DOM           | 输出                                                       |
| ---------------- | ---------------------------------------------------------- |
| `h2`（首个除外） | `## …`                                                     |
| `h3`             | `### …`                                                    |
| `ul` / `ol`      | `- …` / `1. …`，嵌套列表缩进 4 空格                        |
| `p`              | 段落原文                                                   |
| `pre>code`       | 围栏代码块，语言取 `.cht_codblk_lang`（`Code` 视为无语言） |

- 只取 `p` 会把「✅ 适合：」这类引导句留下、紧跟的列表内容整段丢掉。
- 以冒号结尾的引导句与**紧邻**的列表/代码块放在同一段（换行分隔）；
  中间隔着 `h2/h3/hr` 不合并。
- 首个 `h2` 是 `title`，不重复输出成 `##`。
- 代码块只取 `code.md_codblk`，不带「Code / 复制」工具栏。
- 引用链接子树（`.md_citlink`）不参与正文——同一批链接稍后还要取来源站名，不能就地清空。

用 htmlparser2 的 `decodeEntities`（默认开），**不需要 `entities` 包**。
例外：`&#0183;` 是**八进制**字符引用（= “·”）；手工把未解码的原始片段喂给
`extractDatePrefix` 时，它内部会做一次归一化（见 `normalizeDateSeparators`）。

## 覆盖率

这些数字来自 `tests/fixtures/samples/cards`（5 份）、`cards2`（3 份）与
`cards3`（9 份），**不是保证**：

| 模块     | 覆盖率（cards/cards2） | 说明                                      |
| -------- | ---------------------- | ----------------------------------------- |
| 主结果   | 8/8                    | 每页最多 10 条                            |
| 站点图标 | 8/8（每条 page）       | `.cico.siteicon .rms_iac[data-src]`       |
| 相关搜索 | 4/5                    | 0~10 条（实测出现过 10；长 query 常为 0） |
| 视频卡   | 3/5                    | 强查询依赖                                |
| 内嵌视频 | 3/5                    | 与视频卡**不重合**                        |
| 资讯     | 2/5                    | 强查询依赖                                |
| 图片卡   | 1/5                    | 仅“可视觉化实体”查询                      |
| 答案摘要 | 2/5                    | 约 8%~33%                                 |

cards3 补充的组件覆盖（9 份样本）：

| 组件                 | 命中 | 样本                                            |
| -------------------- | ---- | ----------------------------------------------- |
| PAA（`#df_listaa`）  | 4/9  | VCP / 决策树算法 / 什么是向量数据库 / Redis…    |
| 富化 `rich`          | 4/9  | 决策树算法 / 苏轼 / 决策模型 / 什么是向量数据库 |
| 图片侧栏 `sideImage` | 1/9  | 苏轼（2 条）                                    |
| 深链接 `links`       | 3/9  | VCP / 北京天气 / 美元人民币汇率                 |
| 资讯展开             | 2/9  | 决策模型 / 父母欠薪…（各 5 条）                 |

cards4（4 份）专测**「我们不解析的卡片」的兼容性**：

| 样本               | 首屏顶部卡片                          | 卡片内部                                   | 结果                                               |
| ------------------ | ------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `compromise`       | 词条卡 `b_ans b_top`                  | `common-module-maindef` 那套 DOM           | 无 `h2 a`/`.tptt` → 不进 pages；主结果满 10 条     |
| `美元对人民币汇率` | 汇率卡 `b_ans b_top b_topborder`      | `fin_sccl` / `currencyPanel`               | 同上；overview 由**另一个**容器 `b_ans b_mop` 产出 |
| `青衣 歌词`        | 视频卡 `b_ans b_vidAns`               | `.mc_vtvc` ×3                              | 3 条 video + 10 条 page                            |
| `Pyton socket`     | 纠错卡 `#b_suptop` + wpt 网格 `b_ans` | `.sp_requery`/`.sp_recourse` + `.b_wpt_bl` | `correct` 字段 + wpt 主结果收进 pages              |

### 为什么“不解析”也要测

词条卡与汇率卡都**没有 `h2 a`、没有 `.tptt`**，靠 `common-module-*` / `fin_*` 那套 DOM
渲染，`extractWebDigest` 因此收不到它们。断言锁住这条性质：**新卡片类型出现时，主结果集不能多一条也不能少一条。**

### 纠错提示（`SearchResult.correct`）

打错字时（实测 `Pyton socket` → `Python socket`），Bing 把一个句子**拆成两个**
`.b_promtxt` 下发：

```html
<div class="b_promtxt sp_requery">以下是 <a>Python socket</a> 的结果。</div>
<div class="b_promtxt sp_recourse">改为搜索 <a>Pyton socket</a>?</div>
```

→ 用户看到的是拼起来的整句：「以下是 Python socket 的结果。改为搜索 Pyton socket?」

**两段必须一起给**。只给前段（“以下是 X 的结果。”）读起来像正常结果页的标题，
**没有明示“你搜错了”**——正是后段的“改为搜索 …?”点破这件事。

文案是**灰度可变的**，同一查询先后见过两套：

| `.sp_requery`     | `.sp_recourse`       |
| ----------------- | -------------------- |
| 以下是 X 的结果。 | 改为搜索 Y?          |
| 包含 X 的结果。   | 是否只需要 Y 的结果? |

所以 `extractCorrection` **只认结构不认字面**：两个 `.b_promtxt` 的 `text()`
按文档顺序拼接，中间不加任何分隔符（原文本来就是这样断的）。

`correct` 只有两个字段：

- `hint` — 两段拼接后的整句，逐字搬运；
- `correctedQuery` — `.sp_requery` 里链接的文本，即 Bing 建议改搜的词。

**不给 URL**：拿到 `correctedQuery` 后拼搜索地址是调用方一行的事，库不替它决定
域名与参数形态。**不导出链接本身**：`.sp_recourse` 的 href 带 Bing 内部编码
（`filters=rcrse:"1"`），不是该暴露的形态。

正常查询没有这个块，字段不存在；缺链接文本（无从告诉调用方该搜什么）也不算纠错。

### wpt（杂志式首屏）网格里的主结果

纠错页（以及部分首屏）会把结果铺成 `.b_wpt_container` 网格，每个 `.b_wpt_bl`
块是不同内容：AI 摘要卡、视频卡、相关搜索卡、**主结果**。判别主结果的唯一
可靠信号是**来源行 `.b_tpcn`**（AI 摘要卡里也有 `h2 a`，不能只看标题链接）。
wpt 网格主结果会被单独遍历一遍 `.b_wpt_bl`，只收带 `.b_tpcn`
的块。实测 `Pyton socket` 因此多收 1 条（CSDN），`pages` 从 9 变 10。

### 附带发现：`text()` 会把 `<style>` 算进文本

`text(parse('<div><style>.x{color:red}</style><p>正文</p></div>'))`
= `".x{color:red} 正文"`。纠错卡内部有一个 7.4 万字符的 `<style>`。目前
不泄漏到任何输出字段（提取器都走具体选择器，不取整容器文本）；但一旦有卡片
走 `readGs` 的“整段文本”兜底分支，CSS 会进 `overview.paragraphs`。真实样本里
`.gs_text` 内部暂无 `<style>`。
