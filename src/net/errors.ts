/** 搜索请求失败。status 0 表示没拿到 HTTP 响应（网络/超时）。 */
export class SearchHttpError extends Error {
    readonly status: number
    readonly retryable: boolean

    constructor(status: number, message: string, retryable: boolean) {
        super(message)
        this.name = 'SearchHttpError'
        this.status = status
        this.retryable = retryable
    }
}

function isRetryableStatus(status: number): boolean {
    return status === 408 || (status >= 500 && status < 600)
}

/** 只有 200 算成功（白名单），其余按可否重试归类抛错。 */
export function assertOk(status: number): void {
    if (status === 200) return
    if (isRetryableStatus(status)) {
        throw new SearchHttpError(
            status,
            'Bing 服务端临时故障（HTTP ' + status + '）',
            true
        )
    }
    throw new SearchHttpError(
        status,
        'Bing 拒绝了这次请求（HTTP ' + status + '）',
        false
    )
}

/**
 * fetch 异常 → SearchHttpError，只认网络层失败；其余原样重抛
 * （解析器的 TypeError 是代码 bug，不能被当成网络故障重试）。
 */
export function toSearchHttpError(e: unknown): SearchHttpError {
    if (e instanceof SearchHttpError) return e
    const err = e as {
        name?: string
        message?: string
        cause?: { code?: string }
    }
    const cause = err?.cause?.code
    const name = err?.name
    const isNetworkFailure =
        typeof cause === 'string' ||
        name === 'TimeoutError' ||
        name === 'AbortError'
    if (!isNetworkFailure) throw e
    return new SearchHttpError(0, '请求失败（' + (cause ?? name) + '）', true)
}

/** 指数退避 + 抖动，8s 封顶。 */
export function backoffDelay(attempt: number): number {
    return (
        Math.min(1000 * 2 ** (attempt - 1), 8000) +
        Math.floor(Math.random() * 500)
    )
}
