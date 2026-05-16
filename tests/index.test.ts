import {TextSelection} from 'prosemirror-state'
import type {EditorView} from 'prosemirror-view'
import {expect, test} from 'vitest'
import {
  EntryEditor,
  Informe,
  input,
  parseEntryText,
  randomIds,
  type Entry,
  type RawEntry,
} from '../src'
import {diffEntries, resolvedViewDiffers} from '../src/changes'
import {
  getSchemaKeySuggestions,
  getSchemaKeyTypeaheadMatch,
  getSchemaValueSuggestions,
  getSchemaValueTypeaheadMatch,
  isPatternValid,
} from '../src/editor'
import {
  EntryStamper,
  InformeIdCollisionError,
  orderBetween,
  validateOrderInput,
} from '../src/id'

function rawEntryData(entries: readonly RawEntry[]) {
  return entries.map(({id: _id, order: _order, ...entry}) => entry)
}

function expectStamped(entries: readonly RawEntry[]): void {
  for (const entry of entries) {
    expect(entry.id).toEqual(expect.any(String))
    expect(entry.order).toEqual(expect.any(String))
  }

  for (let index = 1; index < entries.length; index++) {
    expect(entries[index - 1].order < entries[index].order).toBe(true)
  }
}

function installLayoutMocks(): void {
  const rect = {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
  const rects = Object.assign([rect], {
    item: (index: number) => rects[index] ?? null,
  })

  for (const prototype of [
    HTMLElement.prototype,
    SVGElement.prototype,
    Range.prototype,
    Text.prototype,
  ] as Array<{
    getBoundingClientRect?: () => typeof rect
    getClientRects?: () => typeof rects
  }>) {
    prototype.getBoundingClientRect ??= () => rect
    prototype.getClientRects ??= () => rects
  }
}

function createTestEditor(
  entries: readonly Entry[],
  options: ConstructorParameters<typeof EntryEditor>[1] = {},
) {
  installLayoutMocks()

  const container = document.createElement('div')
  document.body.append(container)

  const editor = new EntryEditor(container, {...options, entries})
  const view = (editor as unknown as {view: EditorView}).view

  return {
    editor,
    view,
    destroy() {
      editor.destroy()
      container.remove()
    },
  }
}

function entryPosition(view: EditorView, entryIndex: number, offset: number): number {
  let position = 1

  for (let index = 0; index < entryIndex; index++) {
    position += view.state.doc.child(index).nodeSize
  }

  return position + offset
}

function setCursor(view: EditorView, entryIndex: number, offset: number): void {
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, entryPosition(view, entryIndex, offset)),
    ),
  )
}

function setTextSelection(
  view: EditorView,
  entryIndex: number,
  fromOffset: number,
  toOffset: number,
): void {
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        entryPosition(view, entryIndex, fromOffset),
        entryPosition(view, entryIndex, toOffset),
      ),
    ),
  )
}

function setTextSelectionAcrossEntries(
  view: EditorView,
  fromEntryIndex: number,
  fromOffset: number,
  toEntryIndex: number,
  toOffset: number,
): void {
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        entryPosition(view, fromEntryIndex, fromOffset),
        entryPosition(view, toEntryIndex, toOffset),
      ),
    ),
  )
}

function pressEnter(view: EditorView): void {
  pressKey(view, 'Enter')
}

function pressTab(view: EditorView): void {
  pressKey(view, 'Tab')
}

function pressModEnter(view: EditorView): void {
  pressKey(view, 'Enter', {metaKey: true})
}

function pressKey(
  view: EditorView,
  key: string,
  options: KeyboardEventInit = {},
): void {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  })

  view.dom.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
}

function typeText(view: EditorView, text: string): void {
  const {from, to} = view.state.selection

  view.someProp('handleTextInput', (handler) => {
    handler(view, from, to, text)
    return undefined
  })
  view.dispatch(view.state.tr.insertText(text, from, to))
}

test('parses key/value entry text', () => {
  expect(parseEntryText('caption:Hello world')).toEqual({
    key: 'caption',
    value: 'Hello world',
  })
})

test('preserves leading, trailing, and newline whitespace in values', () => {
  expect(parseEntryText('caption:  Hello world  ')).toEqual({
    key: 'caption',
    value: '  Hello world  ',
  })

  expect(parseEntryText('caption:Hello\nworld')).toEqual({
    key: 'caption',
    value: 'Hello\nworld',
  })
})

