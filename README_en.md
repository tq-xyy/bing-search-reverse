# bing-search-reverse

English | [中文](README.md)

Scrape `cn.bing.com` search results straight from HTML SSR over `fetch` (undici, h2 via ALPN) —
**no browser required**.

## Features

- **No browser.** No CDP, no Puppeteer, no page scripts. Bing renders results server-side: the first
  pass returns 350–480KB of HTML containing the AI Overview and every enrichment module.
- **~144ms per query** (24 queries × 3 rounds). A pure CDP path costs ~3.3s per query on the same box.
- **Structured output**: result stream (web / PDF / video / news), AI Overview, PAA questions,
  related searches, image aggregation, and query-correction hints.
- **Two entrances**: domestic `cn.bing.com` and international (`ensearch=1`), inferred from the
  runtime time zone by default.
- Runtime dependencies: `htmlparser2`, `css-select`, `tough-cookie`.

## Install

```bash
npm i bing-search-reverse
```

You can also install straight from GitHub (the `prepare` script builds on install):

```bash
npm i github:tq-xyy/bing-search-reverse
```

The npm release ships prebuilt artifacts; on the GitHub path `dist/` is not committed and the
`prepare` script builds it during install.

> **pnpm ≥ 12 users** (GitHub path only): build scripts of git dependencies are blocked by default,
> which fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. Allow it in `pnpm-workspace.yaml`
> (the key must be the full package spec):
>
> ```yaml
> allowBuilds:
>     'bing-search-reverse@git+https://github.com/tq-xyy/bing-search-reverse': true
> ```

Requires Node **≥ 20.19**. The package is ESM, but both styles work:

```js
import { searchByBing } from 'bing-search-reverse' // ESM
const { searchByBing } = require('bing-search-reverse') // CJS
```

## Usage

```ts
import { searchByBing } from 'bing-search-reverse'

const r = await searchByBing('vector database internals')

for (const p of r.pages) console.log(p.type, p.title, p.url)
r.overview?.paragraphs // AI Overview body, may be absent
r.relatedQuestions[0].answer // PAA answer body, loaded by default
```

## API

```ts
searchByBing(query: string, options?: SearchOptions): Promise<SearchResult>

interface SearchOptions {
    /** Entrance: 'cn' domestic / 'international'; inferred from the runtime time zone by default. */
    bingEnterance?: 'cn' | 'international'
    /** Load PAA answer bodies (default true). */
    loadRelatedAnswers?: boolean
    /** Concurrency limit for PAA answer loading (default 3). */
    relatedAnswerConcurrency?: number
    /** All three include* flags: off by default, kept only when explicitly true. */
    includeIcons?: boolean
    includeImages?: boolean
    includeVideos?: boolean
}

interface SearchResult {
    pages: SearchResultPage[] // result stream, document order
    overview?: Overview // AI Overview, present for roughly 8%–33% of queries
    relatedQuestions: RelatedQuestion[] // PAA, answer bodies loaded by default
    relatedSearches: string[] // observed 0–10 entries (long queries often yield 0)
    images?: ImageCard // top-level aggregation, never inside pages
    correct?: QueryCorrection // Bing's typo-correction hint
}

type SearchResultPage = WebPage | PdfPage | VideoPage | NewsPage

interface WebPage {
    type: 'page'
    title: string
    url: string // decoded (ck/a redirects resolved)
    snippet?: string
    date?: string // Bing's index/update date, truncated to precision
    datePrecision?: DatePrecision
    site?: string // Bing's display name, possibly mislabelled; trust the URL hostname
    favicon?: string
    sideImage?: SideImage
    rich?: RichCard // rich card (expanded sidebar content)
    links?: LinkItem[] // in-card sub-links, capped at 20
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
    paragraphs: string[] // body blocks, Markdown fragments
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

/** Query-correction hint: hint is one sentence assembled from two fragments, correctedQuery is the suggestion. */
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

### Failure semantics

- Network / server failures after retries exhausted → **empty `pages`**, no throw. Callers test
  `pages.length === 0`.
- PAA answer loading failures only drop `answer` / `citations`; the question itself survives.
- **Parser exceptions propagate** — those are bugs, not "no results".

### Time fields are truncated to precision

`WebPage.date` / `VideoPage.published` / `NewsPage.time` are not exact instants; see the matching
`*Precision` field: `day` → `YYYY-MM-DD`, `hour` → `YYYY-MM-DD HH`, `minute` → `YYYY-MM-DD HH:mm`.
Relative wording on Bing ("6 days ago") is resolved to absolute time, but no `00:00` is fabricated.

### Known limits

- **No pagination**: adding `first` makes Bing treat the request as a page turn and skip the AI
  Overview and all enrichment modules.
- No result ranking / trust scoring, no time filtering, no derived `host` field.
- AI Overview coverage is roughly 8%–33%, depending on the query.

## Development

```bash
pnpm install

pnpm test          # everything: types + offline + live (incl. 24-query stress) ≈ 15s
pnpm test:offline  # offline only ≈ 2s (when touching parsers)
pnpm test:live     # live only ≈ 12s (when touching the request layer)
pnpm build         # → dist/bing.js + dist/bing.d.ts
pnpm lint          # prettier
```

Manual single query:

```bash
npx tsx only_for_develop_fast_test.ts "your query"
```

> Developing this repo needs **Node ≥ 22** — `node --test` only gained glob support in 22
> (`tests/offline/**/*.test.ts`). The library itself works on 20.19; only the test scripts fail to
> discover files.
>
> `pnpm test:live` hits `cn.bing.com` for real; datacenter IPs are easily rate-limited.

Module layout, request protocol, parsing rules and design trade-offs live in [`docs/`](docs/README.md).

## Disclaimer

This project is for **learning and technical research**. It does not perform large-scale crawling,
bypass paywalls, or store user data. Check that your use complies with Bing's terms of service and
the laws of your jurisdiction. The author accepts no liability for any consequences of using this
library.

## License

[MIT](LICENSE) © Li yan (tq-xyy)
