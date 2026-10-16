import { expect, test } from 'claude-code/testing'

import { parse } from '../hooks/markdown'
import { PRESETS } from '../hooks/presets'
import { width } from '../hooks/render'
import { resolveStyle } from '../hooks/theme'

const TABLE = [
  '| Service | Regions | Version |',
  '|---|---|---:|',
  '| api-gateway | us, eu | server 2.14.0 |',
  '| billing | us, eu, ap | 1.8.3 |',
].join('\n')

const draw = (text: string) => ({
  plugin: 'prismantis',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40 },
})

test('parses tables, code, lists and inline decorations', async () => {
  const blocks = parse(`# Title\n\n${TABLE}\n\n- see \`x\` at ~/git/app.ts\n\n\`\`\`bash\ngh pr view 12 --json\n\`\`\``, { numbers: true, paths: true })
  expect(blocks.map(b => b.kind)).toEqual(['heading', 'table', 'list', 'code'])
  const table = blocks[1]
  if (table?.kind !== 'table') throw new Error('not a table')
  expect(table.rows.length).toBe(2)
  expect(table.align[2]).toBe('right')
  expect(table.rows[0]?.[2]?.some(n => n.kind === 'number' && n.text === '2.14.0')).toBe(true)
  const list = blocks[2]
  if (list?.kind !== 'list') throw new Error('not a list')
  expect(list.items[0]?.inline.some(n => n.kind === 'path' && n.text === '~/git/app.ts')).toBe(true)
})

test('escaped pipes stay inside a cell', async () => {
  const [t] = parse('| a | b |\n|---|---|\n| x \\| y | z |', { numbers: false, paths: false })
  if (t?.kind !== 'table') throw new Error('not a table')
  expect(t.rows[0]?.length).toBe(2)
})

test('user colors override the theme, bad colors are ignored', async () => {
  const s = resolveStyle({ theme: 'catppuccin-mocha', tableHeaderColor: '#ff0000', numberColor: 'not a color', pathColor: 'cyan', linkColor: 'javascript:x' })
  expect(s.theme.tableHeader).toBe('#ff0000')
  expect(s.theme.number).toBe(PRESETS['catppuccin-mocha'].number)
  expect(s.theme.path).toBe('cyan')
  expect(s.theme.link).toBe(PRESETS['catppuccin-mocha'].link)
})

test('draws a colored table on terminal and desktop', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...draw(TABLE), surface })
    const header = await ui.find({ type: 'Text', text: /^Service$/ })
    expect(header?.props.color).toBe(PRESETS['catppuccin-mocha'].tableHeader)
    expect(header?.props.bold).toBe(true)
    const version = await ui.find({ type: 'Text', text: /^2\.14\.0$/ })
    expect(version?.props.color).toBe(PRESETS['catppuccin-mocha'].number)
    await ui.unmount()
  }
})

test('options reach the drawing', { options: { tableHeaderColor: '#123456', highlightNumbers: false } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Service$/ }))?.props.color).toBe('#123456')
  expect((await ui.find({ type: 'Text', text: /^2\.14\.0$/ }))).toBeUndefined()
  await ui.unmount()
})

test('shell blocks color command and flags', async $ => {
  const ui = await $.ui.mount({ ...draw('```bash\ngh pr review 45 --approve\n```'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^gh$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].codeCommand)
  expect((await ui.find({ type: 'Text', text: /^--approve$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].codeFlag)
  await ui.unmount()
})

test('disabled leaves the engine renderer alone', { options: { enabled: false } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Service$/ })).toBeUndefined()
  expect((await ui.find({ type: "Text", text: /^engine$/ }))?.text).toBe("engine")
  await ui.unmount()
})

test('box art from a mermaid mod above is not shell-colored', async $ => {
  const ui = await $.ui.mount({ ...draw('```\n┌───┐\n│ A │\n└───┘\n```'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^│ A │$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].codeText)
  await ui.unmount()
})

const FLOW = 'Flow:\n\n```mermaid\ngraph LR\nA[User] --> B[Gateway]\n```'

test('mermaid draws as colored box art', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...draw(FLOW), surface })
    const label = await ui.find({ type: 'Text', text: /Gateway/ })
    expect(label).toBeDefined()
    const user = await ui.find({ type: 'Text', text: /^User$/ })
    const gateway = await ui.find({ type: 'Text', text: /^Gateway$/ })
    expect(user?.props.color).toBeDefined()
    expect(user?.props.color).not.toBe(gateway?.props.color)
    await ui.unmount()
  }
})

