/**
 * 在线：两个入口的端到端契约（需要网络）。
 *
 * 每个入口一个查询、只请求一次；断言的是「入口选对了」这件事本身：
 *   · cn 入口：中文界面（标题 - 搜索）；
 *   · international 入口：英文界面（lang=en、标题 - Search）；
 *   · 两个入口的解析结果都不允许出现 ck/a 残留。
 *
 * 不按时区推测的那条路径在离线测试（tests/offline/entrance.test.ts）里钉住，
 * 因为「运行机器在哪个时区」不该决定在线测试的结果——同一份代码在 CI（UTC）
 * 与本机（Asia/Shanghai）会推测出相反的入口。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { searchByBing } from '../../src/index.ts'
import { homeUrl, searchUrl } from '../../src/protocol.ts'
import { getSession } from '../../src/net/session.ts'
import { parseSearchPage } from '../../src/parse/index.ts'

describe('入口：cn vs international', () => {
    it('international：英文界面、结果可消费、无 ck/a 残留', async () => {
        const url = searchUrl(
            'kubernetes pod scheduling',
            '0123456789ABCDEF0123456789ABCDEF',
            'international'
        )
        const session = await getSession()
        const res = await session.request(url, {
            referer: homeUrl('international'),
        })
        assert.equal(res.status, 200)
        assert.match(res.body, /<html[^>]*lang="en"/)
        assert.match(res.body, /- Search<\/title>/)

        const parsed = parseSearchPage(res.body, Date.now())
        assert.ok(parsed.pages.length > 0)
        assert.equal(
            (JSON.stringify(parsed).match(/bing\.com\/ck\/a/g) ?? []).length,
            0
        )
    })

    it('cn：中文界面、结果可消费、无 ck/a 残留', async () => {
        const url = searchUrl(
            '动量定理',
            '0123456789ABCDEF0123456789ABCDEF',
            'cn'
        )
        const session = await getSession()
        const res = await session.request(url, { referer: homeUrl('cn') })
        assert.equal(res.status, 200)
        assert.match(res.body, /<html[^>]*lang="zh"/)
        assert.match(res.body, /- 搜索<\/title>/)

        const parsed = parseSearchPage(res.body, Date.now())
        assert.ok(parsed.pages.length > 0)
        assert.equal(
            (JSON.stringify(parsed).match(/bing\.com\/ck\/a/g) ?? []).length,
            0
        )
    })

    it('searchByBing 尊重 bingEntrance 参数', async () => {
        const r = await searchByBing('kubernetes pod scheduling', {
            bingEntrance: 'international',
        })
        assert.ok(r.pages.length > 0)
        // 国际版结果以国际站点为主：首条不是中文站
        assert.ok(r.pages[0]!.url.startsWith('https://'))
    })
})