test('renders a real DOM space between separator and value without parsing it as value', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    const gap = view.dom.querySelector<HTMLElement>('.informe-entry-separator-gap')

    expect(gap).not.toBeNull()
    expect(gap?.textContent).toBe(' ')
    expect(gap?.contentEditable).toBe('false')
    expect(view.dom.textContent).toContain('name: Bob')
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bob'},
    ])
  } finally {
    destroy()
  }
})

test('parses key-only entry text', () => {
  expect(parseEntryText(' disabled ')).toEqual({
    key: 'disabled',
    value: '',
  })
})

test('Enter at the end of an entry inserts an empty entry below', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    setCursor(view, 0, 'name:Bob'.length)
    pressEnter(view)

    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(0).textContent).toBe('name:Bob')
    expect(view.state.doc.child(1).textContent).toBe('')
    expect(view.state.doc.child(0).attrs.id).toBe('first')
    expect(view.state.doc.child(1).attrs.id).not.toBe('first')
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bob'},
      {key: '', value: ''},
    ])
  } finally {
    destroy()
  }
})

test('Enter in the middle of an entry splits following text into a new entry', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    setCursor(view, 0, 'name:Bo'.length)
    pressEnter(view)

    const entries = editor.getEntries()
    expect(rawEntryData(entries)).toEqual([
      {key: 'name', value: 'Bo'},
      {key: 'b', value: ''},
    ])
    expect(entries[0].id).toBe('first')
    expect(entries[1].id).not.toBe('first')
  } finally {
    destroy()
  }
})

test('Enter at the start of the first entry inserts a blank entry above', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    setCursor(view, 0, 0)
    pressEnter(view)

    const entries = editor.getEntries()
    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(0).textContent).toBe('')
    expect(view.state.doc.child(0).attrs.id).toBe('first')
    expect(rawEntryData(entries)).toEqual([
      {key: '', value: ''},
      {key: 'name', value: 'Bob'},
    ])
    expect(entries[0].id).toBe('first')
    expect(entries[1].id).not.toBe('first')
  } finally {
    destroy()
  }
})

test('Enter in the middle of a disabled entry keeps both split entries disabled', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob', disabled: true},
  ])

  try {
    setCursor(view, 0, 'name:Bo'.length)
    pressEnter(view)

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bo', disabled: true},
      {key: 'b', value: '', disabled: true},
    ])
  } finally {
    destroy()
  }
})

test('Enter at the end of a disabled entry creates an enabled empty entry', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob', disabled: true},
  ])

  try {
    setCursor(view, 0, 'name:Bob'.length)
    pressEnter(view)

    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(0).attrs.disabled).toBe(true)
    expect(view.state.doc.child(1).textContent).toBe('')
    expect(view.state.doc.child(1).attrs.disabled).toBe(false)
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bob', disabled: true},
      {key: '', value: ''},
    ])
  } finally {
    destroy()
  }
})

test('Cmd+Enter toggles the focused entry disabled state', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    setCursor(view, 0, 'name:Bo'.length)
    pressModEnter(view)

    expect(view.state.doc.childCount).toBe(1)
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bob', disabled: true},
    ])

    pressModEnter(view)

    expect(view.state.doc.childCount).toBe(1)
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bob'},
    ])
  } finally {
    destroy()
  }
})

test('Enter deletes a selected range before splitting the entry', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    setTextSelection(view, 0, 'name:'.length, 'name:Bo'.length)
    pressEnter(view)

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: '', hasSeparator: true},
      {key: 'b', value: ''},
    ])
  } finally {
    destroy()
  }
})

test('Backspace deletes a selection spanning multiple entries', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'a', value: '111'},
    {id: 'second', order: 'a1', key: 'b', value: '222'},
  ])

  try {
    setTextSelectionAcrossEntries(view, 0, 'a:1'.length, 1, 'b:2'.length)
    pressKey(view, 'Backspace')

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'a', value: '122'},
    ])
  } finally {
    destroy()
  }
})

test('Backspace at start of value deletes the separator', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: '', hasSeparator: true},
  ])

  try {
    setCursor(view, 0, 'name:'.length)
    pressKey(view, 'Backspace')

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: ''},
    ])
    expect(view.state.selection.from).toBe(entryPosition(view, 0, 'name'.length))
  } finally {
    destroy()
  }
})

