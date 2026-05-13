import {
  EntryEditor,
  type EntryEditorInputEvent,
} from './editor';
import {
  diffEntries,
  resolvedViewDiffers,
  type ChangeRecord,
  type ResolvedView,
} from './changes';
import { EntryStamper } from './id';
import {
  normalizeInformeFields,
  type Entry,
  type IdGenerator,
  type InformeFieldKey,
  type InformeFieldMap,
  type InformeFieldValue,
  type InformeResolvedValue,
  type RawEntry,
  type SchemaDescriptorMap,
} from './input';

export interface InformeOptions {
  className?: string;
  idGenerator?: IdGenerator;
}

export interface InformeChangeDetail<
  TFields extends InformeFieldMap = InformeFieldMap,
> {
  informe: Informe<TFields>;
}

export interface InformeInputDetail<
  TFields extends InformeFieldMap = InformeFieldMap,
> {
  informe: Informe<TFields>;
  changes: ChangeRecord[];
}

export type InformeInputEvent<
  TFields extends InformeFieldMap = InformeFieldMap,
> = CustomEvent<InformeInputDetail<TFields>>;
export type InformeInputEventListener<
  TFields extends InformeFieldMap = InformeFieldMap,
> = (this: Informe<TFields>, event: InformeInputEvent<TFields>) => void;
export type InformeChangeEvent<
  TFields extends InformeFieldMap = InformeFieldMap,
> = CustomEvent<InformeChangeDetail<TFields>>;
export type InformeChangeEventListener<
  TFields extends InformeFieldMap = InformeFieldMap,
> = (this: Informe<TFields>, event: InformeChangeEvent<TFields>) => void;

export interface InformeEventMap<
  TFields extends InformeFieldMap = InformeFieldMap,
> {
  input: InformeInputEvent<TFields>;
  change: InformeChangeEvent<TFields>;
}

export class Informe<
  TFields extends InformeFieldMap = InformeFieldMap,
