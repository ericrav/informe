import {expect, test} from 'vitest'
import {Informe, input, parseEntryText} from '../src'
import {
  getSchemaKeySuggestions,
  getSchemaKeyTypeaheadMatch,
  getSchemaValueSuggestions,
  getSchemaValueTypeaheadMatch,
  isPatternValid,
} from '../src/editor'

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

test('parses key-only entry text', () => {
  expect(parseEntryText(' disabled ')).toEqual({
    key: 'disabled',
    value: '',
  })
})

test('detects typeahead key replacement ranges before a separator exists', () => {
  expect(getSchemaKeyTypeaheadMatch('fo', 2)).toEqual({
    query: 'fo',
    keyText: 'fo',
    replaceFromOffset: 0,
    replaceToOffset: 2,
  })

  expect(getSchemaKeyTypeaheadMatch('fo: Pizza', 2)).toBeUndefined()
  expect(getSchemaKeyTypeaheadMatch('food: Pizza', 6)).toBeUndefined()
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

  expect(informe.rawEntries()).toEqual([
    {key: 'name', value: 'Bob'},
    {key: 'age', value: '50'},
    {key: 'email', value: ''},
  ])
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

  expect(informe.rawEntries()).toContainEqual({key: 'unknown', value: 'kept in entries only'})
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
  expect(informe.rawEntries()).toEqual([
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
  expect(informe.rawEntries()).toEqual([
    {key: 'name', value: 'Bob'},
    {key: 'name', value: 'Alice', disabled: true},
    {key: 'name', value: 'Ada'},
  ])

  informe.setRawEntries([{key: 'name', value: 'Ada', disabled: true}])
  informe.set('name', 'Grace')

  expect(informe.rawEntries()).toEqual([
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
  expect(informe.rawEntries()).toEqual([{key: 'age', value: '50'}])
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

  expect(informe.rawEntries()).toEqual([
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