test('Delete deletes a selection spanning multiple entries', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'a', value: '111'},
    {id: 'second', order: 'a1', key: 'b', value: '222'},
  ])

  try {
    setTextSelectionAcrossEntries(view, 0, 'a:1'.length, 1, 'b:2'.length)
    pressKey(view, 'Delete')

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'a', value: '122'},
    ])
  } finally {
    destroy()
  }
})

test('Backspace at start of entry deletes the previous entry when it is strictly empty', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: '', value: ''},
    {id: 'second', order: 'a1', key: 'name', value: 'Bob'},
  ])

  try {
    setCursor(view, 1, 0)
    pressKey(view, 'Backspace')

    expect(view.state.doc.childCount).toBe(1)
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bob'},
    ])
    // Cursor should be at offset 0 of the surviving entry
    expect(view.state.selection.from).toBe(1)
  } finally {
    destroy()
  }
})

test('Backspace at start of entry merges into a non-empty previous entry', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
    {id: 'second', order: 'a1', key: 'age', value: '25'},
  ])

  try {
    setCursor(view, 1, 0)
    pressKey(view, 'Backspace')

    expect(view.state.doc.childCount).toBe(1)
    // Text is merged: "name:Bob" + "age:25" → key "name", value "Bobage:25"
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bobage:25'},
    ])
    // Cursor is at the join point: right after "name:Bob" (offset 8)
    expect(view.state.selection.from).toBe(9)
    // Surviving entry retains the first entry's id
    expect(editor.getEntries()[0].id).toBe('first')
  } finally {
    destroy()
  }
})

test('Backspace at start of entry with whitespace-only previous entry merges (not deletes)', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: ' ', value: ''},
    {id: 'second', order: 'a1', key: 'age', value: '25'},
  ])

  try {
    setCursor(view, 1, 0)
    pressKey(view, 'Backspace')

    // Whitespace-only previous entry is not empty, so it merges.
    // Keys are trimmed by parseEntryNodeText, so ' age' trims to 'age'.
    expect(view.state.doc.childCount).toBe(1)
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'age', value: '25'},
    ])
  } finally {
    destroy()
  }
})

test('Backspace at start of entry merges with a disabled previous entry', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob', disabled: true},
    {id: 'second', order: 'a1', key: 'age', value: '25'},
  ])

  try {
    setCursor(view, 1, 0)
    pressKey(view, 'Backspace')

    expect(view.state.doc.childCount).toBe(1)
    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bobage:25', disabled: true},
    ])
  } finally {
    destroy()
  }
})

test('Backspace at start of the first entry does not delete anything when entry has content', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    setCursor(view, 0, 0)
    // backspaceCommand returns false here (no previous entry, current not empty)
    // so we dispatch manually rather than pressKey (which asserts defaultPrevented)
    const before = rawEntryData(editor.getEntries())
    view.someProp('handleKeyDown', (fn) => fn(view, new KeyboardEvent('keydown', {key: 'Backspace', bubbles: true, cancelable: true})))

    expect(rawEntryData(editor.getEntries())).toEqual(before)
  } finally {
    destroy()
  }
})

test('detects typeahead key replacement ranges before a separator exists', () => {
  expect(getSchemaKeyTypeaheadMatch('fo', 2)).toEqual({
    query: 'fo',
    keyText: 'fo',
    replaceFromOffset: 0,
    replaceToOffset: 2,
  })

  expect(getSchemaKeyTypeaheadMatch('fo Pizza', 2)).toEqual({
    query: 'fo',
    keyText: 'fo Pizza',
    replaceFromOffset: 0,
    replaceToOffset: 2,
  })

  expect(getSchemaKeyTypeaheadMatch('fo: Pizza', 2)).toBeUndefined()
  expect(getSchemaKeyTypeaheadMatch('food: Pizza', 6)).toBeUndefined()
})

test('accepting a key suggestion preserves text after the cursor as the value', () => {
  const {editor, view, destroy} = createTestEditor(
    [{id: 'first', order: 'a0', key: 'Bob', value: ''}],
    {schema: {name: {}}},
  )

  try {
    view.focus()
    setCursor(view, 0, 0)
    typeText(view, 'na')
    pressTab(view)

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: 'Bob'},
    ])
    expect(view.state.doc.child(0).textContent).toBe('name:Bob')
  } finally {
    destroy()
  }
})

