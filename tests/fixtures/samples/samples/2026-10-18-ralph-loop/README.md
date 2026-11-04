# 2026-10-18 「Ralph 循环」检索样本

真实请求，走生产代码路径 `searchByBing`，无探针、无参数改写。

```bash
npx tsx scripts/tools/bing-search.ts "Ralph 循环"
npx tsx scripts/tools/bing-search.ts "Ralph Wiggum loop"
```

| 文件                   | 命令                      | 说明                                                                       |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------- |
| full-searchresult.json | 临时脚本直调 searchByBing | 完整 SearchResult（含 overview / relatedSearches / images），1672ms，10 条 |
| cli-run-1.json         | CLI「Ralph 循环」         | 1573ms，10 条                                                              |
| cli-run-2-en.json      | CLI「Ralph Wiggum loop」  | 1676ms，10 条                                                              |

## 观测

- 中文查询 10/10 相关，0 条 Ralph Lauren 噪音；snippet 10/10 命中，2 条缺 date。
- 同一查询两次：10 条中 6 条重合，4 条互换 → Bing 结果有轮换，单次检索不足以定论。
- overview 存在，但 `paragraphs` 是列表碎片（`✅ 适合：`），`title` 实为整段摘要。
- 一手源头 ghuntley.com 在中英文查询的前 10 里都没有召回。
- 中文结果与「Ralph Wiggum loop」英文结果只有 2 条交集（知乎 p/1997268040451110553、掘金 7610478822882705450）。
