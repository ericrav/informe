# informe

Formless input for evolving apps. Informe gives users an editor for key/value
entries where they can add valid or invalid properties, disable lines, and keep
working without being constrained to a fixed form layout.

Inspired by ArchieML and editing CSS in Chrome DevTools.

```ts
import { Informe, input } from 'informe';
import 'informe/style.css';

const informe = new Informe({
  name: 'Bob',
  age: 50,
  food: input({ description: 'What is your favorite food?' }),
});

informe.addEventListener('change', (event) => {
  console.log(Object.fromEntries(event.detail.informe));
});

informe.mount(document.querySelector('#editor')!);
```

Plain values become known keys and defaults. Use `input()` when you want to add
metadata without introducing a separate schema object:

```ts
const informe = new Informe({
  name: input({ label: 'Full name', default: 'Bob', required: true }),
  age: input({ type: 'number', default: 50, min: 1, max: 99 }),
  food: input({ description: 'What is your favorite food?' }),
});
```

When editing, Informe suggests known schema keys while the cursor is in the key
position before `:`. Empty lines show all keys, typed text filters the list, and
descriptions from `input({description})` appear in the typeahead. Press `Tab` or
`Enter` to insert the selected key as `key: ` and start typing its value.

`Informe` exposes a `Map`/`FormData`-shaped API over the entries:

```ts
informe.get('age'); // 50
Object.fromEntries(informe); // {name: 'Bob', age: 50}

informe.append('name', 'Alice'); // adds a duplicate; later entries win
informe.set('name', 'Ada'); // overwrites the last enabled `name`
informe.getAll('name'); // insertion order: ['Bob', 'Ada']

informe.clear(); // removes all entries
informe.reset(); // restores the starting defaults and required entries
```

Disabled entries are ignored by `get`, `has`, `keys`, `values`, `entries`, and
iteration. Duplicate keys resolve to the last enabled entry, while `getAll`
returns enabled duplicates in insertion order, so `getAll(key).at(-1)` matches
`get(key)`. Unknown keys are included in collection methods and returned as raw
strings.

Use `rawEntries()` when you need the full internal data, including disabled and
duplicate entries:

```ts
console.log(informe.rawEntries());
```

The lower-level editor API is still available if you want to manage entries and
schema descriptors directly:

```ts
import { EntryEditor } from 'informe';

const editor = new EntryEditor(document.querySelector('#editor')!, {
  entries: [{ key: 'caption', value: 'Hello world' }],
  schema: { caption: { type: 'string', description: 'Human-readable label' } },
  onChange(entries) {
    console.log(entries);
  },
});
```

Run the demo with:

```sh
pnpm demo
```