test('accepting a key suggestion preserves suffix whitespace in the value', () => {
  const {editor, view, destroy} = createTestEditor(
    [{id: 'first', order: 'a0', key: ' Bob', value: ''}],
    {schema: {name: {}}},
  )

  try {
    view.focus()
    setCursor(view, 0, 0)
    typeText(view, 'na')
    pressTab(view)

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: ' Bob'},
    ])
    expect(view.state.doc.child(0).textContent).toBe('name: Bob')
  } finally {
    destroy()
  }
})

test('accepting a key suggestion preserves an empty value separator across setEntries', () => {
  const {editor, view, destroy} = createTestEditor(
    [{id: 'first', order: 'a0', key: '', value: ''}],
    {schema: {name: {}}},
  )

  try {
    view.focus()
    setCursor(view, 0, 0)
    typeText(view, 'na')
    pressTab(view)

    expect(rawEntryData(editor.getEntries())).toEqual([
      {key: 'name', value: '', hasSeparator: true},
    ])
    expect(view.state.doc.child(0).textContent).toBe('name:')

    editor.setEntries(editor.getEntries(), {emitInput: false})

    expect(view.state.doc.child(0).textContent).toBe('name:')
  } finally {
    destroy()
  }
})

test('blank entries are preserved across setEntries', () => {
  const {editor, view, destroy} = createTestEditor([
    {id: 'first', order: 'a0', key: 'name', value: 'Bob'},
  ])

  try {
    setCursor(view, 0, 'name:Bob'.length)
    pressEnter(view)

    const entries = editor.getEntries()
    expect(rawEntryData(entries)).toEqual([
      {key: 'name', value: 'Bob'},
      {key: '', value: ''},
    ])

    editor.setEntries(entries, {emitInput: false})

    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(1).textContent).toBe('')
  } finally {
    destroy()
  }
})

test('filters schema key suggestions by key and label', () => {
  const suggestions = getSchemaKeySuggestions(
    {
      name: {label: 'Full name', description: 'What should we call you?'},
      food: {description: 'What is your favorite food?'},
      email: {required: true},
      contact: {label: 'Email address'},
    },
    'em',
  )

  expect(suggestions).toEqual([
    {
      key: 'email',
      label: undefined,
      description: undefined,
      type: undefined,
      required: true,
    },
    {
      key: 'contact',
      label: 'Email address',
      description: undefined,
      type: undefined,
      required: false,
    },
  ])
})

test('excludes existing keys only before the user has typed a query', () => {
  const schema = {
    name: {},
    age: {},
    food: {},
  }
  const existingKeys = new Set(['name', 'age'])

  expect(
    getSchemaKeySuggestions(schema, '', {
      excludeKeysWhenQueryEmpty: existingKeys,
    }).map(({key}) => key),
  ).toEqual(['food'])

  expect(
    getSchemaKeySuggestions(schema, 'a', {
      excludeKeysWhenQueryEmpty: existingKeys,
    }).map(({key}) => key),
  ).toEqual(['age', 'name'])
})

test('validates string values against descriptor patterns', () => {
  expect(isPatternValid('', {type: 'string', pattern: 'foo'})).toBe(false)
  expect(isPatternValid('   ', {type: 'string', pattern: 'foo'})).toBe(false)
  expect(isPatternValid('foobar', {type: 'string', pattern: 'foo'})).toBe(false)
  expect(isPatternValid('foo', {type: 'string', pattern: 'foo'})).toBe(true)
  expect(isPatternValid('xfooy', {type: 'string', pattern: /foo/})).toBe(true)
  expect(isPatternValid('foo', {type: 'number', pattern: 'bar'})).toBe(true)
  expect(isPatternValid('foo', {type: 'string'})).toBe(true)
})

test('input infers descriptor type from the default', () => {
  expect(input({label: 'Full name', default: 'Bob', required: true})).toMatchObject({
    label: 'Full name',
    default: 'Bob',
    required: true,
    type: 'string',
  })

  expect(input({default: 50, min: 1, max: 99})).toMatchObject({
    default: 50,
    min: 1,
    max: 99,
    type: 'number',
  })
})

test('Informe creates initial entries for defaults and required fields', () => {
  const informe = new Informe({
    name: 'Bob',
    age: input({type: 'number', default: 50, min: 1, max: 99}),
    food: input({description: 'What is your favorite food?'}),
    email: input({label: 'Email address', required: true}),
  })

  expectStamped(informe.rawEntries())
  expect(informe.rawEntries().map(({id}) => id)).toEqual(['1', '2', '3'])
  expect(rawEntryData(informe.rawEntries())).toEqual([
    {key: 'name', value: 'Bob'},
    {key: 'age', value: '50'},
    {key: 'email', value: ''},
  ])
})

