import { parseDocument } from 'htmlparser2'
import { selectAll } from 'css-select'
import type { Document, Element, ChildNode } from 'domhandler'

/** 块级元素：边界在纯文本里补空格，否则相邻段落粘连。 */
const BLOCK_TAGS = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'br',
    'dd',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hr',
    'li',
    'main',
    'nav',
    'ol',
    'p',
    'pre',
    'section',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
])

const isElement = (n: ChildNode): n is Element => n.type === 'tag'

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg'])

function collect(
    node: ChildNode | Document,
    skip?: (el: Element) => boolean
): string {
    if (node.type === 'text') return node.data
    if (!('children' in node)) return ''
    if (isElement(node)) {
        if (SKIP_TAGS.has(node.name)) return ' '
        if (skip?.(node)) return ' '
    }
    const kids = node.children as ChildNode[]
    const inner = kids.map(kid => collect(kid, skip)).join('')
    if (isElement(node) && BLOCK_TAGS.has(node.name)) return ' ' + inner + ' '
    return inner
}

/** 取元素纯文本并折叠空白；skip 可跳过指定子树（只读，不改 DOM）。 */
export function text(
    node: Document | Element | null | undefined,
    skip?: (el: Element) => boolean
): string {
    if (!node) return ''
    return collect(node, skip).replace(/\s+/g, ' ').trim()
}

/** class 是否包含某个词（class 是多值，不能子串匹配）。 */
export function hasClass(el: Element, name: string): boolean {
    const cls = el.attribs?.class
    return typeof cls === 'string' && cls.split(/\s+/).includes(name)
}

/** 取属性值（实体已由解析器解码）。 */
export function attr(
    el: Element | null | undefined,
    name: string
): string | undefined {
    return el?.attribs?.[name]?.replace(/[\uE000-\uF8FF]/g, '')
}

/** 选择器匹配的全部元素。 */
export function all(selector: string, root: Document | Element): Element[] {
    return selectAll(selector, root)
}

/** 首个匹配元素，无匹配返回 undefined。 */
export function one(
    selector: string,
    root: Document | Element
): Element | undefined {
    return all(selector, root)[0]
}

/** 解析 HTML（实体解码默认开启）。 */
export function parse(html: string): Document {
    return parseDocument(html)
}

export type { Document, Element }