test('mermaid off keeps the source', { options: { mermaid: false } }, async $ => {
  const ui = await $.ui.mount({ ...draw(FLOW), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^graph LR$/ })).toBeDefined()
  await ui.unmount()
})

test('every preset defines every token with a valid color', async () => {
  const tokens = Object.keys(PRESETS['catppuccin-mocha'])
  for (const [name, theme] of Object.entries(PRESETS)) {
    if (name === 'mono') continue
    expect(Object.keys(theme).sort()).toEqual([...tokens].sort())
    for (const value of Object.values(theme)) expect(/^#[0-9a-f]{6}$/.test(value as string)).toBe(true)
  }
})

test('picks a named theme and falls back on unknown names', async () => {
  expect(resolveStyle({ theme: 'dracula' }).theme.tableHeader).toBe('#f1fa8c')
  expect(resolveStyle({ theme: 'nope' }).theme.tableHeader).toBe(PRESETS['catppuccin-mocha'].tableHeader)
})

const toolRow = (tool: string, input: unknown, extra: Partial<{ isRunning: boolean; isErrored: boolean; isInterrupted: boolean }> = {}) => ({
  plugin: 'prismantis',
  component: 'ToolUse' as const,
  props: { tool_use_id: 't1', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra },
  viewport: { columns: 120, rows: 40 },
})

test('tool rows read like Ran <command> with shell colors', { options: { toolStyle: 'classic' } }, async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...toolRow('Bash', { command: 'gh pr view 12 --json state' }), surface })
    expect((await ui.find({ type: 'Text', text: /^Ran$/ }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^gh$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].codeCommand)
    await ui.unmount()
  }
})

test('file tools show the path in the path color and failures say so', async $ => {
  const ui = await $.ui.mount({ ...toolRow('Edit', { file_path: '/tmp/app.ts' }, { isErrored: true }), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Edited$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^\/tmp\/app\.ts$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].path)
  expect((await ui.find({ type: 'Text', text: /failed/ }))).toBeDefined()
  await ui.unmount()
})

test('toolRows off leaves tool rows to the engine', { options: { toolRows: false } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...toolRow('Bash', { command: 'ls' }), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^engine$/ }))).toBeDefined()
  await ui.unmount()
})

test('rgb() and ansi256() colors reach the drawing', { options: { tableHeaderColor: 'rgb(255,204,0)', numberColor: 'ansi256(114)' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Service$/ }))?.props.color).toBe('rgb(255,204,0)')
  expect((await ui.find({ type: 'Text', text: /^2\.14\.0$/ }))?.props.color).toBe('ansi256(114)')
  await ui.unmount()
})

test('bullets nested under a numbered list draw as bullets', async $ => {
  const ui = await $.ui.mount({ ...draw('1. Roll out\n   - canary first'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^◦ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- $/ })).toBeUndefined()
  await ui.unmount()
})

test('a single-series bar chart highlights the tallest bar and mutes the rest', async $ => {
  const chart = '```mermaid\nxychart-beta\n  x-axis [Mon, Tue, Wed]\n  y-axis 0 --> 9\n  bar [3, 7, 5]\n```'
  const ui = await $.ui.mount({ ...draw(chart), surface: 'terminal' })
  const t = PRESETS['catppuccin-mocha']
  const hues = new Set((await ui.findAll({ type: 'Text', text: /^█+$/ })).map(b => b.props.color))
  expect([...hues].sort()).toEqual([t.emphasis, t.quote].sort())
  await ui.unmount()
})