test('fractional orders are created between neighboring orders', () => {
  const first = orderBetween(undefined, undefined)
  const second = orderBetween(first, undefined)
  const middle = orderBetween(first, second)

  expect(first < middle).toBe(true)
  expect(middle < second).toBe(true)
  expect(validateOrderInput([
    {id: 'a', order: first, key: 'a', value: ''},
    {id: 'b', order: middle, key: 'b', value: ''},
    {id: 'c', order: second, key: 'c', value: ''},
  ])).toBe(true)
})

test('default entry stamper mints counter ids and advances past hydrated numeric ids', () => {
  const stamper = new EntryStamper()
  const initial = stamper.stampEntries([
    {key: 'name', value: 'Bob'},
    {key: 'age', value: '50'},
  ])

  expect(initial.map(({id}) => id)).toEqual(['1', '2'])
  expectStamped(initial)

  const hydrated = stamper.stampEntries([
    {id: '7', order: 'U', key: 'name', value: 'Ada'},
    {key: 'role', value: 'admin'},
  ])

  expect(hydrated.map(({id}) => id)).toEqual(['7', '8'])
  expectStamped(hydrated)
})

test('randomIds creates unique string ids', () => {
  const nextId = randomIds()
  const ids = new Set(Array.from({length: 10}, () => nextId()))

  expect(ids.size).toBe(10)
  for (const id of ids) {
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  }
})

test('Informe trusts complete valid hydrated order and recomputes invalid batches', () => {
  const informe = new Informe({name: 'Bob'})

  informe.setRawEntries([
    {id: 'a', order: 'a0', key: 'name', value: 'Ada'},
    {id: 'b', order: 'a1', key: 'role', value: 'admin'},
  ])

  expect(informe.rawEntries().map(({order}) => order)).toEqual(['a0', 'a1'])

  informe.setRawEntries([
    {id: 'a', order: 'a0', key: 'name', value: 'Ada'},
    {id: 'b', key: 'role', value: 'admin'},
  ])

  expect(informe.rawEntries().map(({order}) => order)).not.toEqual(['a0', undefined])
  expectStamped(informe.rawEntries())
})

test('custom id generator collision throws and aborts construction', () => {
  expect(
    () => new Informe(
      {
        name: 'Bob',
        age: 50,
      },
      {idGenerator: () => 'same'},
    ),
  ).toThrow(InformeIdCollisionError)
})

test('diffEntries reports adds, removes, and updates by entry id', () => {
  const previous: RawEntry[] = [
    {id: 'a', order: 'a0', key: 'name', value: 'Bob'},
    {id: 'b', order: 'a1', key: 'age', value: '50'},
    {id: 'c', order: 'a2', key: 'food', value: 'Pizza', disabled: true},
  ]
  const next: RawEntry[] = [
    {id: 'a', order: 'a0', key: 'name', value: 'Ada'},
    {id: 'c', order: 'a3', key: 'meal', value: 'Pizza'},
    {id: 'd', order: 'a4', key: 'color', value: 'blue'},
  ]

  expect(diffEntries(previous, next)).toEqual([
    {
      type: 'update',
      oldEntry: {id: 'a', order: 'a0', key: 'name', value: 'Bob'},
      newEntry: {id: 'a', order: 'a0', key: 'name', value: 'Ada'},
    },
    {
      type: 'update',
      oldEntry: {id: 'c', order: 'a2', key: 'food', value: 'Pizza', disabled: true},
      newEntry: {id: 'c', order: 'a3', key: 'meal', value: 'Pizza'},
    },
    {
      type: 'add',
      newEntry: {id: 'd', order: 'a4', key: 'color', value: 'blue'},
    },
    {
      type: 'remove',
      oldEntry: {id: 'b', order: 'a1', key: 'age', value: '50'},
    },
  ])
})

test('resolvedViewDiffers compares key sets and resolved values', () => {
  expect(resolvedViewDiffers({name: 'Bob'}, {name: 'Bob'})).toBe(false)
  expect(resolvedViewDiffers({name: 'Bob'}, {name: 'Ada'})).toBe(true)
  expect(resolvedViewDiffers({name: 'Bob'}, {name: 'Bob', age: 50})).toBe(true)
  expect(resolvedViewDiffers({name: 'Bob', age: 50}, {name: 'Bob'})).toBe(true)
  expect(resolvedViewDiffers({age: 12}, {age: 12})).toBe(false)
})

