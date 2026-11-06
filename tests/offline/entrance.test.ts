/**
 * 入口推测的离线回归（零网络）。
 *
 * 为什么单独一个文件：`resolveEntrance()` 是唯一一处「不传 bingEntrance 时
 * 走哪个入口」的判定，而在线测试不可能覆盖它——那取决于**跑测试的机器在
 * 哪个时区**，同一份代码在 CI（UTC）与本机（Asia/Shanghai）会得出相反结论。
 * 所以这里用显式注入的 timeZone 把两条路径都钉死。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveEntrance } from '../../src/entrance.ts'

/** 名单内的时区：中国大陆与港澳台 */
const CN_ZONES = [
    'Asia/Shanghai',
    'Asia/Chongqing',
    'Asia/Harbin',
    'Asia/Urumqi',
    'Asia/Kashgar',
    'PRC',
    'Asia/Hong_Kong',
    'Asia/Macau',
    'Asia/Taipei',
] as const

/** 名单外的时区 */
const OTHER_ZONES = [
    'UTC',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Europe/London',
    'America/New_York',
] as const

describe('入口推测', () => {
    describe('1. 显式传入永远优先', () => {
        it('显式 international 盖过名单内的时区', () => {
            for (const tz of CN_ZONES)
                assert.equal(
                    resolveEntrance('international', tz),
                    'international',
                    tz
                )
        })

        it('显式 cn 盖过名单外的时区', () => {
            for (const tz of OTHER_ZONES)
                assert.equal(resolveEntrance('cn', tz), 'cn', tz)
        })
    })

    describe('2. 不传时按运行时时区推测', () => {
        it('名单内的 9 个时区都推测成 cn', () => {
            for (const tz of CN_ZONES)
                assert.equal(resolveEntrance(undefined, tz), 'cn', tz)
        })

        it('名单外的时区推测成 international', () => {
            for (const tz of OTHER_ZONES)
                assert.equal(
                    resolveEntrance(undefined, tz),
                    'international',
                    tz
                )
        })

        it('时区名大小写敏感（不做归一化，与语义一致）', () => {
            // IANA 时区名是区分大小写的；这里只锁住「没有偷偷小写化」，
            // 免得某天有人加个 `tz.toLowerCase()` 把 'PRC' 变成 'prc' 失配。
            assert.equal(
                resolveEntrance(undefined, 'asia/shanghai'),
                'international'
            )
        })
    })

    describe('3. 缺省时区取运行时真实时区', () => {
        it('不传时区的结果必然是合法入口之一', () => {
            const got = resolveEntrance()
            assert.ok(got === 'cn' || got === 'international', got)
        })

        it('与直接读 Intl 时区的判定一致（缺省值没被写死）', () => {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
            assert.equal(resolveEntrance(), resolveEntrance(undefined, tz))
        })
    })
})