> extends EventTarget {
  private entryList: Entry[];
  private fields: TFields;
  private schema: SchemaDescriptorMap;
  private editor: EntryEditor | undefined;
  private stamper: EntryStamper;
  private options: InformeOptions;

  constructor(fields: TFields, options: InformeOptions = {}) {
    super();

    const normalized = normalizeInformeFields(fields);
    this.stamper = new EntryStamper(options.idGenerator);

    this.entryList = this.stamper.stampEntries(normalized.entries);
    this.fields = fields;
    this.schema = normalized.schema;
    this.options = {
      className: options.className,
      idGenerator: options.idGenerator,
    };
  }

  mount(container: HTMLElement): this {
    if (this.editor) {
      throw new Error('Informe is already mounted.');
    }

    this.editor = new EntryEditor(container, {
      entries: this.entryList,
      schema: this.schema,
      className: this.options.className,
      idGenerator: this.options.idGenerator,
    });
    this.editor.addEventListener('input', (event) => {
      this.handleEditorInput(event);
    });

    return this;
  }

  addEventListener(
    type: 'input',
    listener: InformeInputEventListener<TFields> | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: 'change',
    listener: InformeChangeEventListener<TFields> | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener:
      | EventListenerOrEventListenerObject
      | InformeInputEventListener<TFields>
      | InformeChangeEventListener<TFields>
      | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  removeEventListener(
    type: 'input',
    listener: InformeInputEventListener<TFields> | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: 'change',
    listener: InformeChangeEventListener<TFields> | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener:
      | EventListenerOrEventListenerObject
      | InformeInputEventListener<TFields>
      | InformeChangeEventListener<TFields>
      | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  setFields<TNextFields extends InformeFieldMap>(
    fields: TNextFields,
  ): Informe<TNextFields> {
    const normalized = normalizeInformeFields(fields);
    const next = this as unknown as Informe<TNextFields>;

    next.fields = fields;
    next.schema = normalized.schema;
    next.editor?.setSchema(normalized.schema);
    next.entryList = next.stamper.stampEntries(normalized.entries);
    next.editor?.setEntries(next.entryList);

    return next;
  }

  setOptions(options: InformeOptions): void {
    if ('idGenerator' in options) {
      this.stamper = new EntryStamper(options.idGenerator);
      this.entryList = this.stamper.stampEntries(this.currentEntries());
    }

    this.options = {
      className: options.className ?? this.options.className,
      idGenerator: 'idGenerator' in options
        ? options.idGenerator
        : this.options.idGenerator,
    };

    this.editor?.setOptions({
      idGenerator: this.options.idGenerator,
    });
  }

  focus(): void {
    this.editor?.focus();
  }

  get size(): number {
    return this.resolvedKeyOrder().length;
  }

  get<TKey extends InformeFieldKey<TFields>>(
    key: TKey,
  ): InformeResolvedValue<TFields, TKey> | undefined;
  get(key: string): string | undefined;
  get(key: string): InformeFieldValue | undefined {
    if (typeof key !== 'string') {
      throw new TypeError(`Failed to execute 'get' on 'Informe': 1 string argument required, but only ${typeof key} present.`);
    }

    return this.resolveLastEnabled(key);
  }

  getAll<TKey extends InformeFieldKey<TFields>>(
    key: TKey,
  ): Array<InformeResolvedValue<TFields, TKey> | undefined>;
  getAll(key: string): string[];
  getAll(key: string): Array<InformeFieldValue | undefined> {
    if (typeof key !== 'string') {
      throw new TypeError(`Failed to execute 'getAll' on 'Informe': 1 string argument required, but only ${typeof key} present.`);
    }

    const values: Array<InformeFieldValue | undefined> = [];

    for (const entry of this.currentEntries()) {
      if (entry.disabled || entry.key !== key) {
        continue;
      }

      values.push(this.resolveEntryValue(entry));
    }

    return values;
  }

  has(key: string): boolean {
    return this.hasEnabledEntry(key);
  }

  set<TKey extends InformeFieldKey<TFields>>(
    key: TKey,
    value: InformeResolvedValue<TFields, TKey>,
  ): this;
  set(key: string, value: InformeFieldValue): this;
  set(key: string, value: InformeFieldValue): this {
    if (arguments.length < 2) {
      throw new TypeError(`Failed to execute 'set' on 'Informe': 2 arguments required, but only ${arguments.length - 1} present.`);
    }

    const previousEntries = this.currentEntries();
    const previousView = this.resolvedView(previousEntries);
    const entries: Entry[] = this.currentEntries();

    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];

      if (!entry.disabled && entry.key === key) {
        entries[index] = { ...entry, value: String(value) };
        this.entryList = entries;
        this.syncEntries(previousEntries, previousView);
        return this;
      }
    }

    entries.push({ key, value: String(value) });
    this.entryList = entries;
    this.syncEntries(previousEntries, previousView);
    return this;
  }

  append<TKey extends InformeFieldKey<TFields>>(
    key: TKey,
    value: InformeResolvedValue<TFields, TKey>,
  ): void;
  append(key: string, value: InformeFieldValue): void;
  append(key: string, value: InformeFieldValue): void {
    if (arguments.length < 2) {
      throw new TypeError(`Failed to execute 'append' on 'Informe': 2 arguments required, but only ${arguments.length - 1} present.`);
    }

    const previousEntries = this.currentEntries();
    const previousView = this.resolvedView(previousEntries);
    this.entryList = [
      ...previousEntries,
      { key, value: String(value) },
    ];
    this.syncEntries(previousEntries, previousView);
  }

  delete(key: string): void {
    if (typeof key !== 'string') {
      throw new TypeError(`Failed to execute 'delete' on 'Informe': 1 string argument required, but only ${typeof key} present.`);
    }

    const previousEntries = this.currentEntries();
    const previousView = this.resolvedView(previousEntries);
    this.entryList = previousEntries.filter((entry) => entry.key !== key);
    this.syncEntries(previousEntries, previousView);
  }

  clear(): void {
    const previousEntries = this.currentEntries();
    const previousView = this.resolvedView(previousEntries);
    this.entryList = [];
    this.syncEntries(previousEntries, previousView);
  }

  reset(): void {
    const previousEntries = this.currentEntries();
    const previousView = this.resolvedView(previousEntries);
    const normalized = normalizeInformeFields(this.fields);

    this.entryList = this.stamper.stampEntries(normalized.entries);
    this.schema = normalized.schema;
    this.editor?.setSchema(normalized.schema);
    this.syncEntries(previousEntries, previousView);
  }

  keys(): IterableIterator<string> {
    return this.resolvedKeyOrder()[Symbol.iterator]();
  }

  values(): IterableIterator<InformeFieldValue | undefined> {
    return this.resolvedValues()[Symbol.iterator]();
  }

  entries(): IterableIterator<[string, InformeFieldValue | undefined]> {
    return this.resolvedEntries()[Symbol.iterator]();
  }

  forEach(
    callback: (
      value: InformeFieldValue | undefined,
      key: string,
      informe: this,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.resolvedEntries()) {
      callback.call(thisArg, value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<
    [string, InformeFieldValue | undefined]
  > {
    return this.entries();
  }

  rawEntries(): RawEntry[] {
    return this.currentEntries().map((entry) => ({ ...entry }));
  }

  setRawEntries(entries: readonly Entry[]): void {
    const previousEntries = this.currentEntries();
    const previousView = this.resolvedView(previousEntries);
    this.entryList = this.stamper.stampEntries(entries);
    this.syncEntries(previousEntries, previousView);
  }

  destroy(): void {
    if (!this.editor) {
      return;
    }

    this.entryList = this.editor.getEntries();
    this.editor.destroy();
    this.editor = undefined;
  }

  private resolveLastEnabled(
    key: string,
    entries = this.currentEntries(),
  ): InformeFieldValue | undefined {
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];

      if (!entry.disabled && entry.key === key) {
        return this.resolveEntryValue(entry);
      }
    }

    return undefined;
  }

  private resolvedKeyOrder(entries = this.currentEntries()): string[] {
    const keys = new Set<string>();
    const activeKeys = new Set<string>();

    for (const entry of entries) {
      if (!entry.disabled && entry.key) {
        activeKeys.add(entry.key);
      }
    }

    for (const entry of entries) {
      if (entry.key && activeKeys.has(entry.key)) {
        keys.add(entry.key);
      }
    }

    return [...keys];
  }

  private resolvedValues(): Array<InformeFieldValue | undefined> {
    const entries = this.currentEntries();

    return this.resolvedKeyOrder(entries).map((key) => (
      this.resolveLastEnabled(key, entries)
    ));
  }

  private resolvedEntries(): Array<[string, InformeFieldValue | undefined]> {
    const entries = this.currentEntries();

    return this.resolvedKeyOrder(entries).map((key) => [
      key,
      this.resolveLastEnabled(key, entries),
    ]);
  }

  private resolveEntryValue(entry: Entry): InformeFieldValue | undefined {
    const descriptor = this.schema[entry.key];
    const type = descriptor?.type;

    if (type === 'number') {
      const trimmed = entry.value.trim();

      if (!trimmed) {
        return undefined;
      }

      const number = Number(trimmed);

      return Number.isFinite(number) ? number : undefined;
    }

    return entry.value;
  }

  private hasEnabledEntry(key: string): boolean {
    return this.currentEntries().some(
      (entry) => !entry.disabled && entry.key === key,
    );
  }

  private currentEntries(): RawEntry[] {
    return (
      this.editor?.getEntries() ?? this.stamper.stampEntries(this.entryList)
    );
  }

  private syncEntries(
    previousEntries: readonly RawEntry[],
    previousView: ResolvedView,
  ): void {
    this.entryList = this.stamper.stampEntries(this.entryList);
    this.editor?.setEntries(this.entryList, { emitInput: false });
    this.entryList = this.editor?.getEntries() ?? this.entryList;
    this.dispatchMutation(previousEntries, previousView);
  }

  private handleEditorInput(event: EntryEditorInputEvent): void {
    const entries = this.editor?.getEntries() ?? this.currentEntries();
    const previousEntries = previousEntriesFromChanges(entries, event.detail.changes);
    const previousView = this.resolvedView(previousEntries);

    this.entryList = entries;
    this.dispatchMutation(previousEntries, previousView, event.detail.changes);
  }

  private dispatchMutation(
    previousEntries: readonly RawEntry[],
    previousView: ResolvedView,
    knownChanges?: ChangeRecord[],
  ): void {
    const changes = knownChanges ?? diffEntries(previousEntries, this.currentEntries());

    if (changes.length === 0) {
      return;
    }

    this.dispatchInput(changes);

    if (resolvedViewDiffers(previousView, this.resolvedView())) {
      this.dispatchChange();
    }
  }

  private dispatchInput(changes: ChangeRecord[]): void {
    this.dispatchEvent(
      new CustomEvent<InformeInputDetail<TFields>>('input', {
        detail: {
          informe: this,
          changes,
        },
      }),
    );
  }

  private dispatchChange(): void {
    this.dispatchEvent(
      new CustomEvent<InformeChangeDetail<TFields>>('change', {
        detail: {
          informe: this,
        },
      }),
    );
  }

  private resolvedView(entries = this.currentEntries()): ResolvedView {
    return Object.fromEntries(this.resolvedKeyOrder(entries).map((key) => [
      key,
      this.resolveLastEnabled(key, entries),
    ]));
  }
}

function previousEntriesFromChanges(
  nextEntries: readonly RawEntry[],
  changes: readonly ChangeRecord[],
): RawEntry[] {
  const byId = new Map(nextEntries.map((entry) => [entry.id, { ...entry }]));

  for (const change of changes) {
    if (change.type === 'add') {
      byId.delete(change.newEntry.id);
      continue;
    }

    if (change.type === 'remove') {
      byId.set(change.oldEntry.id, { ...change.oldEntry });
      continue;
    }

    byId.set(change.oldEntry.id, { ...change.oldEntry });
  }

  return [...byId.values()].sort((left, right) => (
    left.order < right.order ? -1 : left.order > right.order ? 1 : 0
  ));
}