test('Informe change events fire synchronously after programmatic changes', () => {
  const informe = new Informe({name: 'Bob'})
  let callCount = 0

  informe.addEventListener('change', () => {
    callCount += 1
  })

  informe.append('name', 'Alice')

  expect(callCount).toBe(1)
  expect(rawEntryData(informe.rawEntries())).toEqual([
    {key: 'name', value: 'Bob'},
    {key: 'name', value: 'Alice'},
  ])
})

test('Informe input events include entry changes before change events', () => {
  const informe = new Informe({name: 'Bob'})
  const calls: string[] = []
  const changes: unknown[] = []

  informe.addEventListener('input', (event) => {
    calls.push('input')
    changes.push(event.detail.changes)
  })
  informe.addEventListener('change', () => {
    calls.push('change')
  })

  informe.set('name', 'Ada')

  expect(calls).toEqual(['input', 'change'])
  expect(changes).toEqual([
    [
      {
        type: 'update',
        oldEntry: {id: '1', order: 'a0', key: 'name', value: 'Bob'},
        newEntry: {id: '1', order: 'a0', key: 'name', value: 'Ada'},
      },
    ],
  ])
})

test('Informe suppresses input and change events for no-op mutations', () => {
  const informe = new Informe({name: 'Bob'})
  let inputCount = 0
  let changeCount = 0

  informe.addEventListener('input', () => {
    inputCount += 1
  })
  informe.addEventListener('change', () => {
    changeCount += 1
  })

  informe.set('name', 'Bob')

  expect(inputCount).toBe(0)
  expect(changeCount).toBe(0)
})

test('Informe append fires input with an add record and change', () => {
  const informe = new Informe({name: 'Bob'})
  let inputChanges: unknown
  let changeCount = 0

  informe.addEventListener('input', (event) => {
    inputChanges = event.detail.changes
  })
  informe.addEventListener('change', () => {
    changeCount += 1
  })

  informe.append('name', 'Alice')

  expect(inputChanges).toEqual([
    {
      type: 'add',
      newEntry: {id: '2', order: 'a1', key: 'name', value: 'Alice'},
    },
  ])
  expect(changeCount).toBe(1)
})

test('Informe delete fires one input event with all removed entries', () => {
  const informe = new Informe({name: 'Bob', age: input({type: 'number', default: 50})})
  let inputChanges: unknown
  let changeCount = 0

  informe.setRawEntries([
    {id: 'a', order: 'a0', key: 'name', value: 'Bob'},
    {id: 'b', order: 'a1', key: 'age', value: '50'},
    {id: 'c', order: 'a2', key: 'name', value: 'Alice', disabled: true},
    {id: 'd', order: 'a3', key: 'name', value: 'Eve'},
  ])

  informe.addEventListener('input', (event) => {
    inputChanges = event.detail.changes
  })
  informe.addEventListener('change', () => {
    changeCount += 1
  })

  informe.delete('name')

  expect(inputChanges).toEqual([
    {type: 'remove', oldEntry: {id: 'a', order: 'a0', key: 'name', value: 'Bob'}},
    {
      type: 'remove',
      oldEntry: {id: 'c', order: 'a2', key: 'name', value: 'Alice', disabled: true},
    },
    {type: 'remove', oldEntry: {id: 'd', order: 'a3', key: 'name', value: 'Eve'}},
  ])
  expect(changeCount).toBe(1)
})

test('Informe input can fire without change for non-winning entry updates', () => {
  const informe = new Informe({name: 'Bob'})
  let inputChanges: unknown
  let changeCount = 0

  informe.setRawEntries([
    {id: 'a', order: 'a0', key: 'name', value: 'Bob'},
    {id: 'b', order: 'a1', key: 'name', value: 'Eve'},
  ])

  informe.addEventListener('input', (event) => {
    inputChanges = event.detail.changes
  })
  informe.addEventListener('change', () => {
    changeCount += 1
  })

  informe.setRawEntries([
    {id: 'a', order: 'a0', key: 'name', value: 'Ada'},
    {id: 'b', order: 'a1', key: 'name', value: 'Eve'},
  ])

  expect(inputChanges).toEqual([
    {
      type: 'update',
      oldEntry: {id: 'a', order: 'a0', key: 'name', value: 'Bob'},
      newEntry: {id: 'a', order: 'a0', key: 'name', value: 'Ada'},
    },
  ])
  expect(changeCount).toBe(0)
})

