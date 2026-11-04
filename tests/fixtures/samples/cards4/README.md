# cards4：词条卡 / 汇率卡 / 模糊歌词 / 错别字

四个真实响应（2026-10-24 抓取，cn.bing.com）。共同的用途是**验证解析器对
"我们不解码的卡片" 的兼容性**：卡片本身不求解析，但不能污染或吞掉主结果。

| 文件                    | 查询                        | 首屏顶部卡片                                                                          | 预期                                    |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| `青衣 歌词.html`        | `我给你唱一曲 如游丝的气息` | 视频答案卡（3 条）+ AI Overview                                                       | 词条卡非目标，overview 必须仍产出       |
| `compromise.html`       | `compromise`                | **词条卡**（`b_ans b_top`，`common-module-maindef`）                                  | 词条卡不产出 pages，主结果 10 条完整    |
| `美元对人民币汇率.html` | `美元对人民币汇率`          | **词条卡**（`b_ans b_top`，`fin_sccl`/`currencyPanel`）+ AI Overview（`b_ans b_mop`） | 汇率数值不出现在 pages；overview 仍产出 |
| `Pyton socket.html`     | `Pyton socket`（错别字）    | 纠错卡（`#b_suptop` 提示 + `b_ans` 里的 wpt 网格）                                    | `correct` 字段 + wpt 主结果收进 pages   |

## 为什么需要它们

1. **词条卡 / 汇率卡是"我们不解析的卡片"**：两种卡都是 `b_ans b_top` 容器，
   内部**没有 `h2 a`、没有 `.tptt`**，而是 `common-module-*` / `fin_*` 那套 DOM。
   它们天然不会被 `extractWebPage` 收走——这正是要锁住的性质：**新卡片类型
   出现时，主结果集不能因此少一条或多一条**。

2. **纠错卡（打错字）已经支持**（2026-10-24）：
    - `.sp_requery` + `.sp_recourse` 两段拼成 `SearchResult.correct.hint`
      （只有 `hint` + `correctedQuery`），文本**原样搬运**，不生成，也不给 URL。
    - 首屏 wpt 网格（`li.b_ans` 里的 `.b_wpt_bl`）中**只有带 `.b_tpcn` 来源行
      的块**是主结果，被 `extractWptResults` 收进 `pages`（实测 CSDN 那条）。

## 纠错页的结构（Pyton socket）

```
li.b_ans
  div.b_promtxt.sp_requery    「包含 <a>Python socket</a> 的结果。」
  div.b_promtxt.sp_recourse   「是否只需要 <a>Pyton socket</a> 的结果?」
      ↓ 两段拼接 → SearchResult.correct.hint
      ↓ 前段链接文本 → SearchResult.correct.correctedQuery

ol#b_topw.b_results_eml > li.b_ans（wpt 杂志网格）
  div.b_wpt_bl × 4
    [0] AI 摘要卡（.b_acf_card，有 h2 a，无 .b_tpcn）  → 不收
    [1] 视频卡（.mc_vtvc）                              → 不收
    [2] 相关搜索卡（.rsac_card）                        → 不收
    [3] 主结果（.b_tpcn + h2 a）                        → extractWptResults 收
```

> 样本里存的是**旧文案**（「包含…/是否只需要…?」）。Bing 灰度到新版
> （「以下是…/改为搜索…?」）时，解析器**不需要改**——它只认那两个 class。
> `tests/offline/parsers.test.ts` 里有一条内联 HTML 用例专门锁这两套文案。

## 附带发现（未修）：`text()` 会把 `<style>` 算进文本

`text(parse('<div><style>.x{color:red}</style><p>正文</p></div>'))`
= `".x{color:red} 正文"`。纠错卡内部有一个 7.4 万字符的 `<style>`。目前
不泄漏到任何输出字段（提取器都走具体选择器，不取整容器文本）；但一旦有卡片
走 `readGs` 的"整段文本"兜底分支，CSS 会进 `overview.paragraphs`。真实样本里
`.gs_text` 内部暂无 `<style>`。

## 断言在哪

`tests/offline/parsers.test.ts` 的「13. 词条卡与特殊查询」一节。
