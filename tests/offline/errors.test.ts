/**
 * 错误模型的离线单测。
 *
 * 验证两条不变量：
 *   1. **白名单语义**：只有 200 才放行，其余一切状态都必须抛错。
 *      旧实现用「可重试 / 不可重试」两张状态码表，落在表外的状态（3xx、204、418…）
 *      会被静默当成成功——这些用例正是为了锁住那次修正。
 *   2. **fetch 异常归一**：网络层失败的 SearchHttpError.status 必须是 0，
 *      且可重试；4xx 必须不可重试。search.ts 的重试循环依赖这两个字段。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
    assertOk,
    SearchHttpError,
    backoffDelay,
    toSearchHttpError,
} from '../../src/net/errors.ts'

/** 断言一次调用抛出指定 retryable 的 SearchHttpError，并返回它。 */
function expectThrows(status: number, retryable: boolean): SearchHttpError {
    try {
        assertOk(status)
    } catch (e) {
        assert.ok(e instanceof SearchHttpError, '应抛 SearchHttpError')
        assert.equal(e.retryable, retryable, 'HTTP ' + status + ' 的重试分类')
        assert.equal(e.status, status)
        return e
    }
    assert.fail('HTTP ' + status + ' 应当抛错，实际放行')
}

describe('assertOk（白名单语义）', () => {
    it('200 → 放行', () => {
        assert.doesNotThrow(() => assertOk(200))
    })

    it('5xx / 408 → 可重试', () => {
        for (const s of [408, 500, 502, 503, 504, 520, 521, 522, 523, 524])
            expectThrows(s, true)
    })

    it('4xx / 3xx / 204 等表外状态 → 一律失败（不得静默放行）', () => {
        for (const s of [400, 403, 404, 429, 451, 301, 302, 204, 418, 999])
            expectThrows(s, false)
    })
})

describe('toSearchHttpError（fetch 异常归一）', () => {
    it('SearchHttpError 原样返回', () => {
        const e = new SearchHttpError(404, 'x', false)
        assert.equal(toSearchHttpError(e), e)
    })

    it('DNS 失败（TypeError + cause.code）→ status 0 且可重试', () => {
        const raw = Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ENOTFOUND' },
        })
        const e = toSearchHttpError(raw)
        assert.equal(e.status, 0)
        assert.equal(e.retryable, true)
        assert.match(e.message, /ENOTFOUND/)
    })

    it('超时（DOMException TimeoutError）→ status 0 且可重试', () => {
        const e = toSearchHttpError({
            name: 'TimeoutError',
            message: 'timeout',
        })
        assert.equal(e.status, 0)
        assert.equal(e.retryable, true)
        assert.match(e.message, /TimeoutError/)
    })

    it('非网络异常原样抛出（不伪装成可重试的网络故障）', () => {
        // 解析器里的 TypeError 是代码 bug，不是网络问题。早期实现把它归一成
        // status 0 / retryable，重试循环会重建会话、退避、重试三次，最后返回
        // 空 pages —— 调用方看到的是「Bing 没结果」，真实原因被永久掩盖。
        const bug = new TypeError(
            "Cannot read properties of undefined (reading 'x')"
        )
        assert.throws(
            () => toSearchHttpError(bug),
            (e: unknown) => e === bug
        )
        assert.throws(
            () => toSearchHttpError(undefined),
            (e: unknown) => e === undefined
        )
        assert.throws(
            () => toSearchHttpError('boom'),
            (e: unknown) => e === 'boom'
        )
    })

    it('cause.code 不是字符串时不算网络失败', () => {
        const weird = Object.assign(new TypeError('fetch failed'), {
            cause: { code: undefined },
        })
        assert.throws(
            () => toSearchHttpError(weird),
            (e: unknown) => e === weird
        )
    })
})

describe('backoffDelay', () => {
    it('随重试次数递增且有 8s 上限', () => {
        for (let attempt = 1; attempt <= 6; attempt++) {
            const d = backoffDelay(attempt)
            assert.ok(d >= 0, '不应为负')
            assert.ok(d <= 8000 + 500, '不应超过 8s + 抖动上限')
        }
        assert.ok(backoffDelay(1) <= backoffDelay(10))
    })
})