test('a participant keeps one color at both ends of a sequence diagram', async $ => {
  const seq = '```mermaid\nsequenceDiagram\n  Browser->>App: GET /cart\n  App-->>Browser: 200\n```'
  const ui = await $.ui.mount({ ...draw(seq), surface: 'terminal' })
  const ends = await ui.findAll({ type: 'Text', text: /^Browser$/ })
  expect(ends.length).toBe(2)
  expect(ends[0]?.props.color).toBe(ends[1]?.props.color)
  await ui.unmount()
})

test('back-to-back tables and diagrams share a wrapping row', async $ => {
  const text = `${TABLE}\n\n${FLOW.replace('Flow:\n\n', '')}\n\nAfter.`
  const ui = await $.ui.mount({ ...draw(text), surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexWrap === 'wrap')
  expect(rows.length).toBe(1)
  expect(rows[0]?.text).toContain('Service')
  expect(rows[0]?.text).toContain('Gateway')
  expect(rows[0]?.text).not.toContain('After.')
  await ui.unmount()
})

test('code blocks, tables and quotes get a copy button, tables an art button, the reply a copy reply button', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const text = `${TABLE}\n\n\`\`\`bash\nls -la\n\`\`\`\n\n> reply text\n\nplain paragraph`
  const ui = await $.ui.mount({ ...draw(text), surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.length).toBe(5)
  expect(buttons.every(b => b.props.variant === "primary")).toBe(true)
  await ui.press({ key: 'copy1' })
  expect(copied).toEqual(['ls -la'])
  await ui.unmount()
})

const COPY_SAMPLE = `${TABLE}\n\n\`\`\`bash\nls -la\n\`\`\`\n\n> reply text\n\nplain paragraph`

const floatingCopies = async (ui: { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown>; text?: string }[]> }) =>
  (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.display === 'none').map(b => b.text)

type DrawnNode = { props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
const floatingReveals = (node: DrawnNode): unknown[] => [
  ...(node.props?.position === 'absolute' ? [node.hover] : []),
  ...(node.children ?? []).flatMap(child => (child && typeof child === 'object' ? floatingReveals(child as DrawnNode) : [])),
]

test('copyButtonStyle hover floats every copy button out of the flow, shown only while its block is hovered', { options: { copyButtonStyle: 'hover' } }, async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount({ ...draw(COPY_SAMPLE), surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  expect(await floatingCopies(ui)).toEqual(['⧉ md⧉ art', '⧉ copy', '⧉ copy', '⧉ copy reply'])
  expect(floatingReveals((await ui.drawn()) as DrawnNode)).toEqual(Array(4).fill({ display: 'flex' }))
  await ui.press({ key: 'copy1' })
  expect(copied).toEqual(['ls -la'])
  await ui.unmount()
})

const SIDES = ['top', 'bottom', 'left', 'right'] as const
const hoverPlaces = async (ui: { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown>; text?: string }[]> }) =>
  (await ui.findAll({ type: 'Box' }))
    .filter(b => b.props.position === 'absolute' && b.props.display === 'none')
    .map((b): Record<string, unknown> => ({ text: b.text, ...Object.fromEntries(SIDES.filter(side => b.props[side] !== undefined).map(side => [side, b.props[side]])) }))

test('copyButtonStyle hover puts every button on cells its block leaves empty: past a short row, or on a code header\'s free end', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('| Region | p99 |\n|---|---:|\n| eu | 12 |\n\n```bash\nls\n```\n\n> ```bash\n> npm test\n> ```\n>\n> Run that first.'), surface: 'terminal' })
  const boxTable = '│ Region │ p99 │'.length
  expect(await hoverPlaces(ui)).toEqual([
    { text: '⧉ md⧉ art', top: 0, left: boxTable },
    { text: '⧉ copy', top: 0, left: '── bash'.length },
    { text: '⧉ copy', top: 0, left: '── bash'.length },
    { text: '⧉ copy', bottom: 0, left: '│ Run that first.'.length },
    { text: '⧉ copy reply', top: -1, right: 0 },
  ])
  for (const float of (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')) {
    expect(float.props.minWidth).toBeUndefined()
    expect(float.props.width).toBeUndefined()
  }
  await ui.unmount()
})

