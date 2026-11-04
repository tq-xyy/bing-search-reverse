import { resolveUaProfile } from '../utils/ua.ts'
import { gecHeaders } from './gec.ts'

/** 基线请求头。UA 与 sec-ms-gec-version 来自同一个 UaProfile，保证形态自洽。 */
export function baseHeaders(): Record<string, string> {
    const { ua, edgeVersion } = resolveUaProfile()
    return {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'User-Agent': ua,
        ...gecHeaders(edgeVersion),
    }
}