test('Informe exposes standard event target listeners', () => {
  const informe = new Informe({
    name: 'Bob',
  })

  expect(informe).toBeInstanceOf(EventTarget)
})

test('Informe resolves typed values from the last enabled known entries', () => {
  const informe = new Informe({
    name: 'Bob',
    age: input({type: 'number', default: 50}),
    food: input({description: 'What is your favorite food?'}),
  })

  informe.setRawEntries([
    {key: 'name', value: 'Bob'},
    {key: 'age', value: 'broken'},
    {key: 'age', value: '60', disabled: true},
    {key: 'unknown', value: 'kept in entries only'},
    {key: 'name', value: 'Alice', disabled: true},
    {key: 'age', value: '70'},
    {key: 'name', value: 'Eve'},
  ])

  expect(Object.fromEntries(informe)).toEqual({
    name: 'Eve',
    age: 70,
    unknown: 'kept in entries only',
  })
  expect(informe.get('age')).toBe(70)
  expect(informe.get('food')).toBeUndefined()

  expect(rawEntryData(informe.rawEntries())).toContainEqual({key: 'unknown', value: 'kept in entries only'})
})

test('Informe returns undefined for blank or invalid number values', () => {
  const informe = new Informe({
    age: input({type: 'number', required: true}),
  })

  expect(informe.get('age')).toBeUndefined()
  expect(informe.has('age')).toBe(true)

  informe.setRawEntries([{key: 'age', value: 'not a number'}])

  expect(informe.get('age')).toBeUndefined()
})

test('Informe append adds a new winning entry while preserving duplicates', () => {
  const informe = new Informe({
    name: 'Bob',
  })

  informe.append('name', 'Alice')

  expect(informe.get('name')).toBe('Alice')
  expect(informe.getAll('name')).toEqual(['Bob', 'Alice'])
  expect(rawEntryData(informe.rawEntries())).toEqual([
    {key: 'name', value: 'Bob'},
    {key: 'name', value: 'Alice'},
  ])
})

test('Informe set overwrites the last enabled entry or appends when none is enabled', () => {
  const informe = new Informe({
    name: 'Bob',
  })

  informe.setRawEntries([
    {key: 'name', value: 'Bob'},
    {key: 'name', value: 'Alice', disabled: true},
    {key: 'name', value: 'Eve'},
  ])

  expect(informe.set('name', 'Ada')).toBe(informe)
  expect(rawEntryData(informe.rawEntries())).toEqual([
    {key: 'name', value: 'Bob'},
    {key: 'name', value: 'Alice', disabled: true},
    {key: 'name', value: 'Ada'},
  ])

  informe.setRawEntries([{key: 'name', value: 'Ada', disabled: true}])
  informe.set('name', 'Grace')

  expect(rawEntryData(informe.rawEntries())).toEqual([
    {key: 'name', value: 'Ada', disabled: true},
    {key: 'name', value: 'Grace'},
  ])
})

test('Informe delete removes all matching entries', () => {
  const informe = new Informe({
    name: 'Bob',
    age: input({type: 'number', default: 50}),
  })

  informe.setRawEntries([
    {key: 'name', value: 'Bob'},
    {key: 'age', value: '50'},
    {key: 'name', value: 'Alice', disabled: true},
    {key: 'name', value: 'Eve'},
  ])

  informe.delete('name')

  expect(informe.get('name')).toBeUndefined()
  expect(rawEntryData(informe.rawEntries())).toEqual([{key: 'age', value: '50'}])
})

test('Informe clear removes all entries and reset restores starting defaults', () => {
  const informe = new Informe({
    name: 'Bob',
    age: input({type: 'number', default: 50}),
    email: input({required: true}),
  })

  informe.clear()

  expect(informe.size).toBe(0)
  expect(informe.rawEntries()).toEqual([])

  informe.reset()

  expect(rawEntryData(informe.rawEntries())).toEqual([
    {key: 'name', value: 'Bob'},
    {key: 'age', value: '50'},
    {key: 'email', value: ''},
  ])
})

test('Informe getAll returns enabled duplicates in insertion order', () => {
  const informe = new Informe({
    age: input({type: 'number', default: 50}),
  })

  informe.setRawEntries([
    {key: 'age', value: '40'},
    {key: 'age', value: '50', disabled: true},
    {key: 'age', value: '60'},
  ])

  expect(informe.get('age')).toBe(60)
  expect(informe.getAll('age')).toEqual([40, 60])
})