test('copyButtonStyle hover keeps a code block\'s button at its header\'s right end when the label leaves room, else just past the label', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const line = 'npm --prefix scripts run snapshot -- --update'
  const ui = await $.ui.mount({ ...draw(`\`\`\`bash\n${line}\n\`\`\`\n\n\`\`\`\nx\n\`\`\``), surface: 'terminal' })
  expect(2 + line.length - '[ ⧉ copy ]'.length).toBeGreaterThan('── bash'.length)
  expect((await hoverPlaces(ui)).slice(0, 2)).toEqual([
    { text: '⧉ copy', top: 0, right: 0 },
    { text: '⧉ copy', top: 0, left: '── code'.length },
  ])
  await ui.unmount()
})

test('copyButtonStyle hover sets the buttons of narrow tables, quotes, lists and alerts just past their first row', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('| a | b |\n|---|---|\n| 1 | 2 |\n\nText.\n\n> z\n\n- y\n\n> [!NOTE]\n> w'), surface: 'terminal' })
  expect((await hoverPlaces(ui)).filter(p => p.text !== '⧉ copy reply')).toEqual([
    { text: '⧉ md⧉ art', top: 0, left: '│ a │ b │'.length },
    { text: '⧉ copy', top: 0, left: '│ z'.length },
    { text: '⧉ copy', top: 0, left: '• y'.length },
    { text: '⧉ copy', top: 0, left: '╭ Note ╮'.length },
  ])
  await ui.unmount()
})

test('copyButtonStyle hover moves a full block\'s buttons to the blank row below it, or above it at the reply\'s end, clear of ⧉ copy reply', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(`${TABLE}\n\nBetween the tables.\n\n${TABLE}`), viewport: { columns: 44, rows: 40 }, surface: 'terminal' })
  const border = (await ui.findAll({ type: 'Text' })).find(t => t.text?.startsWith('┌'))!.text!
  const reply = '[ ⧉ copy reply ]'.length
  const places = await hoverPlaces(ui)
  expect(places).toEqual([
    { text: '⧉ md⧉ art', bottom: -1, left: 0, right: 0 },
    { text: '⧉ md⧉ art', top: -1, left: 0, right: places[1]!.right },
    { text: '⧉ copy reply', top: -1, right: 0 },
  ])
  expect(width(border) - Number(places[1]!.right) + 1 + reply).toBeLessThanOrEqual(40)
  await ui.unmount()
})

test('copyButtonStyle hover gives a block no buttons when none of its rows or neighbors have room, rather than covering text', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), viewport: { columns: 44, rows: 40 }, surface: 'terminal' })
  expect(await hoverPlaces(ui)).toEqual([])
  expect((await ui.find({ key: 'c0' }))?.props.minWidth).toBe('[ ⧉ md ] [ ⧉ art ]'.length)
  await ui.unmount()
  const alert = await $.ui.mount({ ...draw('> [!NOTE]\n> ```\n> x\n> ```'), surface: 'terminal' })
  expect(await hoverPlaces(alert)).toEqual([{ text: '⧉ copy', top: 0, left: 4 + '[ ⧉ copy ]'.length }])
  await alert.unmount()
})

type PlacedNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const placedKids = (node: PlacedNode) => (node.children ?? []).filter((child): child is PlacedNode => !!child && typeof child === 'object')
const placedIn = (node: PlacedNode): Record<string, unknown>[] => [
  ...(node.props?.position === 'absolute' && node.props.display === 'none' ? [node.props] : []),
  ...placedKids(node).flatMap(placedIn),
]
const elementsOf = (tree: PlacedNode): PlacedNode[] => placedKids(placedKids(tree)[1]!)

