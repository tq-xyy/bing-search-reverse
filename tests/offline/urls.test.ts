/**
 * 解析出口的 URL 统一处理（纯函数，零网络）。
 *
 * 为什么要单独测：国际版把外链几乎全部包成 /ck/a 跳转，国内版约 10%，
 * 而解析器有 5 个模块各自取链接。统一出口（resolveBingUrl）必须同时满足：
 *   · ck/a 解出的绝对地址原样返回；
 *   · ck/a 解出的站内相对路径（/images/search?…）补成 cn.bing.com；
 *   · 非跳转链接照常补绝对；
 *   · 解不出时原样返回（不猜、不抛）。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { decodeBingRedirectUrl, resolveBingUrl } from '../../src/parse/urls.ts'

/** 绝对目标：https://example.com/path */
const CK_ABS =
    'https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9wYXRo&ntb=1'

/** 站内相对目标：/images/search?q=打铁花&FORM=IGRE */
const CK_REL =
    'https://www.bing.com/ck/a?!&&p=y&u=a1L2ltYWdlcy9zZWFyY2g_cT0lZTYlODklOTMlZTklOTMlODElZTglOGElYjEmRk9STT1JR1JF&ntb=1'

describe('resolveBingUrl：解析出口', () => {
    it('ck/a 绝对目标：还原后逐字节相同', () => {
        assert.equal(resolveBingUrl(CK_ABS), 'https://example.com/path')
    })

    it('ck/a 站内相对目标：补成 cn.bing.com', () => {
        assert.equal(
            resolveBingUrl(CK_REL),
            'https://cn.bing.com/images/search?q=%e6%89%93%e9%93%81%e8%8a%b1&FORM=IGRE'
        )
    })

    it('普通相对路径照常补全', () => {
        assert.equal(
            resolveBingUrl('/search?q=x'),
            'https://cn.bing.com/search?q=x'
        )
        assert.equal(
            resolveBingUrl('//cdn.example.com/a.png'),
            'https://cdn.example.com/a.png'
        )
    })

    it('已是绝对地址原样返回', () => {
        assert.equal(resolveBingUrl('https://a.com/x'), 'https://a.com/x')
    })

    it('空值 / 非法值返回空串（不抛）', () => {
        assert.equal(resolveBingUrl(undefined), '')
        assert.equal(resolveBingUrl(''), '')
        assert.equal(resolveBingUrl('javascript:alert(1)'), '')
    })

    it('ck/a 但没有 u、或 u 不以 a1 开头 → 原样（不猜）', () => {
        const noU = 'https://www.bing.com/ck/a?!&&p=z&ntb=1'
        assert.equal(decodeBingRedirectUrl(noU), noU)
        const weird = 'https://www.bing.com/ck/a?!&&p=z&u=zzzz&ntb=1'
        assert.equal(decodeBingRedirectUrl(weird), weird)
    })

    it('幂等：解过的 URL 再解一次不变', () => {
        const once = resolveBingUrl(CK_REL)
        assert.equal(resolveBingUrl(once), once)
    })
})
