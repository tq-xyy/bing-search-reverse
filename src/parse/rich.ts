import { all, one, text, attr, type Element } from './dom.ts'
import { resolveBingUrl } from './urls.ts'

/** 单条结果的展开内容（两套 DOM：b_rcGbMod / b_richcard）。 */
export interface RichSection {
    title: string
    text: string
    url?: string
}

export interface RichCard {
    title?: string
    url?: string
    sections: RichSection[]
    images?: string[]
}

const MAX_SECTIONS = 20

function collectSections(
    nodes: Element[],
    read: (el: Element) => { title: string; text: string; url: string }
): RichSection[] {
    const sections: RichSection[] = []
    for (const el of nodes) {
        if (sections.length >= MAX_SECTIONS) break
        const { title, text, url } = read(el)
        if (!title && !text) continue
        sections.push({ title, text, url: url || undefined })
    }
    return sections
}

function dataSrcs(nodes: Element[]): string[] {
    return nodes.map(el => attr(el, 'data-src') ?? '').filter(Boolean)
}

export function extractRichCard(container: Element): RichCard | undefined {
    const rcGb = one('.b_rcGbMod', container)
    if (rcGb) {
        const hero = one('a.b_rcGbModHero', rcGb)
        const heroText = text(hero)
        const heroUrl = resolveBingUrl(attr(hero, 'href'))

        const sections = collectSections(all('.b_rcGbModCard', rcGb), card => {
            const link = one('a.b_acf_card_link', card)
            return {
                title: text(one('.acf_t_c_title', card)),
                text: text(one('.acf_t_c_body', card)),
                url: resolveBingUrl(attr(link, 'href')),
            }
        })

        const images = dataSrcs(
            all('.b_rcGbModImageCard .rms_iac[data-src]', rcGb)
        )

        if (!heroText && sections.length === 0 && images.length === 0)
            return undefined
        return {
            title: heroText || undefined,
            url: heroUrl || undefined,
            sections,
            images: images.length ? images : undefined,
        }
    }

    const rich = one('.b_richcard', container)
    if (!rich) return undefined

    const sections = collectSections(all('.b_dmtab', rich), tab => {
        const id = attr(tab, 'data-content') ?? ''
        const panel = id ? one('#' + id, rich) : undefined
        const more = panel ? one('a[href]', panel) : undefined
        return {
            title: text(tab),
            text: panel
                ? all('.b_vList li', panel)
                      .map(li => text(li))
                      .filter(Boolean)
                      .join('\n')
                : '',
            url: resolveBingUrl(attr(more, 'href')),
        }
    })

    const images = dataSrcs(all('.rms_iac[data-src]', rich))

    if (sections.length === 0 && images.length === 0) return undefined
    return { sections, images }
}