test('copyButtonStyle hover never reaches past the reply: no button on the row above its first block or below its last, none on a list item\'s rows', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const samples = [
    COPY_SAMPLE,
    `${TABLE}\n\nBetween.\n\n${TABLE}`,
    '```bash\nnpm --prefix scripts run snapshot -- --update --and --more --flags --here\n```\n\n> ```bash\n> npm test\n> ```\n>\n> Run that first and then keep reading the rest of this long line.',
    '- item\n  ```bash\n  npm --prefix scripts run snapshot -- --update --and --more --flags\n  ```\n- next',
  ]
  for (const columns of [44, 80, 120]) for (const text of samples) {
    const ui = await $.ui.mount({ ...draw(text), viewport: { columns, rows: 40 }, surface: 'terminal' })
    const elements = elementsOf((await ui.drawn()) as PlacedNode)
    expect(placedIn(elements[0]!).filter(p => p.top === -1)).toEqual([])
    expect(placedIn(elements.at(-1)!).filter(p => p.bottom === -1)).toEqual([])
    if (text.startsWith('- item')) expect(placedIn(elements[0]!).filter(p => p.top === -1 || p.bottom === -1)).toEqual([])
    await ui.unmount()
  }
})

const hosted = (node: PlacedNode, host?: PlacedNode): { float: Record<string, unknown>; host?: PlacedNode; labels: string[] }[] => [
  ...(node.props?.position === 'absolute' && node.props.display === 'none' ? [{ float: node.props, host, labels: placedLabels(node) }] : []),
  ...placedKids(node).flatMap(child => hosted(child, node)),
]
const placedLabels = (node: PlacedNode): string[] => (node.type === 'Button' ? [String(node.props?.label)] : placedKids(node).flatMap(placedLabels))

test('copyButtonStyle hover keeps every button within reach of its block: a float past a row sits inside the block\'s box, one in a blank row spans the block\'s width', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const samples = [COPY_SAMPLE, `${TABLE}\n\nBetween.\n\n${TABLE}`, '| a |\n|---|\n| 1 |\n\n```\nx\n```\n\n- y\n\n> z\n\n> [!NOTE]\n> w', 'Intro.\n\n| k | v |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |', '- item\n  ```\n  x\n  ```\n\n> ```\n> q\n> ```\n>\n> after']
  for (const columns of [44, 120]) for (const text of samples) {
    const ui = await $.ui.mount({ ...draw(text), viewport: { columns, rows: 40 }, surface: 'terminal' })
    const tree = (await ui.drawn()) as PlacedNode
    const top = new Set(elementsOf(tree))
    for (const { float, host, labels } of hosted(tree)) {
      if (labels.includes('⧉ copy reply')) continue
      const need = labels.reduce((w, label) => w + (w ? 1 : 0) + width(`[ ${label} ]`), 0)
      if (float.top === -1 || float.bottom === -1) expect({ left: float.left, spans: float.right !== undefined }).toEqual({ left: 0, spans: true })
      else if (typeof float.left === 'number' && float.left > 0) expect({ paddingLeft: float.paddingLeft, inside: !top.has(host!) || Number(host?.props?.minWidth) >= float.left + 1 + need }).toEqual({ paddingLeft: 1, inside: true })
    }
    await ui.unmount()
  }
})

test('copyButtonStyle hover sets ⧉ copy reply past a closing one-line paragraph, else past the last one-line paragraph when the end has no free row for it', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const closing = await $.ui.mount({ ...draw(COPY_SAMPLE), surface: 'terminal' })
  expect((await hoverPlaces(closing)).at(-1)).toEqual({ text: '⧉ copy reply', top: 0, left: 'plain paragraph'.length + 1 })
  await closing.unmount()
  const intro = 'Two tables close this reply.'
  const figures = await $.ui.mount({ ...draw(`${intro}\n\n| k | v |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |`), surface: 'terminal' })
  expect(await hoverPlaces(figures)).toEqual([
    { text: '⧉ copy reply', top: 0, left: intro.length + 1 },
    { text: '⧉ md⧉ art', top: -1, left: 0, right: 0 },
    { text: '⧉ md⧉ art', top: -1, left: 0, right: 0 },
  ])
  await figures.unmount()
})

test('copyButtonStyle hover makes a block at least as wide as its buttons, and wide enough to hold buttons set past its row', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('| a |\n|---|\n| 1 |\n\n```\nx\n```'), surface: 'terminal' })
  expect((await ui.find({ key: 'c0' }))?.props.minWidth).toBe('│ a │'.length + 1 + '[ ⧉ md ] [ ⧉ art ]'.length)
  expect((await ui.find({ key: 'b1' }))?.props.minWidth).toBe('── code'.length + 1 + '[ ⧉ copy ]'.length)
  await ui.unmount()
  const wide = await $.ui.mount({ ...draw(TABLE), viewport: { columns: 44, rows: 40 }, surface: 'terminal' })
  expect((await wide.find({ key: 'c0' }))?.props.minWidth).toBe('[ ⧉ md ] [ ⧉ art ]'.length)
  await wide.unmount()
})

