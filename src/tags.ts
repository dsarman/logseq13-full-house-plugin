import '@logseq/libs'
import { BlockEntity, PageEntity } from '@logseq/libs/dist/LSPlugin.user'

import * as Sherlock from 'sherlockjs'

import { LogseqDayjsState } from './extensions/dayjs_logseq_plugin'
import { LogseqMarkup, MLDOC_Node, resolveAssetsLink } from './extensions/mldoc_ast'
import { BlockContext, Context, dayjs, Dayjs, ILogseqContext, PageContext }  from './context'
import {
    getBlock, getPage, IBlockNode, isEmptyString, isObject, isUUID,
    LogseqReference, p, parseReference, unquote, walkBlockTree
} from './utils'


const isoDateFromat = 'YYYY-MM-DD'

type ITemplateTagsContext = {
    ref: Function
    bref: Function
    embed: Function

    empty: Function
    when: Function
    fill: Function
    zeros: Function
    spaces: Function

    yesterday: string
    today: string
    tomorrow: string
    time: string

    dev: {
        parseMarkup: (text: string) => MLDOC_Node[]
        toHTML: (text: string) => string
        asset: (name: string) => string
        color: (value: string) => string
        links: Function
    }

    date: {
        yesterday: Dayjs
        today: Dayjs
        now: Dayjs
        tomorrow: Dayjs

        from: Function
        nlp: Function
    }
}


// These template tags could be used in raw javascript template code
// → type declarations could be violated
// → use this protection where necessary
function _asString(v: any): string {
    v ??= ''
    return v.toString()
}

function _withLabel(item: string, label: string) {
    return `[${label}](${item})`
}
function _asDateString(item: string): Dayjs | null {
    const day = dayjs(item, isoDateFromat, true)  // strict mode
    if (day.isValid())
        return day
    return null
}
function _ref(name: string, label: string | null = null): string {
    const item = `[[${name}]]`
    if (label !== null)
        return _withLabel(item, label)
    return item
}
function _is_ref(item: string): boolean {
    return item.startsWith('[[') && item.endsWith(']]')
}
function _bref(uuid: string, label: string | null = null): string {
    const item = `((${uuid}))`
    if (label !== null)
        return _withLabel(item, label)
    return item
}
function _is_bref(item: string): boolean {
    return item.startsWith('((') && item.endsWith('))')
}

function ref(item: string | BlockContext | PageContext | Dayjs, label: string | null = null): string {
    item = item ?? ''

    if (item instanceof dayjs) {
        // @ts-expect-error
        item = item.toPage() as string
        return _ref(item, label)
    }

    if (item instanceof BlockContext) {
        if (item.uuid)
            return _bref(item.uuid, label)

        // @ts-expect-error
        const block = top!.logseq.api.get_block(item.id)
        return _bref(block?.uuid ?? '', label)
    }

    if (item instanceof PageContext) {
        if (item.name)
            return _ref(item.name, label)

        // TODO: need async support for filter function in «eta»
        // const page = await getPage({type: 'id', value: item.id} as LogseqReference)

        // @ts-expect-error
        const page = top!.logseq.api.get_page(item.id)
        return _ref(page?.originalName ?? '', label)
    }

    const str = _asString(item).trim()
    if (_is_ref(str))
        if (label === null)
            return str
        else
            return _withLabel(str, label)

    if (_is_bref(str) && isUUID(str.slice(2, -2)))
        if (label === null)
            return str
        else
            return _withLabel(str, label)

    if (isUUID(str))
        return _bref(str, label)

    // check for the case `ref(today)` or `ref('YYYY-MM-DD')`
    const date = _asDateString(str)
    if (date)
        return _ref(date.format('page'), label)

    return _ref(str, label)
}
function bref(item: any): string {
    // @ts-expect-error
    top!.logseq.api.show_msg(
        '"bref" is deprecated. Please use "ref" instead',
        'warning', {timeout: 5000}
    )
    console.warn(p`"bref" is deprecated. Please use "ref" instead`)

    return ref(item)
}
function embed(item: string | BlockContext | PageContext | Dayjs): string {
    const r = ref(item)
    return `{{embed ${r}}}`
}
function empty(obj: any, fallback: any = ''): any {
    if (obj === null)
        return obj

    if (Array.isArray(obj) && obj.length === 0)
        return fallback

    if (isObject(obj) && Object.keys(obj).length === 0)
        return fallback

    const strObj = _asString(obj)
    if (isEmptyString(strObj))
        return fallback

    return obj
}
function when(obj: any, result: string | any, fallback: string | any = ''): string {
    const condition = !!obj

    if (condition) {
        if (typeof result !== 'string')
            return _asString(result)

        const strObj = _asString(obj)
        return _asString(result)
            .replaceAll('${_}', strObj)
            .replaceAll('${}', strObj)
            .replaceAll('$1', strObj)
    }

    return _asString(fallback)
 }
function fill(
    value: string | number,
    char: string,
    width: number,
    align: 'left' | 'right' | 'center' = 'right',
): string {
    value = _asString(value)
    char = _asString(char)
    width = Number(_asString(width))
    const count = Math.max(0, width - value.length)

    const filler = char.repeat(count)
    if (align === 'left')
        return value + filler
    else if (align === 'right')
        return filler + value

    const half = Math.floor(count / 2)
    const remainder = count % 2
    return char.repeat(half + remainder) + value + char.repeat(half)
 }
function zeros(value: string | number, width: number = 2): string {
    return fill(value, '0', width)
 }
