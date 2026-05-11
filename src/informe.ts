import { EntryEditor } from './editor';
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

export type InformeChangeEvent<
  TFields extends InformeFieldMap = InformeFieldMap,
> = CustomEvent<InformeChangeDetail<TFields>>;
export type InformeChangeEventListener<
  TFields extends InformeFieldMap = InformeFieldMap,
> = (this: Informe<TFields>, event: InformeChangeEvent<TFields>) => void;

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
      onChange: (entries) => {
        this.entryList = entries;
        this.dispatchChange();
      },
    });

    return this;
  }

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

    const entries: Entry[] = this.currentEntries();

    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];

      if (!entry.disabled && entry.key === key) {
        entries[index] = { ...entry, value: String(value) };
        this.entryList = entries;
        this.syncEntries();
        return this;
      }
    }

    entries.push({ key, value: String(value) });
    this.entryList = entries;
    this.syncEntries();
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

    this.entryList = [
      ...this.currentEntries(),
      { key, value: String(value) },
    ];
    this.syncEntries();
  }

  delete(key: string): void {
    if (typeof key !== 'string') {
      throw new TypeError(`Failed to execute 'delete' on 'Informe': 1 string argument required, but only ${typeof key} present.`);
    }

    this.entryList = this.currentEntries().filter((entry) => entry.key !== key);
    this.syncEntries();
  }

  clear(): void {
    this.entryList = [];
    this.syncEntries();
  }

  reset(): void {
    const normalized = normalizeInformeFields(this.fields);

    this.entryList = this.stamper.stampEntries(normalized.entries);
    this.schema = normalized.schema;
    this.editor?.setSchema(normalized.schema);
    this.syncEntries();
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
    this.entryList = this.stamper.stampEntries(entries);
    this.syncEntries();
  }

  destroy(): void {
    if (!this.editor) {
      return;
    }

    this.entryList = this.editor.getEntries();
    this.editor.destroy();
    this.editor = undefined;
  }

  private resolveLastEnabled(key: string): InformeFieldValue | undefined {
    const entries = this.currentEntries();

    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];

      if (!entry.disabled && entry.key === key) {
        return this.resolveEntryValue(entry);
      }
    }

    return undefined;
  }

  private resolvedKeyOrder(): string[] {
    const keys = new Set<string>();
    const activeKeys = new Set<string>();
    const entries = this.currentEntries();

    for (const entry of entries) {
      if (!entry.disabled) {
        activeKeys.add(entry.key);
      }
    }

    for (const entry of entries) {
      if (activeKeys.has(entry.key)) {
        keys.add(entry.key);
      }
    }

    return [...keys];
  }

  private resolvedValues(): Array<InformeFieldValue | undefined> {
    return this.resolvedKeyOrder().map((key) => this.resolveLastEnabled(key));
  }

  private resolvedEntries(): Array<[string, InformeFieldValue | undefined]> {
    return this.resolvedKeyOrder().map((key) => [
      key,
      this.resolveLastEnabled(key),
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

  private syncEntries(): void {
    this.entryList = this.stamper.stampEntries(this.entryList);
    this.editor?.setEntries(this.entryList);
    this.entryList = this.editor?.getEntries() ?? this.entryList;
    this.dispatchChange();
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
}
