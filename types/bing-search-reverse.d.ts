export function searchByBing(
    query: string,
    options?: SearchOptions
): Promise<SearchResult>

interface SearchOptions {
    /**
     * 入口：'cn' 国内版 / 'international' 国际版。
     * 默认按运行时的时区推测：中国大陆与港澳台 → 'cn'，其余 → 'international'。
     */
    bingEntrance?: 'cn' | 'international'
    /** 是否加载 PAA 答案正文（默认 true）。关掉能省一轮请求。 */
    loadRelatedAnswers?: boolean
    /** PAA 答案并发上限（默认 3）。 */
    relatedAnswerConcurrency?: number
    /**
     * 保留素材与富化块（默认 false）：各型 ResultItem 的 richContents，
     * 以及 overview / relatedQuestions 里引用的来源图标。
     *
     * 这些东西不是检索数据：favicon 覆盖率 96% 但占返回字符数约 13%，
     * sideImage 只有约 3%，rich 约 4%，内嵌 video 只出现在偶尔的图文查询里。
     * 只在还原版式或展示站点图标时需要打开。
     */
    includeRichContents?: boolean
    /** 保留顶层 images 图片卡（默认 false）。单次可达返回字符数 60%。 */
    includeImages?: boolean
    /** 保留 type:'video' 的视频条目（默认 false）。不影响内嵌视频。 */
    includeVideos?: boolean
}

interface SearchResult {
    /** 实际生效的入口：显式传入的，或按运行时时区推测出来的。 */
    entrance: 'cn' | 'international'
    /** 整个调用的墙钟耗时（毫秒），含重试与 PAA 加载。 */
    elapsedMs: number
    /** 结果流，文档顺序。四型混排，用 type 判别。 */
    pages: (WebPage | PdfPage | VideoPage | NewsPage)[]
    /** AI 摘要。覆盖率约 8%~33%，查询不触发时整个字段缺失。 */
    overview?: {
        /** 两套 DOM，正文形态不同：'cht' 是 Markdown 渲染，'gs' 是分段文本。 */
        kind: 'cht' | 'gs'
        /** 摘要标题。gs 型缺标题时会取正文首 80 字。 */
        title: string
        /** 正文块，Markdown 片段。列表、代码块、## 标题都已还原成 Markdown。 */
        paragraphs: string[]
        /** 引用来源，按 URL 去重。 */
        citations: {
            title?: string
            /** 来源站点名。 */
            site?: string
            url: string
            /** 来源图标。默认不下发，需 includeRichContents。 */
            favicon?: string
        }[]
    }
    /** PAA（用户还问）。答案正文默认已加载；加载失败只丢 answer。 */
    relatedQuestions: {
        /** 问题原文。 */
        question: string
        /** 答案来源页 URL，来自 .b_paa_ansContainer 的 data-url。 */
        sourceUrl?: string
        /** 答案正文。默认已加载；加载失败时该字段缺失，问题本身仍保留。 */
        answer?: string
        /** 答案里引用的来源列表。 */
        citations?: {
            title?: string
            /** 来源站点名。 */
            site?: string
            url: string
            /** 来源图标。默认不下发，需 includeRichContents。 */
            favicon?: string
        }[]
    }[]
    /** 相关搜索词。实测 0~10 条，长 query 常为 0。 */
    relatedSearches: string[]
    /** 图片卡，顶层聚合，不进入 pages。默认被裁掉。 */
    images?: {
        /** 卡头标题。 */
        title: string
        /** 卡头链接，指向「查看更多图片」。Bing 还会下发一个只差 FORM 参数的
         * 「更多」链接，两种写法指向同一个搜索页，故不单独暴露。 */
        url?: string
        /** 图片条目，上限 20 条，按缩略图 URL 去重。 */
        items: {
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
        }[]
    }
    /** Bing 判定"打错字"时的纠错提示。正常查询缺失。 */
    correct?: {
        hint: string
        /** Bing 建议的查询词。 */
        correctedQuery: string
    }
}

/**
 * 四型结果共同的归一化形状。
 *
 * 这六个字段是唯一跨类型稳定的信息；其余全部收进 `richContents`（默认不下发）。
 * 同名不同义只有一处：`publishedAt` 在网页型上是收录日、在视频/资讯型上是发布时刻，
 * 见该字段的注释。
 */