test('copyButtonStyle hover reserves its buttons\' width beside a narrow block, so a table drawn next to it never covers them', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('| a | b |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |'), surface: 'terminal' })
  for (const key of ['c0', 'c1']) expect((await ui.find({ key }))?.props.minWidth).toBe('[ ⧉ md ] [ ⧉ art ]'.length)
  await ui.unmount()
})

test('copyButtonStyle inline, the default, keeps every copy button in the flow', async $ => {
  const ui = await $.ui.mount({ ...draw(COPY_SAMPLE), surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  expect(await floatingCopies(ui)).toHaveLength(0)
  await ui.unmount()
})

test('copyButtonStyle hover draws inline on mobile, which has no pointer', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(COPY_SAMPLE), surface: 'mobile' })
  expect(await floatingCopies(ui)).toHaveLength(0)
  await ui.unmount()
})

test('copyButtons off draws no buttons', { options: { copyButtons: false } }, async $ => {
  const ui = await $.ui.mount({ ...draw(`${TABLE}\n\n\`\`\`bash\nls\n\`\`\``), surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('lists copy as markdown', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount({ ...draw('1. Build\n2. Ship\n   - canary'), surface: 'terminal' })
  const [button] = await ui.findAll({ type: 'Button' })
  await ui.press({ key: button!.key! })
  expect(copied).toEqual(['1. Build\n2. Ship\n   - canary'])
  await ui.unmount()
})

test('diagrams offer two copies: mermaid source and drawn art', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount({ ...draw(FLOW), surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['⧉ source', '⧉ art', '⧉ copy reply'])
  for (const b of buttons) await ui.press({ key: b.key! })
  expect(copied[0]).toBe('graph LR\nA[User] --> B[Gateway]')
  expect(copied[1]).toContain('┌')
  await ui.unmount()
})

test('JSON and YAML get keys, strings, numbers and comments colored', async $ => {
  const t = PRESETS['catppuccin-mocha']
  const ui = await $.ui.mount({ ...draw('```yaml\nname: "shop" # app\nreplicas: 3\n```'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^name$/ }))?.props.color).toBe(t.codeCommand)
  expect((await ui.find({ type: 'Text', text: /^"shop"$/ }))?.props.color).toBe(t.codeString)
  expect((await ui.find({ type: 'Text', text: /^3$/ }))?.props.color).toBe(t.number)
  expect((await ui.find({ type: 'Text', text: /^# app$/ }))?.props.color).toBe(t.codeComment)
  await ui.unmount()
})

test('Prism colors TypeScript keywords, strings and comments', async $ => {
  const t = PRESETS['catppuccin-mocha']
  const ui = await $.ui.mount({ ...draw('```ts\nconst name = "shop" // app\n```'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^const$/ }))?.props.color).toBe(t.codeFlag)
  expect((await ui.find({ type: 'Text', text: /^"shop"$/ }))?.props.color).toBe(t.codeString)
  expect((await ui.find({ type: 'Text', text: /^\/\/ app$/ }))?.props.italic).toBe(true)
  await ui.unmount()
})

test('fence languages that name Prism internals fall back to plain code', async $ => {
  for (const lang of ['extend', 'toString', 'constructor', '__proto__']) {
    const ui = await $.ui.mount({ ...draw(`\`\`\`${lang}\nhello\n\`\`\``), surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /^hello$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].codeText)
    await ui.unmount()
  }
})

test('code blocks draw through the native Code element off the terminal', async $ => {
  const ui = await $.ui.mount({ ...draw('```ts\nconst name = "shop"\n  return name\n```'), surface: 'desktop' })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe('const name = "shop"\n  return name')
  expect(code?.props.language).toBe('ts')
  expect(code?.props.startLine).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^const$/ })).toBeUndefined()
  await ui.unmount()
  const long = await $.ui.mount({ ...draw(longCode(12)), surface: 'desktop' })
  expect((await long.find({ type: 'Code' }))?.props.startLine).toBe(1)
  expect(await long.find({ type: 'Text', text: /^ 1  $/ })).toBeUndefined()
  await long.unmount()
  const term = await $.ui.mount({ ...draw('```ts\nconst name = "shop"\n```'), surface: 'terminal' })
  expect(await term.find({ type: 'Code' })).toBeUndefined()
  await term.unmount()
})

test('tables draw boxed by default, with a double line under the header', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...draw(TABLE), surface })
    const top = (await ui.find({ type: 'Text', text: /^┌[─┬]+┐$/ }))?.text ?? ''
    expect(top.split('┬').length).toBe(3)
    const lines = [top, ...(await Promise.all([/^╞[═╪]+╡$/, /^├[─┼]+┤$/, /^└[─┴]+┘$/].map(async re => (await ui.find({ type: 'Text', text: re }))?.text ?? '')))]
    expect(lines.every(l => l.length === top.length && l.length > 0)).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^Service$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].tableHeader)
    await ui.unmount()
  }
})

