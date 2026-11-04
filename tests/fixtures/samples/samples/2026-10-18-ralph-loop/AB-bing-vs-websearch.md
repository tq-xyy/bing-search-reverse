# A/B：本项目 bing_search vs DSH web_search（2026-10-18）

同一任务、两个隔离的子代理、互斥工具：

- **A**：只能跑 `npx tsx scripts/tools/bing-search.ts`（cn.bing.com 实抓）+ 读文件；禁用 web_search / web_fetch
- **B**：只能用 `web_search`；禁用 web_fetch / 一切本地命令

任务：检索「Ralph 循环」，写 150-250 字解释（是什么 / 谁提出 / 两条实现路径）。

## 原始统计

|          | A（bing_search）   | B（web_search）                                       |
| -------- | ------------------ | ----------------------------------------------------- |
| 查询次数 | 2                  | 4                                                     |
| 耗时     | 1526ms + 1873ms    | 未测                                                  |
| 每次条数 | 10                 | 8（均 `truncated: true`）                             |
| snippet  | 10/10 有           | 0/20 有                                               |
| 顶层摘要 | 无（snippet 已够） | `content: null`                                       |
| 无关条数 | 0/20               | 中文查询 4/8（Ralph Lauren ×2、Hermes、tonybai 分页） |

A 的两次查询：

1. `Ralph 循环` → 知乎/CSDN/掘金/博客园/mistystar/jxxy/goose + GitHub 官方插件
2. `Ralph Wiggum Geoffrey Huntley bash while loop Claude Code` → 一手译文、官方 README、shiqimei 博文（"In July 2025, developer Geoffrey Huntley published a post…"）

B 的四次查询：`Ralph 循环` / `Ralph loop Geoffrey Huntley` / `"Ralph loop" bash while true claude code plugin` / `ralph-wiggum plugin`

## 答案质量

| 结论项                                     | A                                | B                                 |
| ------------------------------------------ | -------------------------------- | --------------------------------- |
| Ralph 是"反复投喂同一 prompt 的循环"       | ✅ 直接读到                      | ✅ 从 awesome-ralph 标题读到      |
| 提出者 Geoffrey Huntley                    | ✅ 一手译文 + README             | ⚠️ 仅 URL slug 佐证，自评中低置信 |
| 官方插件（Stop Hook / completion-promise） | ✅ 机制名词齐全                  | ✅ 命中 bundled 插件页            |
| 外部 Bash 循环（while true + 文件持久化）  | ✅ 明确写出                      | ❌ **零证据，自评存疑**           |
| 提出时间                                   | ⚠️ 发现 7 月 vs 5 月冲突，无裁决 | ❌ 未触及                         |

## 结论

1. **单位调用信息密度：A ≈ 2 倍于 B。** A 两次查询即可写全骨架；B 四次仍缺"外部 Bash 循环"这一半。
2. **分水岭是 snippet。** B 只能从 URL 猜（`ralph-loop-agentic-engineering-geoffrey-huntley`），A 能读到 "In July 2025, developer Geoffrey Huntley published a post…"。
3. **噪声是后端差异，不是关键词差异。** 同一中文查询，B 4/8 无关，A 0/20。
4. **两边都没解决的问题**：一手源头（ghuntley.com/ralph/）与前 10 名无缘，时间冲突需要抓正文裁决——这正是 DSH 原生 fetch 待补的位置。
