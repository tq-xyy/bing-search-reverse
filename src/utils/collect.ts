/** 一条候选：自己带去重键；返回 null 表示缺必填字段、不收。 */
export interface Candidate<T> {
    key: string
    value: T
}

/** 按 key 去重收集，达到 limit 提前结束。 */
export function collectUnique<T, V>(
    items: Iterable<T>,
    toCandidate: (item: T) => Candidate<V> | null,
    limit = Infinity
): Candidate<V>[] {
    const out: Candidate<V>[] = []
    const seen = new Set<string>()
    for (const item of items) {
        if (out.length >= limit) break
        const candidate = toCandidate(item)
        if (!candidate || !candidate.key || seen.has(candidate.key)) continue
        seen.add(candidate.key)
        out.push(candidate)
    }
    return out
}