test('Informe iterates unique enabled keys in first raw occurrence order', () => {
  const informe = new Informe({
    a: 'default a',
    b: 'default b',
  })

  informe.setRawEntries([
    {key: 'b', value: 'disabled first', disabled: true},
    {key: 'a', value: '1'},
    {key: 'b', value: '2'},
    {key: 'a', value: '3'},
    {key: 'c', value: 'disabled only', disabled: true},
    {key: 'unknown', value: 'x'},
  ])

  expect(informe.has('b')).toBe(true)
  expect(informe.has('c')).toBe(false)
  expect(informe.size).toBe(3)
  expect([...informe.keys()]).toEqual(['b', 'a', 'unknown'])
  expect([...informe.values()]).toEqual(['2', '3', 'x'])
  expect([...informe.entries()]).toEqual([
    ['b', '2'],
    ['a', '3'],
    ['unknown', 'x'],
  ])
  expect([...informe]).toEqual([...informe.entries()])
})

test('Informe forEach visits unique resolved entries with the instance', () => {
  const informe = new Informe({
    name: 'Bob',
  })
  const seen: Array<[string, string | number | undefined, boolean]> = []

  informe.append('name', 'Alice')
  informe.append('unknown', 'kept')
  informe.forEach((value, key, instance) => {
    seen.push([key, value, instance === informe])
  })

  expect(seen).toEqual([
    ['name', 'Alice', true],
    ['unknown', 'kept', true],
  ])
})

test('detects value typeahead match when cursor is past the colon', () => {
  expect(getSchemaValueTypeaheadMatch('color:red', 9)).toEqual({
    query: 'red',
    replaceFromOffset: 6,
    replaceToOffset: 9,
  })

  expect(getSchemaValueTypeaheadMatch('color:re', 8)).toEqual({
    query: 're',
    replaceFromOffset: 6,
    replaceToOffset: 8,
  })

  expect(getSchemaValueTypeaheadMatch('color:', 6)).toEqual({
    query: '',
    replaceFromOffset: 6,
    replaceToOffset: 6,
  })

  expect(getSchemaValueTypeaheadMatch('color: red', 10)).toEqual({
    query: ' red',
    replaceFromOffset: 6,
    replaceToOffset: 10,
  })
})

test('returns undefined for value typeahead match when there is no colon or cursor is before/at separator', () => {
  expect(getSchemaValueTypeaheadMatch('color', 5)).toBeUndefined()
  expect(getSchemaValueTypeaheadMatch('color:red', 3)).toBeUndefined()
  // cursor on the colon separator is not a value position
  expect(getSchemaValueTypeaheadMatch('color:red', 5)).toBeUndefined()
})

test('filters value suggestions by value and label', () => {
  const descriptor = {
    options: [
      {label: 'Red', value: '#FF0000'},
      {label: 'Green', value: '#00AA00'},
      {label: 'Blue', value: '#0000FF'},
    ],
  }

  expect(getSchemaValueSuggestions(descriptor, 'g')).toEqual([
    {label: 'Green', value: '#00AA00'},
  ])

  expect(getSchemaValueSuggestions(descriptor, 're')).toEqual([
    {label: 'Red', value: '#FF0000'},
    {label: 'Green', value: '#00AA00'},
  ])

  expect(getSchemaValueSuggestions(descriptor, '')).toEqual([
    {label: 'Red', value: '#FF0000'},
    {label: 'Green', value: '#00AA00'},
    {label: 'Blue', value: '#0000FF'},
  ])
})

test('filters value suggestions for string options', () => {
  const descriptor = {options: ['red', 'green', 'blue']}

  // 'bl' prefix-matches 'blue' only
  expect(getSchemaValueSuggestions(descriptor, 'bl')).toEqual([
    {value: 'blue'},
  ])

  expect(getSchemaValueSuggestions(descriptor, 'xyz')).toEqual([])

  expect(getSchemaValueSuggestions(descriptor, '')).toEqual([
    {value: 'red'},
    {value: 'green'},
    {value: 'blue'},
  ])
})

test('returns empty suggestions for descriptor without options', () => {
  expect(getSchemaValueSuggestions({}, 'red')).toEqual([])
  expect(getSchemaValueSuggestions({options: []}, '')).toEqual([])
})

test('input rejects options on type: number at the type level', () => {
  // @ts-expect-error options is not allowed on number inputs
  input({type: 'number', options: ['1', '2', '3']})
})
