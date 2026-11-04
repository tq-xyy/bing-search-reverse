# DS Fetch vs pagedown（2026-10-18）

## DeepSeek /v1/tools/fetch（服务端抓取，返回 Markdown）

| URL                                      | 状态    | 耗时                  | 字符  | 反斜杠转义 | 代码围栏 |
| ---------------------------------------- | ------- | --------------------- | ----- | ---------- | -------- |
| ghuntley.com/ralph/                      | 200     | 249ms（首次 14920ms） | 29234 | **734**    | **0**    |
| goose.ac.cn/.../ralph-loop/              | 200     | 6799ms                | 17165 | 705        | 0        |
| juejin.cn/post/7610478822882705450       | 200     | 3677ms                | 4891  | 107        | 0        |
| zhuanlan.zhihu.com/p/1997375744154833801 | **404** | 100ms                 | —     | —          | —        |

硬伤：

1. 过度转义：`.` `'` `!` `:` 全加反斜杠（`Here\'s` `test\.`），不是合法 Markdown 转义。
2. 代码围栏丢失：bash 循环与代码块都退化成正文。
3. 延迟 249ms～6.8s 波动；中文反爬站 404。

## pagedown（本地私有项目，junction 链入，TS 源码直跑）

```ts
import { html2md } from './pagedown/src/index.ts'
const md = html2md({ html, url })
```

| 源            | 耗时 | 字符  | 反斜杠转义 | 代码围栏 | 标题行 |
| ------------- | ---- | ----- | ---------- | -------- | ------ |
| ghuntley.html | 76ms | 31449 | **33**     | **8**    | 18     |
| juejin.html   | 28ms | 4655  | 7          | 8        | 32     |

- 围栏正确（`while :; do cat PROMPT.md | claude-code ; done` 被 ``` 包住）
- 中文站点适配好：掘金正文干净、无推荐位/导航
- 小瑕疵：仍有零散 `\-` `\?`；个别链接块残留孤立 `[`、文字粘连

## 结论

- DS Fetch 适合「拿正文文本」，不适合「当 Markdown 直接消费」。
- 本地 HTML + pagedown 是更干净的转换层：30～80ms、零 API 成本、可离线重跑；代价是 HTML 得先抓到（反爬站需要 pagedown 自带的 CDP 通道）。