test('tableStyle rules keeps the open look', { options: { tableStyle: 'rules' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /┌|│/ })).toBeUndefined()
  await ui.unmount()
})

const longCode = (n: number) => `\`\`\`text\n${Array.from({ length: n }, (_, i) => `step ${i + 1}`).join('\n')}\n\`\`\``

test('code blocks of 10+ lines get one numbered Text per line, shorter ones none', async $ => {
  const ui = await $.ui.mount({ ...draw(longCode(12)), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ 1  $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^12  $/ })).toBeDefined()
  await ui.unmount()
  const short = await $.ui.mount({ ...draw(longCode(9)), surface: 'terminal' })
  expect(await short.find({ type: 'Text', text: /^step 9$/ })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /^9  step 9$/ })).toBeUndefined()
  await short.unmount()
})

test('a wrapped numbered line keeps its continuation after the gutter', async $ => {
  const long = `${'word '.repeat(40).trim()}`
  const text = `\`\`\`text\n${[long, ...Array.from({ length: 11 }, (_, i) => `step ${i + 2}`)].join('\n')}\n\`\`\``
  const ui = await $.ui.mount({ ...draw(text), surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row' && /^ 1  /.test(b.text ?? ''))
  expect(rows.length).toBe(1)
  expect((await ui.find({ type: 'Text', text: /^ 1  $/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: long }))).toBeDefined()
  await ui.unmount()
})

test('long code blocks fold to 20 lines, open and fold back on press, and copy every line', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  for (const [surface, n] of [['terminal', 40], ['desktop', 45]] as const) {
    const ui = await $.ui.mount({ ...draw(longCode(n)), surface })
    const shown = async () => surface === 'desktop' ? String((await ui.find({ type: 'Code' }))!.props.source).split('\n').length : (await ui.findAll({ type: 'Text', text: /^ *\d+  $/ })).length
    expect(await shown()).toBe(20)
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe(`+${n - 20} more lines`)
    await ui.press({ key: 'copy0' })
    expect(copied.at(-1)).toBe(Array.from({ length: n }, (_, i) => `step ${i + 1}`).join('\n'))
    await ui.press({ key: 'fold0' })
    expect(await shown()).toBe(n)
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
    await ui.press({ key: 'fold0' })
    expect(await shown()).toBe(20)
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe(`+${n - 20} more lines`)
    await ui.unmount()
  }
})

test('two code blocks that differ only in where lines break fold on their own', async $ => {
  const body = Array.from({ length: 29 }, () => 'x').join('\n')
  const ui = await $.ui.mount({ ...draw(`\`\`\`text\nab\nc\n${body}\n\`\`\`\n\nand\n\n\`\`\`text\na\nbc\n${body}\n\`\`\``), surface: 'terminal' as const })
  await ui.press({ key: 'fold0' })
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
  expect((await ui.find({ key: 'fold2' }))?.props.label).toBe('+11 more lines')
  await ui.unmount()
})