function spaces(value: string | number, width: number, align: 'left' | 'right' | 'center' = 'right'): string {
    return fill(value, ' ', width, align)
}


/* date */
function date_nlp(context: ILogseqContext, query: string, now: Dayjs | string = 'now'): Dayjs | null {
    if (now === 'now')
        Sherlock._setNow(null)
    else if (now === 'page')
        Sherlock._setNow(context.currentPage.day?.toDate() || null)
    else
        Sherlock._setNow(dayjs(now).toDate())

    const parsed = Sherlock.parse(query)
    const { isAllDay, eventTitle, startDate, endDate } = parsed
    if (startDate)
        return dayjs(startDate)
    return null
}


/* dev */
function parseMarkup(context: ILogseqContext, text: string): MLDOC_Node[] {
    text = _asString(text)
    return new LogseqMarkup(context).parse(text)
 }
function toHTML(context: ILogseqContext, text: string): string {
    text = _asString(text)
    return new LogseqMarkup(context).toHTML(text)
 }
function asset(context: ILogseqContext, name: string): string {
    // TODO: expand '/test.png'
    name = _asString(name)
    let originalProtocol: string
    try {
        const url = new URL(name)
        originalProtocol = url.protocol.replace(/:$/, '')
        name = name.slice((originalProtocol + '://').length)
    }
    catch (error) {
        originalProtocol = ''
    }

    const [ protocol, link ] = resolveAssetsLink(context, originalProtocol || 'assets', name)
    return `${protocol}://${link}`
 }
function color(value: string): string {
    // TODO: rgb(r, g, b) & others support
    value = _asString(value)
    value = unquote(value)
    if (!value.startsWith('#'))
        value = `#${value}`
    return value
 }
function get(context: ILogseqContext, path: string): string {
    path = _asString(path)

    function getByPath(obj: any, parts: string[]) {
        while (parts.length)
            if (typeof obj == 'object')
                obj = obj[parts.shift() as string]
            else return undefined
        return obj
    }

    path = path.replaceAll('@', '.props.')
    const parts = path.split('.')

    if (parts[0] === 'c')
        parts.shift()

    if (!parts.length)
        return ''

    return getByPath(context, parts) ?? ''
}

/* query */
//   where: source
//   how: tree-path-spec, by prop, by ancestor?
//   what:
//     links (external, local, assets, images) — how: labeled, with-meta, inclusion
//     pages, tag-pages, ref-pages
//     blocks

function parseLinks(context: ILogseqContext, text: string): string[] {
    const links: string[] = []

    const ast = new LogseqMarkup(context).parse(text)
    for (const [ type, node ] of ast)
        if (type === 'Link') {
            const [ type, url ] = node.url
            if (type === 'Complex') {
                const { protocol, link } = url
                links.push(`${protocol}://${link}`)
            }
        }

    return links
 }

async function links(
    context: ILogseqContext,
    source: string | PageContext | BlockContext,
    includeChildren: boolean = false,
): Promise<string[]> {
    if (typeof source === 'string')
        return parseLinks(context, source)

    if (source instanceof PageContext)
        source = source.name_!

    if (source instanceof BlockContext)
        source = source.uuid!

    source = _asString(source)
    const sourceRef = parseReference(source)
    if (!sourceRef)
        return []

    let blocks: BlockEntity[] = []
    if (['uuid', 'block'].includes(sourceRef.type)) {
        const [ block ] = await getBlock(sourceRef, { includeChildren })
        if (block)
            blocks = [ block ]
    } else
        blocks = await logseq.Editor.getPageBlocksTree(sourceRef.value as string) ?? []

    const linksInBlock: string[] = []
    for (const block of blocks)
        await walkBlockTree(block as IBlockNode, async (b, lvl) => {
            for (const link of parseLinks(context, b.content))
                linksInBlock.push(link)
        })

    return linksInBlock
 }


export function getTemplateTagsDatesContext() {
    const todayObj = dayjs().startOf('second')
    const yesterdayObj = todayObj.subtract(1, 'day').startOf('day')
    const tomorrowObj = todayObj.add(1, 'day').startOf('day')

    const yesterday = yesterdayObj.format(isoDateFromat)
    const today = todayObj.format(isoDateFromat)
    const tomorrow = tomorrowObj.format(isoDateFromat)
    const time = dayjs().format('HH:mm')

    return {
        yesterday, today, tomorrow, time,

        date: {
            yesterday: yesterdayObj,
            today: todayObj.startOf('day'),
            now: todayObj,
            tomorrow: tomorrowObj,

            from: dayjs,
        },
    }
}
export function getTemplateTagsContext(context: ILogseqContext): ITemplateTagsContext {
    const datesContext = getTemplateTagsDatesContext()

    return {
        ref, bref, embed,
        empty, when, fill, zeros, spaces,

        yesterday: datesContext.yesterday,
        today: datesContext.today,
        tomorrow: datesContext.tomorrow,
        time: datesContext.time,

        dev: new Context({
            parseMarkup: parseMarkup.bind(null, context),
            toHTML: toHTML.bind(null, context),
            asset: asset.bind(null, context),
            color,
            get: get.bind(null, context),
            links: parseLinks.bind(null, context),
        }) as unknown as ITemplateTagsContext['dev'],
        date: Object.assign(datesContext.date, {
            nlp: date_nlp.bind(null, context),
        }),
    }
}

export const _private = {
    ref, embed, empty, when, fill, zeros, spaces,
}