interface ResultItem {
    type: 'page' | 'pdf' | 'video' | 'news'
    title: string
    url: string
    /** 摘要正文。网页型已剥掉开头的收录日期前缀。 */
    snippet?: string
    /**
     * Bing 的展示名，原样搬运，**实测会错标**：`query.libretexts.org` 曾被
     * 标成「知乎专栏」。来源以 url 的 hostname 为准，本字段只当参考。
     */
    site?: string
    /**
     * 时间。精确到哪一级由**字符串长度**决定，没有单独的 precision 字段：
     *
     * | 长度 | 形态              | 含义     |
     * | ---- | ----------------- | -------- |
     * | 10   | '2026-10-05'      | 只信到日 |
     * | 13   | '2026-10-05T14'   | 只信到时 |
     * | 16   | '2026-10-05T14:30'| 只信到分 |
     *
     * 三种长度的**字典序 == 时间序**，可以直接 sort / 比较，不必解析成 Date。
     * 值只截断到可信的那一级，不补伪造的 00:00:00。
     *
     * 要转 Date 的代价：10 位形式按 UTC 解析，跨时区可能差一天；
     * 13 位形式不是合法 Date 字面量（`new Date('2026-10-05T14')` 得
     * Invalid Date），需自行补 `':00'`。库不知道调用方在哪个时区，
     * 所以不替调用方决定怎么解释。
     *
     * 语义按类型不同：**网页型是 Bing 的收录 / 更新日，不是内容所指事件的
     * 发生时间**（覆盖率约 62%）；视频型 / 资讯型是发布时刻（覆盖约 75% / 96%）。
     * 两种情况都只能当排序参考，不足以当过滤判据 —— 把「没有时间」当成
     * 「不满足时间条件」是错的。
     */
    publishedAt?: string
}

interface WebPage extends ResultItem {
    type: 'page'
    /**
     * 素材与富化块。默认整个字段不下发，需 includeRichContents。
     *
     * 这里的每一项都是渲染素材或给人看的展开内容，不是检索数据：
     * 机器消费（排序、引用、喂 LLM）用不到它们。
     */
    richContents?: {
        /** 站点图标。覆盖率约 96%，占返回字符数约 13%。 */
        favicon?: string
        /** 右侧配图。覆盖率约 3%，基本只在图文类查询里出现。 */
        sideImage?: {
            /** 缩略图 URL。 */
            thumbnailUrl: string
            /** 点开后的详情页 URL。 */
            detailUrl?: string
            /** 原图宽高，取自 img 的 data-width / data-height。 */
            width?: number
            height?: number
        }
        /** 富卡片：展开的侧栏内容。覆盖率约 4%。 */
        rich?: {
            /** 卡头标题（b_rcGbMod 的 hero 文本）。 */
            title?: string
            /** 卡头链接。 */
            url?: string
            /** 展开的各个分区，上限 20 条。 */
            sections: {
                title: string
                /** 正文。b_richcard 型是多个列表项用换行拼接。 */
                text: string
                url?: string
            }[]
            /** 卡片内图片，取自各节点的 data-src。 */
            images?: string[]
        }
        /** 深链接 / 子链接，上限 20 条，按 URL 去重。 */
        links?: {
            title: string
            /** 已还原成绝对地址。 */
            url: string
        }[]
        /**
         * 内嵌视频富摘要：挂在普通网页结果上的视频预览卡（li.b_algo >
         * .rc_videocap），不占结果位，宿主仍是本 WebPage。
         * 与 type:'video' 的差别是这里有宿主网页、字段也来自另一套 DOM。
         *
         * 实测该 DOM 不提供简介与发布时间，故不声明这两个字段
         * （声明了也永远是空承诺）。
         */
        video?: {
            /**
             * 视频地址。**多数情况与宿主 page.url 相同**（本库不派生、
             * 不归一，只搬运 Bing 给的值），少数只多一个 ?mcid= 跟踪参数。
             */
            url: string
            /** 缩略图 URL。少量会 404，不保证可加载。 */
            thumbnail?: string
            /** 时长原文，如 '12:34'。 */
            duration?: string
            /** 来源站点名。 */
            site?: string
            /** 上传人 / UP 主。 */
            uploader?: string
            /** 播放量原文，如 '查看次数 18,162'。 */
            views?: string
        }
    }
}

/** 文档型主结果：Bing 打了 [PDF] 标记的条目。 */
/** 字段与 WebPage 完全同构，只有判别值不同。判别只认标记，不看 URL 后缀。 */
interface PdfPage extends Omit<WebPage, 'type'> {
    type: 'pdf'
}

/**
 * 视频卡里的一条视频。卡片本身不单独暴露：卡头标题恒为
 * `<查询词> 的视频` / `Videos of <查询词>`，「更多视频」链接也只是
 * `/videos/search?q=<查询词>`，都能从 query 推出来。
 */
interface VideoPage extends ResultItem {
    type: 'video'
    /** 时长原文，如 '12:34'。覆盖率约 97%。 */
    duration?: string
    /** 上传人 / UP 主。 */
    uploader?: string
    /** 播放量原文，如 '已浏览 9360 次'。与内嵌视频的文案形态不同。 */
    views?: string
    /** 素材。默认整个字段不下发，需 includeRichContents。 */
    richContents?: {
        /** 站点图标。 */
        favicon?: string
        /** 缩略图 URL。默认不下发。 */
        thumbnail?: string
    }
}

/**
 * 资讯条目。与 WebPage 的差别在**时间语义**：这里是媒体的发布时刻，
 * 不是 Bing 的收录时间，且覆盖率约 96%（远高于 WebPage 的 62%）。
 */
interface NewsPage extends ResultItem {
    type: 'news'
    /** 素材。默认整个字段不下发，需 includeRichContents。 */
    richContents?: {
        /** 媒体 logo。 */
        favicon?: string
        /** 新闻缩略图 URL。默认不下发。 */
        thumbnail?: string
    }
}
