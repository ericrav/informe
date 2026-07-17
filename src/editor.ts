import {
  Fragment,
  Schema,
  Slice,
  type Node as ProseMirrorNode,
} from 'prosemirror-model';
import {
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  type Transaction,
} from 'prosemirror-state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  type NodeView,
} from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import {
  ReplaceStep,
  Step,
  StepMap,
  StepResult,
  type Mappable,
} from 'prosemirror-transform';
import { EntryStamper, orderBetween } from './id';
import { diffEntries, type ChangeRecord } from './changes';
import type {
  Entry,
  IdGenerator,
  InputOption,
  InputWidgetContext,
  RawEntry,
  SchemaDescriptor,
  SchemaDescriptorMap,
  WidgetCleanup,
  WidgetUpdateCallback,
} from './input';

interface EntryCursorSnapshot {
  id: string;
  offset: number;
}

export type EntryChangeHandler = (
  entries: RawEntry[],
  editor: EntryEditor,
) => void;

export interface EntryEditorInputDetail {
  editor: EntryEditor;
  changes: ChangeRecord[];
}

export type EntryEditorInputEvent = CustomEvent<EntryEditorInputDetail>;
export type EntryEditorInputEventListener = (
  this: EntryEditor,
  event: EntryEditorInputEvent,
) => void;

export interface EntrySelectionSnapshot {
  entryId: string;
  key: string;
  field: 'key' | 'value';
  offset: number;
}

export interface EntryEditorSelectionDetail {
  editor: EntryEditor;
  selection: EntrySelectionSnapshot | null;
}

export type EntryEditorSelectionEvent = CustomEvent<EntryEditorSelectionDetail>;
export type EntryEditorSelectionEventListener = (
  this: EntryEditor,
  event: EntryEditorSelectionEvent,
) => void;

export interface EntryEditorOptions {
  entries?: readonly Entry[];
  schema?: SchemaDescriptorMap;
  onChange?: EntryChangeHandler;
  onSave?: EntryChangeHandler;
  className?: string;
  idGenerator?: IdGenerator;
}

const entrySchema = new Schema({
  nodes: {
    doc: { content: 'entry+' },
    entry: {
      content: 'inline*',
      attrs: {
        disabled: { default: false },
        id: { default: null },
        order: { default: null },
      },
      toDOM(node) {
        const attrs: Record<string, string> = {
          class: `informe-entry${node.attrs.disabled ? ' informe-entry--disabled' : ''}`,
        };

        if (node.attrs.id) {
          attrs['data-entry-id'] = String(node.attrs.id);
        }

        if (node.attrs.order) {
          attrs['data-entry-order'] = String(node.attrs.order);
        }

        return ['div', attrs, 0];
      },
      parseDOM: [
        {
          tag: 'div.informe-entry',
          getAttrs(dom) {
            const element = dom as HTMLElement;

            return {
              disabled: element.classList.contains('informe-entry--disabled'),
              id: element.dataset.entryId ?? null,
              order: element.dataset.entryOrder ?? null,
            };
          },
        },
      ],
    },
    text: { group: 'inline' },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM() {
        return ['br'];
      },
    },
  },
});

export function parseEntryText(text: string): { key: string; value: string } {
  const index = text.indexOf(':');

  if (index === -1) {
    return { key: text.trim(), value: '' };
  }

  return {
    key: text.slice(0, index).trim(),
    value: text.slice(index + 1),
  };
}

function parseEntryNodeText(text: string): Entry {
  const index = text.indexOf(':');

  if (index === -1) {
    return { key: text.trim(), value: '' };
  }

  const value = text.slice(index + 1);
  const entry: Entry = {
    key: text.slice(0, index).trim(),
    value,
  };

  if (value === '') {
    entry.hasSeparator = true;
  }

  return entry;
}

export function isPatternValid(
  value: string,
  descriptor: SchemaDescriptor,
): boolean {
  if (descriptor.pattern == null || descriptor.type !== 'string') {
    return true;
  }

  if (value.trim() === '') {
    return false;
  }

  const regex =
    descriptor.pattern instanceof RegExp
      ? descriptor.pattern
      : new RegExp(`^(?:${descriptor.pattern})$`);

  regex.lastIndex = 0;

  return regex.test(value);
}

function entriesToDoc(entries: readonly Entry[]): ProseMirrorNode {
  const nodes = entries.map((entry) => {
    const text = entry.value === '' && !entry.hasSeparator
      ? entry.key
      : `${entry.key}:${entry.value}`;
    const content = entryTextToContent(text);

    return entrySchema.nodes.entry.create(
      {
        disabled: entry.disabled ?? false,
        id: entry.id ?? null,
        order: entry.order ?? null,
      },
      content,
    );
  });

  if (nodes.length === 0) {
    nodes.push(entrySchema.nodes.entry.create({}, []));
  }

  return entrySchema.nodes.doc.create(null, nodes);
}

function entryTextToContent(text: string): ProseMirrorNode[] {
  if (!text) {
    return [];
  }

  const content: ProseMirrorNode[] = [];
  const segments = text.split('\n');

  for (const [index, segment] of segments.entries()) {
    if (index > 0) {
      content.push(entrySchema.nodes.hard_break.create());
    }

    if (segment) {
      content.push(entrySchema.text(segment));
    }
  }

  return content;
}

function entryTextToSlice(text: string): Slice {
  return new Slice(Fragment.fromArray(entryTextToContent(text)), 0, 0);
}

class CommitOptionPreviewStep extends Step {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly originalValue: string,
  ) {
    super();
  }

  apply(doc: ProseMirrorNode): StepResult {
    return StepResult.ok(doc);
  }

  getMap(): StepMap {
    return StepMap.empty;
  }

  invert(): Step {
    return new ReplaceStep(
      this.from,
      this.to,
      entryTextToSlice(this.originalValue),
    );
  }

  map(mapping: Mappable): Step | null {
    const from = mapping.mapResult(this.from, 1);
    const to = mapping.mapResult(this.to, -1);

    if (from.deletedAcross && to.deletedAcross) {
      return null;
    }

    return new CommitOptionPreviewStep(from.pos, to.pos, this.originalValue);
  }

  toJSON(): {
    stepType: string;
    from: number;
    to: number;
    originalValue: string;
  } {
    return {
      stepType: 'informeCommitOptionPreview',
      from: this.from,
      to: this.to,
      originalValue: this.originalValue,
    };
  }

  static fromJSON(
    _schema: Schema,
    json: { from: number; to: number; originalValue: string },
  ): CommitOptionPreviewStep {
    return new CommitOptionPreviewStep(
      json.from,
      json.to,
      json.originalValue,
    );
  }
}

Step.jsonID('informeCommitOptionPreview', CommitOptionPreviewStep);

function entryNodeToText(node: ProseMirrorNode): string {
  let text = '';

  node.forEach((child) => {
    if (child.type === entrySchema.nodes.hard_break) {
      text += '\n';
      return;
    }

    text += child.textContent;
  });

  return text;
}

function docToEntries(doc: ProseMirrorNode): RawEntry[] {
  const entries: RawEntry[] = [];

  doc.forEach((node) => {
    const entry = parseEntryNodeText(entryNodeToText(node));

    if (node.attrs.id) {
      entry.id = node.attrs.id as string;
    }

    if (node.attrs.order) {
      entry.order = node.attrs.order as string;
    }

    if (node.attrs.disabled) {
      entry.disabled = true;
    }

    entries.push(entry as RawEntry);
  });

  return entries;
}

const schemaHintsKey = new PluginKey<DecorationSet>('schemaHints');
const focusedEntryKey = new PluginKey<DecorationSet>('focusedEntry');
const schemaKeyTypeaheadKey = new PluginKey<SchemaKeyTypeaheadPluginState>(
  'schemaKeyTypeahead',
);
export const schemaValueTypeaheadKey =
  new PluginKey<SchemaValueTypeaheadPluginState>('schemaValueTypeahead');

interface SchemaKeyTypeaheadPluginState {
  openRequested: boolean;
  excludeExistingKeysWhenEmpty: boolean;
}

interface SchemaValueTypeaheadPluginState {
  openRequested: boolean;
  previewRequested: boolean;
  showAllOptions: boolean;
}

const inactiveSchemaKeyTypeaheadState: SchemaKeyTypeaheadPluginState = {
  openRequested: false,
  excludeExistingKeysWhenEmpty: false,
};

const inactiveSchemaValueTypeaheadState: SchemaValueTypeaheadPluginState = {
  openRequested: false,
  previewRequested: false,
  showAllOptions: false,
};

export interface SchemaKeyTypeaheadMatch {
  query: string;
  keyText: string;
  replaceFromOffset: number;
  replaceToOffset: number;
}

export interface SchemaKeySuggestion {
  key: string;
  label?: string;
  description?: string;
  type?: string;
  required: boolean;
}

export interface SchemaKeySuggestionOptions {
  excludeKeysWhenQueryEmpty?: ReadonlySet<string>;
}

function hasTooltipContent(descriptor: SchemaDescriptor): boolean {
  return Boolean(
    descriptor.label ||
    descriptor.description ||
    descriptor.required ||
    descriptor.min != null ||
    descriptor.max != null ||
    descriptor.step != null ||
    descriptor.minLength != null ||
    descriptor.maxLength != null ||
    descriptor.pattern != null ||
    descriptor.default != null ||
    descriptor.placeholder != null,
  );
}

function createPatternWarningIcon(pattern: string | RegExp): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.contentEditable = 'false';
  wrapper.className = 'informe-entry-pattern-warning';
  wrapper.title = `Value doesn't match pattern: ${pattern}`;
  wrapper.setAttribute('aria-label', 'Value does not match pattern');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const triangle = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path',
  );
  triangle.setAttribute('d', 'M8 1.5 15.5 14.5h-15L8 1.5Z');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  line.setAttribute('x', '7.25');
  line.setAttribute('y', '5');
  line.setAttribute('width', '1.5');
  line.setAttribute('height', '5.25');
  line.setAttribute('rx', '0.75');
  line.setAttribute('fill', '#fff');

  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', '8');
  dot.setAttribute('cy', '12');
  dot.setAttribute('r', '0.85');
  dot.setAttribute('fill', '#fff');

  svg.append(triangle, line, dot);
  wrapper.append(svg);

  return wrapper;
}

function createOptionsButton(
  view: EditorView,
  getPos: () => number | undefined,
  key: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.contentEditable = 'false';
  button.tabIndex = 0;
  button.className = 'informe-entry-options-button';
  button.setAttribute('aria-label', `Show options for ${key}`);
  button.setAttribute('aria-haspopup', 'listbox');
  button.title = `Show options for ${key}`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const chevron = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path',
  );
  chevron.setAttribute('d', 'M2.5 5 8 10.5 13.5 5Z');
  svg.append(chevron);
  button.append(svg);

  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    view.focus();

    const widgetPosition = getPos();
    if (widgetPosition == null) {
      return;
    }

    const { state } = view;
    const $widgetPosition = state.doc.resolve(widgetPosition);
    if ($widgetPosition.parent.type !== entrySchema.nodes.entry) {
      return;
    }

    const valueEnd = $widgetPosition.end();
    const transaction = state.tr
      .setSelection(Selection.near(state.doc.resolve(valueEnd)))
      .setMeta(schemaValueTypeaheadKey, {
        openRequested: true,
        showAllOptions: true,
      });
    view.dispatch(transaction);
  });

  return button;
}

function addValueWhitespaceDecorations(
  decorations: Decoration[],
  value: string,
  valueFrom: number,
): void {
  let leadingSpaces = 0;

  while (value[leadingSpaces] === ' ') {
    leadingSpaces += 1;
  }

  let trailingSpaces = 0;

  while (
    trailingSpaces < value.length - leadingSpaces &&
    value[value.length - trailingSpaces - 1] === ' '
  ) {
    trailingSpaces += 1;
  }

  const decorate = (charOffset: number) => {
    const from = valueFrom + charOffset;
    decorations.push(
      Decoration.inline(from, from + 1, {
        class: 'informe-entry-ws-dot',
      }),
    );
  };

  for (let index = 0; index < leadingSpaces; index++) {
    decorate(index);
  }

  const trailingStart = value.length - trailingSpaces;

  for (let index = trailingStart; index < value.length; index++) {
    decorate(index);
  }
}

function addValueNewlineDecorations(
  decorations: Decoration[],
  value: string,
  valueFrom: number,
): void {
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '\n') {
      continue;
    }

    decorations.push(
      Decoration.widget(
        valueFrom + index,
        () => {
          const span = document.createElement('span');
          span.contentEditable = 'false';
          span.className = 'informe-entry-newline-marker';
          span.textContent = '\u21B5';
          span.setAttribute('aria-hidden', 'true');
          return span;
        },
        {
          side: -1,
          ignoreSelection: true,
          key: `informe-entry-newline-marker-${index}`,
        },
      ),
    );
  }
}

interface WidgetInstance {
  key: string;
  element: HTMLElement;
  descriptor: SchemaDescriptor;
  offset: number;
  value: string;
  updateCallbacks: WidgetUpdateCallback[];
  currentCleanups: Array<WidgetCleanup | void>;
  destroyCallbacks: WidgetCleanup[];
}

interface WidgetEntrySnapshot {
  key: string;
  value: string;
  descriptor: SchemaDescriptor;
  offset: number;
}

class WidgetInstanceController {
  private readonly instances = new Map<string, WidgetInstance>();
  private view: EditorView | undefined;

  setView(view: EditorView): void {
    this.view = view;
  }

  sync(doc: ProseMirrorNode, schema: SchemaDescriptorMap): void {
    const snapshots = this.getWidgetEntrySnapshots(doc, schema);
    const activeKeys = new Set<string>();

    for (const snapshot of snapshots) {
      activeKeys.add(snapshot.key);
      const instance = this.instances.get(snapshot.key);

      if (!instance) {
        continue;
      }

      if (instance.descriptor !== snapshot.descriptor) {
        this.destroyInstance(instance);
        this.instances.delete(snapshot.key);
        continue;
      }

      instance.offset = snapshot.offset;

      if (instance.value !== snapshot.value) {
        this.updateInstance(instance, snapshot.value);
      }
    }

    for (const [key, instance] of this.instances) {
      if (!activeKeys.has(key)) {
        this.destroyInstance(instance);
        this.instances.delete(key);
      }
    }
  }

  destroyAll(): void {
    for (const instance of this.instances.values()) {
      this.destroyInstance(instance);
    }

    this.instances.clear();
  }

  getOrCreate(
    key: string,
    descriptor: SchemaDescriptor,
    value: string,
    offset: number,
    view: EditorView,
  ): HTMLElement {
    this.view = view;
    const existing = this.instances.get(key);

    if (existing && existing.descriptor === descriptor) {
      existing.offset = offset;

      if (existing.value !== value) {
        this.updateInstance(existing, value);
      }

      return existing.element;
    }

    if (existing) {
      this.destroyInstance(existing);
      this.instances.delete(key);
    }

    const instance = this.createInstance(key, descriptor, value, offset);
    this.instances.set(key, instance);
    return instance.element;
  }

  private createInstance(
    key: string,
    descriptor: SchemaDescriptor,
    value: string,
    offset: number,
  ): WidgetInstance {
    if (!descriptor.widget) {
      throw new Error('Cannot create informe widget without a widget factory.');
    }

    const instance: WidgetInstance = {
      key,
      element: document.createElement('span'),
      descriptor,
      offset,
      value,
      updateCallbacks: [],
      currentCleanups: [],
      destroyCallbacks: [],
    };
    const context: InputWidgetContext = {
      descriptor,
      setValue: (nextValue) => {
        this.setValue(instance, nextValue);
      },
      onUpdate: (callback) => {
        instance.updateCallbacks.push(callback);
        instance.currentCleanups.push(undefined);
      },
      onDestroy: (callback) => {
        instance.destroyCallbacks.push(callback);
      },
    };

    instance.element = descriptor.widget(context);
    instance.element.contentEditable = 'false';
    this.updateInstance(instance, value);

    return instance;
  }

  private updateInstance(instance: WidgetInstance, value: string): void {
    const errors: unknown[] = [];

    for (const [index, callback] of instance.updateCallbacks.entries()) {
      this.runCleanup(instance.currentCleanups[index], instance, errors);

      try {
        instance.currentCleanups[index] = callback(value);
      } catch (error) {
        this.reportCallbackError(instance, error);
        errors.push(error);
        instance.currentCleanups[index] = undefined;
      }
    }

    instance.value = value;
    this.throwCollectedErrors(errors);
  }

  private destroyInstance(instance: WidgetInstance): void {
    const errors: unknown[] = [];

    for (let index = instance.currentCleanups.length - 1; index >= 0; index--) {
      this.runCleanup(instance.currentCleanups[index], instance, errors);
    }

    for (let index = instance.destroyCallbacks.length - 1; index >= 0; index--) {
      this.runCleanup(instance.destroyCallbacks[index], instance, errors);
    }

    instance.element.remove();
    this.throwCollectedErrors(errors);
  }

  private runCleanup(
    cleanup: WidgetCleanup | void,
    instance: WidgetInstance,
    errors: unknown[],
  ): void {
    if (!cleanup) {
      return;
    }

    try {
      cleanup();
    } catch (error) {
      this.reportCallbackError(instance, error);
      errors.push(error);
    }
  }

  private reportCallbackError(instance: WidgetInstance, error: unknown): void {
    console.error(
      `Informe widget callback failed for type "${String(instance.descriptor.type ?? 'unknown')}".`,
      error,
    );
  }

  private throwCollectedErrors(errors: unknown[]): void {
    if (errors.length === 0) {
      return;
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    throw new AggregateError(errors, 'Informe widget callbacks failed.');
  }

  private setValue(instance: WidgetInstance, value: string): void {
    const view = this.view;

    if (!view) {
      return;
    }

    const node = view.state.doc.nodeAt(instance.offset);

    if (!node || node.type !== entrySchema.nodes.entry) {
      return;
    }

    const text = entryNodeToText(node);
    const colonIndex = text.indexOf(':');

    if (colonIndex === -1) {
      return;
    }

    const from = instance.offset + 1 + colonIndex + 1;
    const to = instance.offset + 1 + text.length;
    const transaction = view.state.tr.insertText(value, from, to);
    transaction.setSelection(Selection.near(transaction.doc.resolve(from + value.length)));
    view.dispatch(transaction.scrollIntoView());
    view.focus();
  }

  private getWidgetEntrySnapshots(
    doc: ProseMirrorNode,
    schema: SchemaDescriptorMap,
  ): WidgetEntrySnapshot[] {
    const snapshots: WidgetEntrySnapshot[] = [];

    doc.forEach((node, offset) => {
      if (node.attrs.disabled) {
        return;
      }

      const text = entryNodeToText(node);
      const colonIndex = text.indexOf(':');

      if (!text || colonIndex === -1) {
        return;
      }

      const keyText = text.slice(0, colonIndex).trim();
      const descriptor = keyText ? schema[keyText] : undefined;

      if (!descriptor?.widget) {
        return;
      }

      snapshots.push({
        key: widgetInstanceKey(node, offset, keyText),
        value: text.slice(colonIndex + 1),
        descriptor,
        offset,
      });
    });

    return snapshots;
  }
}

function widgetInstanceKey(
  node: ProseMirrorNode,
  offset: number,
  key: string,
): string {
  return node.attrs.id ? `id:${String(node.attrs.id)}` : `pos:${offset}:${key}`;
}

function buildDecorations(
  doc: ProseMirrorNode,
  schema: SchemaDescriptorMap,
  widgetController?: WidgetInstanceController,
): DecorationSet {
  const decorations: Decoration[] = [];
  const knownKeys = new Set(Object.keys(schema));
  const entryKeys: Array<{ key: string; offset: number; disabled: boolean }> =
    [];

  doc.forEach((node, offset) => {
    const text = entryNodeToText(node);

    if (!text) {
      return;
    }

    const colonIndex = text.indexOf(':');
    const keyEnd = colonIndex === -1 ? text.length : colonIndex;
    const key = text.slice(0, keyEnd).trim();

    if (key) {
      entryKeys.push({ key, offset, disabled: Boolean(node.attrs.disabled) });
    }
  });

  const overriddenOffsets = new Set<number>();
  const activeKeys = new Set<string>();

  for (let index = entryKeys.length - 1; index >= 0; index--) {
    const { key, offset, disabled } = entryKeys[index];

    if (disabled) {
      continue;
    }

    if (activeKeys.has(key)) {
      overriddenOffsets.add(offset);
    } else {
      activeKeys.add(key);
    }
  }

  doc.forEach((node, offset) => {
    const text = entryNodeToText(node);

    if (!text) {
      return;
    }

    if (overriddenOffsets.has(offset)) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: 'informe-entry--overridden',
        }),
      );
    }

    const colonIndex = text.indexOf(':');
    const keyEnd = colonIndex === -1 ? text.length : colonIndex;
    const key = text.slice(0, keyEnd).trim();

    if (key && knownKeys.size > 0 && !knownKeys.has(key)) {
      decorations.push(
        Decoration.inline(offset + 1, offset + 1 + keyEnd, {
          class: 'informe-entry-key--unknown',
          spellcheck: 'false',
        }),
      );
    }

    if (colonIndex === -1) {
      return;
    }

    const value = text.slice(colonIndex + 1);
    const valueFrom = offset + 1 + colonIndex + 1;
    const descriptor = key ? schema[key] : undefined;
    const keyClass =
      descriptor && hasTooltipContent(descriptor)
        ? 'informe-entry-key informe-entry-key--has-info'
        : 'informe-entry-key';

    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        style: `--informe-entry-continuation-indent: ${colonIndex + 2}ch;`,
      }),
    );

    decorations.push(
      Decoration.inline(offset + 1, offset + 1 + colonIndex, {
        class: keyClass,
        spellcheck: 'false',
      }),
    );
    decorations.push(
      Decoration.inline(offset + 1 + colonIndex, offset + 1 + colonIndex + 1, {
        class: 'informe-entry-separator',
      }),
    );
    decorations.push(
      Decoration.widget(
        valueFrom,
        () => {
          const span = document.createElement('span');
          span.contentEditable = 'false';
          span.className = 'informe-entry-separator-gap';
          span.textContent = ' ';
          return span;
        },
        {
          side: -2,
          ignoreSelection: true,
          key: 'informe-entry-separator-gap',
        },
      ),
    );

    if (
      descriptor?.options &&
      descriptor.options.length > 0 &&
      !node.attrs.disabled
    ) {
      decorations.push(
        Decoration.widget(
          valueFrom + value.length,
          (view, getPos) => createOptionsButton(view, getPos, key),
          {
            side: 1,
            ignoreSelection: true,
            key: [
              'informe-entry-options',
              widgetInstanceKey(node, offset, key),
              key,
            ].join('-'),
          },
        ),
      );
    }

    if (descriptor?.widget && !node.attrs.disabled && widgetController) {
      const widgetKey = widgetInstanceKey(node, offset, key);

      decorations.push(
        Decoration.widget(
          valueFrom,
          (view) =>
            widgetController.getOrCreate(
              widgetKey,
              descriptor,
              value,
              offset,
              view,
            ),
          {
            side: -1,
            ignoreSelection: true,
            key: `informe-entry-widget-${widgetKey}`,
          },
        ),
      );
    }

    if (colonIndex + 1 < text.length) {
      decorations.push(
        Decoration.inline(valueFrom, offset + 1 + text.length, {
          class: 'informe-entry-value',
        }),
      );

      addValueWhitespaceDecorations(decorations, value, valueFrom);
      addValueNewlineDecorations(decorations, value, valueFrom);
    }

    if (
      descriptor &&
      !node.attrs.disabled &&
      descriptor.pattern != null &&
      !isPatternValid(value, descriptor)
    ) {
      decorations.push(
        Decoration.widget(
          valueFrom,
          () => createPatternWarningIcon(descriptor.pattern as string | RegExp),
          { side: -1, ignoreSelection: true },
        ),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function schemaHintsPlugin(schemaRef: {
  current: SchemaDescriptorMap;
}): Plugin {
  const widgetController = new WidgetInstanceController();

  return new Plugin({
    key: schemaHintsKey,
    state: {
      init(_, state) {
        return buildDecorations(state.doc, schemaRef.current, widgetController);
      },
      apply(transaction, oldDecorations) {
        if (transaction.docChanged || transaction.getMeta(schemaHintsKey)) {
          widgetController.sync(transaction.doc, schemaRef.current);
          return buildDecorations(
            transaction.doc,
            schemaRef.current,
            widgetController,
          );
        }

        return oldDecorations.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations(state) {
        return schemaHintsKey.getState(state);
      },
    },
    view(view) {
      widgetController.setView(view);

      return {
        update(updatedView) {
          widgetController.setView(updatedView);
        },
        destroy() {
          widgetController.destroyAll();
        },
      };
    },
  });
}

function buildFocusedEntryDecorations(state: EditorState): DecorationSet {
  if (!state.selection.empty) {
    return DecorationSet.empty;
  }

  const { $from } = state.selection;
  let depth = $from.depth;

  while (depth > 0 && $from.node(depth).type !== entrySchema.nodes.entry) {
    depth--;
  }

  if (depth === 0) {
    return DecorationSet.empty;
  }

  const from = $from.before(depth);
  const node = $from.node(depth);

  return DecorationSet.create(state.doc, [
    Decoration.node(from, from + node.nodeSize, {
      class: 'informe-entry--focused',
    }),
  ]);
}

function focusedEntryPlugin(): Plugin {
  let focused = false;

  return new Plugin({
    key: focusedEntryKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(transaction, oldDecorations, _, state) {
        const meta = transaction.getMeta(focusedEntryKey);

        if (meta?.focused === true) {
          focused = true;
          return buildFocusedEntryDecorations(state);
        }

        if (meta?.focused === false) {
          focused = false;
          return DecorationSet.empty;
        }

        if (transaction.docChanged || transaction.selectionSet) {
          return focused
            ? buildFocusedEntryDecorations(state)
            : DecorationSet.empty;
        }

        return focused
          ? oldDecorations.map(transaction.mapping, transaction.doc)
          : DecorationSet.empty;
      },
    },
    props: {
      decorations(state) {
        return focusedEntryKey.getState(state);
      },
      handleDOMEvents: {
        focus(view) {
          view.dispatch(view.state.tr.setMeta(focusedEntryKey, { focused: true }));
          return false;
        },
        blur(view) {
          view.dispatch(view.state.tr.setMeta(focusedEntryKey, { focused: false }));
          return false;
        },
      },
    },
  });
}

export function getSchemaKeyTypeaheadMatch(
  text: string,
  cursorOffset: number,
): SchemaKeyTypeaheadMatch | undefined {
  if (cursorOffset < 0 || cursorOffset > text.length) {
    return undefined;
  }

  const colonIndex = text.indexOf(':');

  if (colonIndex !== -1) {
    return undefined;
  }

  return {
    query: text.slice(0, cursorOffset).trim(),
    keyText: text,
    replaceFromOffset: 0,
    replaceToOffset: cursorOffset,
  };
}

export function getSchemaKeySuggestions(
  schema: SchemaDescriptorMap,
  query: string,
  options: SchemaKeySuggestionOptions = {},
): SchemaKeySuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  const excludeKeys =
    normalizedQuery === '' ? options.excludeKeysWhenQueryEmpty : undefined;
  const suggestions: Array<{
    index: number;
    rank: number;
    suggestion: SchemaKeySuggestion;
  }> = [];

  for (const [index, [key, descriptor]] of Object.entries(schema).entries()) {
    if (excludeKeys?.has(key)) {
      continue;
    }

    const suggestion: SchemaKeySuggestion = {
      key,
      label:
        descriptor.label == null ? undefined : String(descriptor.label),
      description:
        descriptor.description == null
          ? undefined
          : String(descriptor.description),
      type: descriptor.type == null ? undefined : String(descriptor.type),
      required: descriptor.required === true,
    };
    const rank = schemaKeySuggestionRank(suggestion, normalizedQuery);

    if (rank != null) {
      suggestions.push({ index, rank, suggestion });
    }
  }

  suggestions.sort((left, right) => {
    return left.rank - right.rank || left.index - right.index;
  });

  return suggestions.map(({ suggestion }) => suggestion);
}

function schemaKeySuggestionRank(
  suggestion: SchemaKeySuggestion,
  query: string,
): number | undefined {
  if (!query) {
    return 0;
  }

  const key = suggestion.key.toLowerCase();
  const label = suggestion.label?.toLowerCase();

  if (key.startsWith(query)) {
    return 0;
  }

  if (label?.startsWith(query)) {
    return 1;
  }

  if (key.includes(query)) {
    return 2;
  }

  if (label?.includes(query)) {
    return 3;
  }

  return undefined;
}

export interface SchemaValueTypeaheadMatch {
  query: string;
  replaceFromOffset: number;
  replaceToOffset: number;
}

export interface SchemaValueSuggestion {
  label?: string;
  value: string;
}

export function getSchemaValueTypeaheadMatch(
  text: string,
  cursorOffset: number,
): SchemaValueTypeaheadMatch | undefined {
  if (cursorOffset < 0 || cursorOffset > text.length) {
    return undefined;
  }

  const colonIndex = text.indexOf(':');

  if (colonIndex === -1 || cursorOffset <= colonIndex) {
    return undefined;
  }

  const valueStart = colonIndex + 1;

  return {
    query: text.slice(valueStart, cursorOffset),
    replaceFromOffset: valueStart,
    replaceToOffset: text.length,
  };
}

function normalizeInputOption(option: string | InputOption): SchemaValueSuggestion {
  if (typeof option === 'string') {
    return { value: option };
  }

  return { label: option.label, value: option.value };
}

function schemaValueSuggestionRank(
  suggestion: SchemaValueSuggestion,
  query: string,
): number | undefined {
  if (!query) {
    return 0;
  }

  const value = suggestion.value.toLowerCase();
  const label = suggestion.label?.toLowerCase();

  if (value.startsWith(query)) {
    return 0;
  }

  if (label?.startsWith(query)) {
    return 1;
  }

  if (value.includes(query)) {
    return 2;
  }

  if (label?.includes(query)) {
    return 3;
  }

  return undefined;
}

export function getSchemaValueSuggestions(
  descriptor: SchemaDescriptor,
  query: string,
): SchemaValueSuggestion[] {
  const options = descriptor.options;

  if (!options || options.length === 0) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();
  const suggestions: Array<{
    index: number;
    rank: number;
    suggestion: SchemaValueSuggestion;
  }> = [];

  for (const [index, option] of options.entries()) {
    const suggestion = normalizeInputOption(option);
    const rank = schemaValueSuggestionRank(suggestion, normalizedQuery);

    if (rank != null) {
      suggestions.push({ index, rank, suggestion });
    }
  }

  suggestions.sort((left, right) => {
    return left.rank - right.rank || left.index - right.index;
  });

  return suggestions.map(({ suggestion }) => suggestion);
}

interface ActiveSchemaKeyTypeahead extends SchemaKeyTypeaheadMatch {
  from: number;
  to: number;
  anchor: number;
  signature: string;
  suggestions: SchemaKeySuggestion[];
}

function getActiveSchemaKeyTypeahead(
  state: EditorState,
  schema: SchemaDescriptorMap,
  options: { excludeExistingKeysWhenEmpty: boolean },
): ActiveSchemaKeyTypeahead | undefined {
  if (!state.selection.empty || Object.keys(schema).length === 0) {
    return undefined;
  }

  const { $from } = state.selection;

  if ($from.parent.type !== entrySchema.nodes.entry) {
    return undefined;
  }

  const match = getSchemaKeyTypeaheadMatch(
    entryNodeToText($from.parent),
    $from.parentOffset,
  );

  if (!match) {
    return undefined;
  }

  const suggestions = getSchemaKeySuggestions(schema, match.query, {
    excludeKeysWhenQueryEmpty: options.excludeExistingKeysWhenEmpty
      ? getEntryKeys(state.doc)
      : undefined,
  });

  if (suggestions.length === 0) {
    return undefined;
  }

  const entryStart = $from.start();
  const from = entryStart + match.replaceFromOffset;
  const to = entryStart + match.replaceToOffset;

  return {
    ...match,
    from,
    to,
    anchor: state.selection.from,
    suggestions,
    signature: [
      from,
      to,
      state.selection.from,
      match.query,
      suggestions.map(({ key }) => key).join('\0'),
    ].join(':'),
  };
}

function getEntryKeys(doc: ProseMirrorNode): ReadonlySet<string> {
  const keys = new Set<string>();

  doc.forEach((node) => {
    const text = entryNodeToText(node);

    if (!text) {
      return;
    }

    const colonIndex = text.indexOf(':');
    const keyEnd = colonIndex === -1 ? text.length : colonIndex;
    const key = text.slice(0, keyEnd).trim();

    if (!key) {
      return;
    }

    keys.add(key);
  });

  return keys;
}

let schemaKeyTypeaheadInstanceCounter = 0;

class SchemaKeyTypeaheadView {
  private readonly element: HTMLDivElement;
  private readonly listElement: HTMLDivElement;
  private readonly detailsElement: HTMLDivElement;
  private readonly detailsId: string;
  private active: ActiveSchemaKeyTypeahead | undefined;
  private dismissedSignature: string | undefined;
  private openRequest = inactiveSchemaKeyTypeaheadState;
  private excludeExistingKeysWhenEmpty = false;
  private selectedIndex = 0;
  private view: EditorView;

  constructor(
    view: EditorView,
    private readonly schemaRef: { current: SchemaDescriptorMap },
  ) {
    this.view = view;
    schemaKeyTypeaheadInstanceCounter += 1;
    this.detailsId = `informe-schema-typeahead-details-${schemaKeyTypeaheadInstanceCounter}`;

    this.element = document.createElement('div');
    this.element.className = 'informe-schema-typeahead';

    this.listElement = document.createElement('div');
    this.listElement.className = 'informe-schema-typeahead-list';
    this.listElement.setAttribute('role', 'listbox');

    this.detailsElement = document.createElement('div');
    this.detailsElement.className = 'informe-schema-typeahead-details';
    this.detailsElement.id = this.detailsId;
    this.detailsElement.setAttribute('role', 'tooltip');

    this.element.append(this.listElement, this.detailsElement);
    this.element.addEventListener('mousedown', this.handleMouseDown);
    this.element.addEventListener('mouseover', this.handleMouseOver);
    document.body.append(this.element);
    this.update(view, inactiveSchemaKeyTypeaheadState);
  }

  update(view: EditorView, openRequest: SchemaKeyTypeaheadPluginState): void {
    this.view = view;
    const shouldOpen =
      openRequest.openRequested || this.openRequest.openRequested;

    if (shouldOpen) {
      this.excludeExistingKeysWhenEmpty =
        openRequest.excludeExistingKeysWhenEmpty ||
        this.openRequest.excludeExistingKeysWhenEmpty;
    }

    this.openRequest = inactiveSchemaKeyTypeaheadState;
    const next = getActiveSchemaKeyTypeahead(
      view.state,
      this.schemaRef.current,
      { excludeExistingKeysWhenEmpty: this.excludeExistingKeysWhenEmpty },
    );

    if (!next || !view.hasFocus() || (!this.active && !shouldOpen)) {
      this.active = undefined;
      this.excludeExistingKeysWhenEmpty = false;
      this.hide();
      return;
    }

    if (shouldOpen && !this.excludeExistingKeysWhenEmpty) {
      this.excludeExistingKeysWhenEmpty = false;
    }

    if (next.query) {
      this.excludeExistingKeysWhenEmpty = false;
    }

    if (
      this.dismissedSignature &&
      this.dismissedSignature !== next.signature
    ) {
      this.dismissedSignature = undefined;
    }

    if (this.dismissedSignature === next.signature) {
      this.active = undefined;
      this.hide();
      return;
    }

    if (this.active?.signature !== next.signature) {
      this.selectedIndex = 0;
    }

    this.active = next;
    this.selectedIndex = Math.min(
      this.selectedIndex,
      next.suggestions.length - 1,
    );
    this.render();
  }

  destroy(): void {
    this.element.removeEventListener('mousedown', this.handleMouseDown);
    this.element.removeEventListener('mouseover', this.handleMouseOver);
    this.element.remove();
  }

  hide(): void {
    this.element.classList.remove('informe-schema-typeahead--visible');
    this.listElement.replaceChildren();
    this.detailsElement.replaceChildren();
    this.detailsElement.classList.remove(
      'informe-schema-typeahead-details--visible',
    );
  }

  close(): void {
    this.active = undefined;
    this.excludeExistingKeysWhenEmpty = false;
    this.hide();
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.active) {
      return false;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex =
        (this.selectedIndex + 1) % this.active.suggestions.length;
      this.render();
      this.scrollSelectedListItemIntoView();
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex =
        (this.selectedIndex - 1 + this.active.suggestions.length) %
        this.active.suggestions.length;
      this.render();
      this.scrollSelectedListItemIntoView();
      return true;
    }

    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault();
      this.acceptSelectedSuggestion();
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismissedSignature = this.active.signature;
      this.active = undefined;
      this.hide();
      return true;
    }

    return false;
  }

  requestOpenAfterTextInput(text: string): void {
    if (text.includes(':')) {
      return;
    }

    const { state } = this.view;

    if (!state.selection.empty) {
      return;
    }

    const { $from } = state.selection;

    if ($from.parent.type !== entrySchema.nodes.entry) {
      return;
    }

    if (
      getSchemaKeyTypeaheadMatch(entryNodeToText($from.parent), $from.parentOffset)
    ) {
      this.openRequest = {
        openRequested: true,
        excludeExistingKeysWhenEmpty: false,
      };
    }
  }

  private readonly handleMouseDown = (event: MouseEvent) => {
    const item = (event.target as HTMLElement).closest(
      '[data-informe-schema-typeahead-index]',
    ) as HTMLElement | null;

    if (!item || !this.active) {
      return;
    }

    event.preventDefault();
    this.selectedIndex = Number(item.dataset.informeSchemaTypeaheadIndex);
    this.acceptSelectedSuggestion();
  };

  private readonly handleMouseOver = (event: MouseEvent) => {
    const item = (event.target as HTMLElement).closest(
      '[data-informe-schema-typeahead-index]',
    ) as HTMLElement | null;

    if (!item || !this.active) {
      return;
    }

    const index = Number(item.dataset.informeSchemaTypeaheadIndex);

    if (Number.isNaN(index) || index === this.selectedIndex) {
      return;
    }

    this.selectedIndex = index;
    this.render();
  };

  private acceptSelectedSuggestion(): void {
    const active = this.active;
    if (!active) {
      return;
    }

    const suggestion = active.suggestions[this.selectedIndex];

    if (!suggestion) {
      return;
    }

    const descriptor = this.schemaRef.current[suggestion.key];
    const hasOptions =
      descriptor?.options != null && descriptor.options.length > 0;

    const replacement = `${suggestion.key}:`;
    const position = active.from + replacement.length;
    const transaction = this.view.state.tr.insertText(
      replacement,
      active.from,
      active.to,
    );

    transaction.setSelection(Selection.near(transaction.doc.resolve(position)));

    if (hasOptions) {
      transaction.setMeta(schemaValueTypeaheadKey, { openRequested: true });
    }

    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }

  private render(): void {
    if (!this.active) {
      this.hide();
      return;
    }

    this.listElement.replaceChildren(
      ...this.active.suggestions.map((suggestion, index) =>
        this.renderListItem(suggestion, index),
      ),
    );
    this.renderDetails();
    this.position();
  }

  private renderDetails(): void {
    const suggestion = this.active?.suggestions[this.selectedIndex];
    const descriptor = suggestion
      ? this.schemaRef.current[suggestion.key]
      : undefined;

    if (!descriptor || !hasTooltipContent(descriptor)) {
      this.detailsElement.replaceChildren();
      this.detailsElement.classList.remove(
        'informe-schema-typeahead-details--visible',
      );
      return;
    }

    this.detailsElement.replaceChildren(...buildSchemaDetailNodes(descriptor));
    this.detailsElement.classList.add(
      'informe-schema-typeahead-details--visible',
    );
  }

  private position(): void {
    if (!this.active) {
      return;
    }

    try {
      const rect = this.view.coordsAtPos(this.active.anchor);
      this.element.classList.add('informe-schema-typeahead--visible');
      this.element.style.top = `${rect.bottom + 4}px`;
      this.element.style.left = `${rect.left}px`;

      const margin = 8;
      const popupWidth = this.element.offsetWidth;
      const maxLeft = window.innerWidth - popupWidth - margin;

      if (rect.left > maxLeft) {
        this.element.style.left = `${Math.max(margin, maxLeft)}px`;
      }
    } catch {
      this.hide();
    }
  }

  private scrollSelectedListItemIntoView(): void {
    const selectedItem = this.listElement.querySelector<HTMLElement>(
      `[data-informe-schema-typeahead-index="${this.selectedIndex}"]`,
    );

    if (!selectedItem) {
      return;
    }

    const itemTop = selectedItem.offsetTop;
    const itemBottom = itemTop + selectedItem.offsetHeight;
    const style = getComputedStyle(this.listElement);
    const scrollPaddingTop = cssPixelValue(style.scrollPaddingTop);
    const scrollPaddingBottom = cssPixelValue(style.scrollPaddingBottom);
    const visibleTop = this.listElement.scrollTop + scrollPaddingTop;
    const visibleBottom =
      this.listElement.scrollTop +
      this.listElement.clientHeight -
      scrollPaddingBottom;

    if (itemTop < visibleTop) {
      this.listElement.scrollTop = itemTop - scrollPaddingTop;
    } else if (itemBottom > visibleBottom) {
      this.listElement.scrollTop =
        itemBottom - this.listElement.clientHeight + scrollPaddingBottom;
    }
  }

  private renderListItem(
    suggestion: SchemaKeySuggestion,
    index: number,
  ): HTMLElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className =
      index === this.selectedIndex
        ? 'informe-schema-typeahead-item informe-schema-typeahead-item--active'
        : 'informe-schema-typeahead-item';
    item.dataset.informeSchemaTypeaheadIndex = String(index);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === this.selectedIndex));
    item.setAttribute('aria-describedby', this.detailsId);

    const key = document.createElement('span');
    key.className = 'informe-schema-typeahead-key';
    key.textContent = suggestion.key;
    item.append(key);

    if (suggestion.label && suggestion.label !== suggestion.key) {
      const label = document.createElement('span');
      label.className = 'informe-schema-typeahead-label';
      label.textContent = suggestion.label;
      item.append(label);
    }

    if (suggestion.required) {
      const required = document.createElement('span');
      required.className = 'informe-schema-typeahead-required';
      required.setAttribute('aria-label', 'required');
      required.textContent = '*';
      item.append(required);
    }

    return item;
  }
}

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function schemaKeyTypeaheadPlugin(schemaRef: {
  current: SchemaDescriptorMap;
}): Plugin {
  let typeaheadView: SchemaKeyTypeaheadView | undefined;

  return new Plugin({
    key: schemaKeyTypeaheadKey,
    state: {
      init() {
        return inactiveSchemaKeyTypeaheadState;
      },
      apply(transaction) {
        const meta = transaction.getMeta(schemaKeyTypeaheadKey);

        if (meta?.openRequested !== true) {
          return inactiveSchemaKeyTypeaheadState;
        }

        return {
          openRequested: true,
          excludeExistingKeysWhenEmpty:
            meta.excludeExistingKeysWhenEmpty === true,
        };
      },
    },
    props: {
      handleKeyDown(_, event) {
        return typeaheadView?.handleKeyDown(event) ?? false;
      },
      handleTextInput(_, __, ___, text) {
        typeaheadView?.requestOpenAfterTextInput(text);
        return false;
      },
      handleDOMEvents: {
        blur() {
          typeaheadView?.close();
          return false;
        },
        focus(view) {
          typeaheadView?.update(view, inactiveSchemaKeyTypeaheadState);
          return false;
        },
      },
    },
    view(view) {
      typeaheadView = new SchemaKeyTypeaheadView(view, schemaRef);

      return {
        update(updatedView) {
          typeaheadView?.update(
            updatedView,
            schemaKeyTypeaheadKey.getState(updatedView.state)
              ?? inactiveSchemaKeyTypeaheadState,
          );
        },
        destroy() {
          typeaheadView?.destroy();
          typeaheadView = undefined;
        },
      };
    },
  });
}

interface ActiveSchemaValueTypeahead extends SchemaValueTypeaheadMatch {
  from: number;
  to: number;
  anchor: number;
  currentValue: string;
  key: string;
  selectedOptionIndex: number;
  signature: string;
  suggestions: SchemaValueSuggestion[];
}

function getActiveSchemaValueTypeahead(
  state: EditorState,
  schema: SchemaDescriptorMap,
  options: {
    allowExactMatch?: boolean;
    showAllOptions: boolean;
    suggestions?: SchemaValueSuggestion[];
  },
): ActiveSchemaValueTypeahead | undefined {
  if (!state.selection.empty) {
    return undefined;
  }

  const { $from } = state.selection;

  if ($from.parent.type !== entrySchema.nodes.entry) {
    return undefined;
  }

  const text = entryNodeToText($from.parent);
  const match = getSchemaValueTypeaheadMatch(text, $from.parentOffset);

  if (!match) {
    return undefined;
  }

  const colonIndex = text.indexOf(':');
  const key = text.slice(0, colonIndex).trim();
  const descriptor = key ? schema[key] : undefined;

  if (!descriptor || !descriptor.options || descriptor.options.length === 0) {
    return undefined;
  }

  const suggestions =
    options.suggestions
    ?? getSchemaValueSuggestions(
      descriptor,
      options.showAllOptions ? '' : match.query,
    );

  if (suggestions.length === 0) {
    return undefined;
  }

  const normalizedQuery = match.query.toLowerCase();
  const isExactMatch = suggestions.some(
    (s) => s.value.toLowerCase() === normalizedQuery,
  );

  if (isExactMatch && !options.showAllOptions && !options.allowExactMatch) {
    return undefined;
  }

  const currentValue = text.slice(colonIndex + 1);
  const entryStart = $from.start();
  const from = entryStart + match.replaceFromOffset;
  const to = entryStart + match.replaceToOffset;

  return {
    ...match,
    from,
    to,
    key,
    anchor: state.selection.from,
    currentValue,
    selectedOptionIndex: suggestions.findIndex(
      (suggestion) => suggestion.value === currentValue,
    ),
    suggestions,
    signature: [
      from,
      to,
      state.selection.from,
      match.query,
      options.showAllOptions,
      suggestions.map(({ value }) => value).join('\0'),
    ].join(':'),
  };
}

let schemaValueTypeaheadInstanceCounter = 0;

interface SchemaValueTypeaheadSession {
  hasPreview: boolean;
  originalValue: string;
  showAllOptions: boolean;
  suggestions: SchemaValueSuggestion[];
}

class SchemaValueTypeaheadView {
  private readonly element: HTMLDivElement;
  private readonly listElement: HTMLDivElement;
  private active: ActiveSchemaValueTypeahead | undefined;
  private dismissedSignature: string | undefined;
  private openRequest = inactiveSchemaValueTypeaheadState;
  private selectedIndex = 0;
  private session: SchemaValueTypeaheadSession | undefined;
  private view: EditorView;

  constructor(
    view: EditorView,
    private readonly schemaRef: { current: SchemaDescriptorMap },
  ) {
    this.view = view;
    schemaValueTypeaheadInstanceCounter += 1;

    this.element = document.createElement('div');
    this.element.className = 'informe-schema-typeahead';

    this.listElement = document.createElement('div');
    this.listElement.className = 'informe-schema-typeahead-list';
    this.listElement.setAttribute('role', 'listbox');

    this.element.append(this.listElement);
    this.element.addEventListener('mousedown', this.handleMouseDown);
    this.element.addEventListener('mouseover', this.handleMouseOver);
    document.body.append(this.element);
    this.update(view, inactiveSchemaValueTypeaheadState);
  }

  update(
    view: EditorView,
    openRequest: SchemaValueTypeaheadPluginState,
    previousState?: EditorState,
  ): void {
    this.view = view;
    const shouldOpen =
      openRequest.openRequested || this.openRequest.openRequested;
    const showAllOptions =
      openRequest.showAllOptions || this.openRequest.showAllOptions;
    const isPreviewUpdate =
      openRequest.previewRequested && this.session != null;

    this.openRequest = inactiveSchemaValueTypeaheadState;
    if (
      this.session &&
      !isPreviewUpdate &&
      !shouldOpen &&
      previousState &&
      (
        !view.state.doc.eq(previousState.doc)
        || !view.state.selection.eq(previousState.selection)
      )
    ) {
      this.forgetSession();
      return;
    }

    const next = getActiveSchemaValueTypeahead(
      view.state,
      this.schemaRef.current,
      {
        allowExactMatch: isPreviewUpdate,
        showAllOptions:
          isPreviewUpdate && this.session
            ? this.session.showAllOptions
            : showAllOptions,
        suggestions:
          isPreviewUpdate && this.session
            ? this.session.suggestions
            : undefined,
      },
    );

    if (!view.hasFocus()) {
      this.hide();
      return;
    }

    if (!next || (!this.active && !shouldOpen)) {
      this.forgetSession();
      return;
    }

    if (showAllOptions) {
      this.dismissedSignature = undefined;
    }

    if (
      this.dismissedSignature &&
      this.dismissedSignature !== next.signature
    ) {
      this.dismissedSignature = undefined;
    }

    if (this.dismissedSignature === next.signature) {
      this.forgetSession();
      return;
    }

    if (shouldOpen && !this.session) {
      this.session = {
        hasPreview: false,
        originalValue: next.currentValue,
        showAllOptions,
        suggestions: next.suggestions,
      };
    }

    if (!isPreviewUpdate && this.active?.signature !== next.signature) {
      this.selectedIndex =
        showAllOptions && next.selectedOptionIndex >= 0
          ? next.selectedOptionIndex
          : 0;
    }

    this.active = next;
    this.selectedIndex = Math.min(
      this.selectedIndex,
      next.suggestions.length - 1,
    );
    this.render();
  }

  destroy(): void {
    this.element.removeEventListener('mousedown', this.handleMouseDown);
    this.element.removeEventListener('mouseover', this.handleMouseOver);
    this.element.remove();
  }

  hide(): void {
    this.element.classList.remove('informe-schema-typeahead--visible');
    this.listElement.replaceChildren();
  }

  close(): void {
    this.finishSession();
  }

  handleEditorInteraction(): void {
    this.finishSession();
  }

  private forgetSession(): void {
    this.active = undefined;
    this.session = undefined;
    this.dismissedSignature = undefined;
    this.hide();
  }

  private finishSession(): void {
    const active = this.active;
    const session = this.session;
    this.forgetSession();

    if (!active || !session?.hasPreview) {
      return;
    }

    const transaction = this.view.state.tr.step(
      new CommitOptionPreviewStep(
        active.from,
        active.to,
        session.originalValue,
      ),
    );
    closeHistory(transaction);
    this.view.dispatch(transaction);
  }

  private restoreSession(): void {
    const active = this.active;
    const session = this.session;
    this.forgetSession();

    if (!active || !session) {
      return;
    }

    const position = active.from + session.originalValue.length;
    const transaction = this.view.state.tr.replaceWith(
      active.from,
      active.to,
      entryTextToContent(session.originalValue),
    );
    transaction.setSelection(Selection.near(transaction.doc.resolve(position)));
    transaction.setMeta('addToHistory', false);
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }

  private previewSelectedSuggestion(): void {
    const active = this.active;
    const session = this.session;
    const suggestion = active?.suggestions[this.selectedIndex];

    if (!active || !session || !suggestion) {
      return;
    }

    session.hasPreview = true;
    const position = active.from + suggestion.value.length;
    const transaction = this.view.state.tr.replaceWith(
      active.from,
      active.to,
      entryTextToContent(suggestion.value),
    );
    transaction.setSelection(Selection.near(transaction.doc.resolve(position)));
    transaction.setMeta('addToHistory', false);
    transaction.setMeta(schemaValueTypeaheadKey, { previewRequested: true });
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.active) {
      return false;
    }

    if (
      event.key === 'ArrowDown'
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
    ) {
      event.preventDefault();
      this.selectedIndex =
        (this.selectedIndex + 1) % this.active.suggestions.length;
      this.previewSelectedSuggestion();
      this.scrollSelectedListItemIntoView();
      return true;
    }

    if (
      event.key === 'ArrowUp'
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.shiftKey
    ) {
      event.preventDefault();
      this.selectedIndex =
        (this.selectedIndex - 1 + this.active.suggestions.length) %
        this.active.suggestions.length;
      this.previewSelectedSuggestion();
      this.scrollSelectedListItemIntoView();
      return true;
    }

    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault();
      if (this.session) {
        this.previewSelectedSuggestion();
        this.finishSession();
      } else {
        this.acceptSelectedSuggestion();
      }
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.restoreSession();
      return true;
    }

    if (
      (event.key === 'Enter' && event.shiftKey)
      || event.altKey
      || event.metaKey
      || event.ctrlKey
      || [
        'ArrowLeft',
        'ArrowRight',
        'ArrowDown',
        'ArrowUp',
        'Backspace',
        'Delete',
        'End',
        'Home',
        'PageDown',
        'PageUp',
      ].includes(event.key)
    ) {
      this.finishSession();
    }

    return false;
  }

  requestOpenAfterTextInput(text: string): void {
    this.finishSession();

    if (!text.includes(':') && !this.isInValuePosition()) {
      return;
    }

    const { state } = this.view;

    if (!state.selection.empty) {
      return;
    }

    const { $from } = state.selection;

    if ($from.parent.type !== entrySchema.nodes.entry) {
      return;
    }

    if (
      getSchemaValueTypeaheadMatch(
        entryNodeToText($from.parent),
        $from.parentOffset,
      )
    ) {
      this.openRequest = {
        openRequested: true,
        previewRequested: false,
        showAllOptions: false,
      };
    }
  }

  private isInValuePosition(): boolean {
    const { state } = this.view;

    if (!state.selection.empty) {
      return false;
    }

    const { $from } = state.selection;

    if ($from.parent.type !== entrySchema.nodes.entry) {
      return false;
    }

    return (
      getSchemaValueTypeaheadMatch(
        entryNodeToText($from.parent),
        $from.parentOffset,
      ) != null
    );
  }

  private readonly handleMouseDown = (event: MouseEvent) => {
    const item = (event.target as HTMLElement).closest(
      '[data-informe-schema-typeahead-index]',
    ) as HTMLElement | null;

    if (!item || !this.active) {
      return;
    }

    event.preventDefault();
    this.selectedIndex = Number(item.dataset.informeSchemaTypeaheadIndex);
    if (this.session) {
      this.previewSelectedSuggestion();
      this.finishSession();
    } else {
      this.acceptSelectedSuggestion();
    }
  };

  private readonly handleMouseOver = (event: MouseEvent) => {
    const item = (event.target as HTMLElement).closest(
      '[data-informe-schema-typeahead-index]',
    ) as HTMLElement | null;

    if (!item || !this.active) {
      return;
    }

    const index = Number(item.dataset.informeSchemaTypeaheadIndex);

    if (Number.isNaN(index) || index === this.selectedIndex) {
      return;
    }

    this.selectedIndex = index;
    this.render();
  };

  private acceptSelectedSuggestion(): void {
    const active = this.active;
    if (!active) {
      return;
    }

    const suggestion = active.suggestions[this.selectedIndex];

    if (!suggestion) {
      return;
    }

    this.forgetSession();
    const position = active.from + suggestion.value.length;
    const transaction = this.view.state.tr.replaceWith(
      active.from,
      active.to,
      entryTextToContent(suggestion.value),
    );

    transaction.setSelection(Selection.near(transaction.doc.resolve(position)));
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }

  private render(): void {
    if (!this.active) {
      this.hide();
      return;
    }

    this.listElement.replaceChildren(
      ...this.active.suggestions.map((suggestion, index) =>
        this.renderListItem(suggestion, index),
      ),
    );
    this.position();
  }

  private position(): void {
    if (!this.active) {
      return;
    }

    try {
      const rect = this.view.coordsAtPos(this.active.anchor);
      this.element.classList.add('informe-schema-typeahead--visible');
      this.element.style.top = `${rect.bottom + 4}px`;
      this.element.style.left = `${rect.left}px`;

      const margin = 8;
      const popupWidth = this.element.offsetWidth;
      const maxLeft = window.innerWidth - popupWidth - margin;

      if (rect.left > maxLeft) {
        this.element.style.left = `${Math.max(margin, maxLeft)}px`;
      }
    } catch {
      this.hide();
    }
  }

  private scrollSelectedListItemIntoView(): void {
    const selectedItem = this.listElement.querySelector<HTMLElement>(
      `[data-informe-schema-typeahead-index="${this.selectedIndex}"]`,
    );

    if (!selectedItem) {
      return;
    }

    const itemTop = selectedItem.offsetTop;
    const itemBottom = itemTop + selectedItem.offsetHeight;
    const style = getComputedStyle(this.listElement);
    const scrollPaddingTop = cssPixelValue(style.scrollPaddingTop);
    const scrollPaddingBottom = cssPixelValue(style.scrollPaddingBottom);
    const visibleTop = this.listElement.scrollTop + scrollPaddingTop;
    const visibleBottom =
      this.listElement.scrollTop +
      this.listElement.clientHeight -
      scrollPaddingBottom;

    if (itemTop < visibleTop) {
      this.listElement.scrollTop = itemTop - scrollPaddingTop;
    } else if (itemBottom > visibleBottom) {
      this.listElement.scrollTop =
        itemBottom - this.listElement.clientHeight + scrollPaddingBottom;
    }
  }

  private renderListItem(
    suggestion: SchemaValueSuggestion,
    index: number,
  ): HTMLElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'informe-schema-typeahead-item';
    if (index === this.selectedIndex) {
      item.classList.add('informe-schema-typeahead-item--active');
    }
    const isSelected = index === this.active?.selectedOptionIndex;
    if (isSelected) {
      item.classList.add('informe-schema-typeahead-item--selected');
    }
    item.dataset.informeSchemaTypeaheadIndex = String(index);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(isSelected));

    const primaryText = suggestion.label ?? suggestion.value;
    const primary = document.createElement('span');
    primary.className = 'informe-schema-typeahead-option-primary';
    primary.textContent = primaryText;
    item.append(primary);

    if (suggestion.label && suggestion.label !== suggestion.value) {
      const secondary = document.createElement('span');
      secondary.className = 'informe-schema-typeahead-label informe-schema-typeahead-value-secondary';
      secondary.textContent = suggestion.value;
      item.append(secondary);
    }

    if (isSelected) {
      const check = document.createElement('span');
      check.className = 'informe-schema-typeahead-selected-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      item.append(check);
    }

    return item;
  }
}

function schemaValueTypeaheadPlugin(schemaRef: {
  current: SchemaDescriptorMap;
}): Plugin {
  let typeaheadView: SchemaValueTypeaheadView | undefined;

  return new Plugin({
    key: schemaValueTypeaheadKey,
    state: {
      init() {
        return inactiveSchemaValueTypeaheadState;
      },
      apply(transaction) {
        const meta = transaction.getMeta(schemaValueTypeaheadKey);

        if (meta?.previewRequested === true) {
          return {
            openRequested: false,
            previewRequested: true,
            showAllOptions: false,
          };
        }

        if (meta?.openRequested !== true) {
          return inactiveSchemaValueTypeaheadState;
        }

        return {
          openRequested: true,
          previewRequested: false,
          showAllOptions: meta.showAllOptions === true,
        };
      },
    },
    props: {
      handleKeyDown(_, event) {
        return typeaheadView?.handleKeyDown(event) ?? false;
      },
      handleTextInput(_, __, ___, text) {
        typeaheadView?.requestOpenAfterTextInput(text);
        return false;
      },
      handleDOMEvents: {
        beforeinput() {
          typeaheadView?.handleEditorInteraction();
          return false;
        },
        blur() {
          typeaheadView?.close();
          return false;
        },
        compositionstart() {
          typeaheadView?.handleEditorInteraction();
          return false;
        },
        drop() {
          typeaheadView?.handleEditorInteraction();
          return false;
        },
        focus(view) {
          typeaheadView?.update(view, inactiveSchemaValueTypeaheadState);
          return false;
        },
        mousedown() {
          typeaheadView?.handleEditorInteraction();
          return false;
        },
        paste() {
          typeaheadView?.handleEditorInteraction();
          return false;
        },
      },
    },
    view(view) {
      typeaheadView = new SchemaValueTypeaheadView(view, schemaRef);

      return {
        update(updatedView, previousState) {
          typeaheadView?.update(
            updatedView,
            schemaValueTypeaheadKey.getState(updatedView.state)
              ?? inactiveSchemaValueTypeaheadState,
            previousState,
          );
        },
        destroy() {
          typeaheadView?.destroy();
          typeaheadView = undefined;
        },
      };
    },
  });
}

function insertEntry(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const { $from } = state.selection;

  if ($from.parent.type !== entrySchema.nodes.entry) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  const transaction = state.tr;

  if (!state.selection.empty) {
    transaction.deleteSelection();
  }

  const splitAtEnd =
    state.selection.empty && $from.parentOffset === $from.parent.content.size;

  transaction.split(transaction.mapping.map(state.selection.from), 1, [
    {
      type: entrySchema.nodes.entry,
      attrs: {
        disabled: splitAtEnd ? false : $from.parent.attrs.disabled,
        id: null,
        order: null,
      },
    },
  ]);
  transaction.setMeta(schemaKeyTypeaheadKey, {
    openRequested: true,
    excludeExistingKeysWhenEmpty: true,
  });
  dispatch(transaction.scrollIntoView());

  return true;
}

function insertValueNewline(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  if (!state.selection.empty) {
    return false;
  }

  const { $from } = state.selection;

  if ($from.parent.type !== entrySchema.nodes.entry) {
    return false;
  }

  const text = entryNodeToText($from.parent);
  const colonIndex = text.indexOf(':');

  if (colonIndex === -1 || $from.parentOffset <= colonIndex) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  dispatch(
    state.tr
      .replaceSelectionWith(entrySchema.nodes.hard_break.create())
      .scrollIntoView(),
  );

  return true;
}

function deleteEmptyEntry(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const { $from } = state.selection;

  if (
    $from.parent.type !== entrySchema.nodes.entry ||
    entryNodeToText($from.parent).length > 0 ||
    state.doc.childCount <= 1
  ) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  dispatch(state.tr.delete($from.before(), $from.after()).scrollIntoView());

  return true;
}

function deleteNonEmptySelection(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  if (state.selection.empty) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  dispatch(state.tr.deleteSelection().scrollIntoView());

  return true;
}

function deleteSeparatorBeforeValue(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  if (!state.selection.empty) {
    return false;
  }

  const { $from } = state.selection;

  if ($from.parent.type !== entrySchema.nodes.entry) {
    return false;
  }

  const text = entryNodeToText($from.parent);
  const colonIndex = text.indexOf(':');

  if (colonIndex === -1 || $from.parentOffset !== colonIndex + 1) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  const position = $from.pos;
  dispatch(state.tr.delete(position - 1, position).scrollIntoView());

  return true;
}

function joinWithPreviousEntry(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  if (!state.selection.empty) {
    return false;
  }

  const { $from } = state.selection;

  if ($from.parent.type !== entrySchema.nodes.entry) {
    return false;
  }

  if ($from.parentOffset !== 0) {
    return false;
  }

  const currentEntryPos = $from.before();

  let prevEntryNode: ProseMirrorNode | undefined;
  let prevEntryPos = -1;

  state.doc.forEach((node, offset) => {
    if (offset + node.nodeSize === currentEntryPos) {
      prevEntryNode = node;
      prevEntryPos = offset;
    }
  });

  if (!prevEntryNode) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  const prevText = entryNodeToText(prevEntryNode);
  const transaction = state.tr;

  if (prevText.length === 0) {
    transaction.delete(prevEntryPos, prevEntryPos + prevEntryNode.nodeSize);
    const newPos = prevEntryPos + 1;
    transaction.setSelection(Selection.near(transaction.doc.resolve(newPos)));
  } else {
    const cursorAfterJoin = prevEntryPos + 1 + prevEntryNode.content.size;
    transaction.join(currentEntryPos);
    transaction.setSelection(Selection.near(transaction.doc.resolve(cursorAfterJoin)));
  }

  dispatch(transaction.scrollIntoView());
  return true;
}

function backspaceCommand(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  return (
    deleteNonEmptySelection(state, dispatch) ||
    deleteSeparatorBeforeValue(state, dispatch) ||
    joinWithPreviousEntry(state, dispatch) ||
    deleteEmptyEntry(state, dispatch)
  );
}

function toggleDisabled(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const { $from } = state.selection;
  let depth = $from.depth;

  while (depth > 0 && $from.node(depth).type !== entrySchema.nodes.entry) {
    depth--;
  }

  if (depth === 0) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  const entryNode = $from.node(depth);
  dispatch(
    state.tr.setNodeMarkup($from.before(depth), undefined, {
      ...entryNode.attrs,
      disabled: !entryNode.attrs.disabled,
    }),
  );

  return true;
}

function decorationClasses(decorations: readonly Decoration[]): string {
  let className = '';

  for (const decoration of decorations) {
    const decorationClass = (
      decoration as unknown as { type?: { attrs?: { class?: string } } }
    ).type?.attrs?.class;

    if (decorationClass) {
      className += ` ${decorationClass}`;
    }
  }

  return className;
}

function decorationStyle(decorations: readonly Decoration[]): string {
  let style = '';

  for (const decoration of decorations) {
    const decorationStyleValue = (
      decoration as unknown as { type?: { attrs?: { style?: string } } }
    ).type?.attrs?.style;

    if (decorationStyleValue) {
      style += decorationStyleValue.endsWith(';')
        ? decorationStyleValue
        : `${decorationStyleValue};`;
    }
  }

  return style;
}

function applyEntryDecorationAttrs(
  dom: HTMLElement,
  disabled: boolean,
  decorations: readonly Decoration[],
): void {
  dom.className = `informe-entry${disabled ? ' informe-entry--disabled' : ''}${decorationClasses(decorations)}`;

  const style = decorationStyle(decorations);

  if (style) {
    dom.setAttribute('style', style);
  } else {
    dom.removeAttribute('style');
  }
}

interface EntryGutterSlotBinding {
  entry: Entry;
  entryElement: HTMLElement;
  slotElement: HTMLElement;
}

interface EntryNodeViewHooks {
  registerGutterSlot: (
    entryId: string,
    binding: EntryGutterSlotBinding,
  ) => void;
  unregisterGutterSlot: (entryId: string, slotElement: HTMLElement) => void;
}

function createEntryNodeView(
  node: ProseMirrorNode,
  view: EditorView,
  getPosition: () => number | undefined,
  decorations: readonly Decoration[],
  hooks?: EntryNodeViewHooks,
): NodeView {
  const dom = document.createElement('div');
  applyEntryDecorationAttrs(dom, Boolean(node.attrs.disabled), decorations);

  const toggleWrapper = document.createElement('span');
  toggleWrapper.contentEditable = 'false';
  toggleWrapper.className = 'informe-entry-toggle-wrapper';

  const gutterSlot = document.createElement('span');
  gutterSlot.className = 'informe-entry-gutter-slot';
  toggleWrapper.append(gutterSlot);

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.className = 'informe-entry-toggle';
  toggle.tabIndex = -1;
  toggle.checked = !node.attrs.disabled;
  toggle.addEventListener('mousedown', (event) => {
    event.preventDefault();

    const position = getPosition();

    if (position == null) {
      return;
    }

    const currentNode = view.state.doc.nodeAt(position);

    if (!currentNode) {
      return;
    }

    view.dispatch(
      view.state.tr.setNodeMarkup(position, undefined, {
        ...currentNode.attrs,
        disabled: !currentNode.attrs.disabled,
      }),
    );
  });
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
  });
  toggleWrapper.append(toggle);

  const contentDOM = document.createElement('div');
  contentDOM.className = 'informe-entry-content';

  dom.append(toggleWrapper, contentDOM);

  const applyEntryDatasetAttrs = (entryNode: ProseMirrorNode): void => {
    if (entryNode.attrs.id) {
      dom.dataset.entryId = String(entryNode.attrs.id);
    } else {
      delete dom.dataset.entryId;
    }

    if (entryNode.attrs.order) {
      dom.dataset.entryOrder = String(entryNode.attrs.order);
    } else {
      delete dom.dataset.entryOrder;
    }
  };

  applyEntryDatasetAttrs(node);

  let mountedEntryId = node.attrs.id ? String(node.attrs.id) : undefined;
  if (mountedEntryId) {
    hooks?.registerGutterSlot(mountedEntryId, {
      entry: entryFromNode(node),
      entryElement: dom,
      slotElement: gutterSlot,
    });
  }

  return {
    dom,
    contentDOM,
    update(updatedNode, updatedDecorations) {
      if (updatedNode.type !== entrySchema.nodes.entry) {
        return false;
      }

      const disabled = Boolean(updatedNode.attrs.disabled);
      applyEntryDecorationAttrs(dom, disabled, updatedDecorations);
      applyEntryDatasetAttrs(updatedNode);
      toggle.checked = !disabled;

      const nextEntryId = updatedNode.attrs.id
        ? String(updatedNode.attrs.id)
        : undefined;

      if (mountedEntryId && mountedEntryId !== nextEntryId) {
        hooks?.unregisterGutterSlot(mountedEntryId, gutterSlot);
        mountedEntryId = undefined;
      }

      if (nextEntryId) {
        mountedEntryId = nextEntryId;
        hooks?.registerGutterSlot(nextEntryId, {
          entry: entryFromNode(updatedNode),
          entryElement: dom,
          slotElement: gutterSlot,
        });
      }

      return true;
    },
    destroy() {
      if (mountedEntryId) {
        hooks?.unregisterGutterSlot(mountedEntryId, gutterSlot);
      }
    },
  };
}

function buildSchemaDetailNodes(descriptor: SchemaDescriptor): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  if (descriptor.label) {
    const label = document.createElement('div');
    label.className = 'informe-schema-detail-label';
    label.textContent = String(descriptor.label);
    nodes.push(label);
  }

  if (descriptor.description) {
    const description = document.createElement('div');
    description.className = 'informe-schema-detail-description';
    description.textContent = String(descriptor.description);
    nodes.push(description);
  }

  const metaItems: string[] = [];

  if (descriptor.type) {
    metaItems.push(String(descriptor.type));
  }

  if (descriptor.required) {
    metaItems.push('required');
  }

  if (metaItems.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'informe-schema-detail-meta';

    for (const item of metaItems) {
      const tag = document.createElement('span');
      tag.className = 'informe-schema-detail-tag';
      tag.textContent = item;
      meta.append(tag);
    }

    nodes.push(meta);
  }

  const constraints: string[] = [];

  if (descriptor.min != null) {
    constraints.push(`min: ${descriptor.min}`);
  }

  if (descriptor.max != null) {
    constraints.push(`max: ${descriptor.max}`);
  }

  if (descriptor.step != null) {
    constraints.push(`step: ${descriptor.step}`);
  }

  if (descriptor.minLength != null) {
    constraints.push(`minLength: ${descriptor.minLength}`);
  }

  if (descriptor.maxLength != null) {
    constraints.push(`maxLength: ${descriptor.maxLength}`);
  }

  if (descriptor.pattern != null) {
    constraints.push(`pattern: ${descriptor.pattern}`);
  }

  if (descriptor.default != null) {
    constraints.push(`default: ${JSON.stringify(descriptor.default)}`);
  }

  if (descriptor.placeholder != null) {
    constraints.push(`placeholder: "${descriptor.placeholder}"`);
  }

  if (constraints.length > 0) {
    const element = document.createElement('div');
    element.className = 'informe-schema-detail-constraints';
    element.textContent = constraints.join(', ');
    nodes.push(element);
  }

  return nodes;
}

function entryFromNode(node: ProseMirrorNode): Entry {
  const entry = parseEntryNodeText(entryNodeToText(node));

  if (node.attrs.id) {
    entry.id = String(node.attrs.id);
  }

  if (node.attrs.order) {
    entry.order = String(node.attrs.order);
  }

  if (node.attrs.disabled) {
    entry.disabled = true;
  }

  return entry;
}

function captureEntryCursor(state: EditorState): EntryCursorSnapshot | undefined {
  if (!state.selection.empty) {
    return undefined;
  }

  const { $from } = state.selection;
  let depth = $from.depth;

  while (depth > 0 && $from.node(depth).type !== entrySchema.nodes.entry) {
    depth--;
  }

  if (depth === 0) {
    return undefined;
  }

  const node = $from.node(depth);
  const id = node.attrs.id;

  if (!id) {
    return undefined;
  }

  return {
    id: String(id),
    offset: $from.pos - $from.start(depth),
  };
}

function getEntrySelectionSnapshot(
  state: EditorState,
): EntrySelectionSnapshot | null {
  const { $from } = state.selection;
  let depth = $from.depth;

  while (depth > 0 && $from.node(depth).type !== entrySchema.nodes.entry) {
    depth--;
  }

  if (depth === 0) {
    return null;
  }

  const node = $from.node(depth);
  const entryId = node.attrs.id;

  if (!entryId) {
    return null;
  }

  const text = node.textContent;
  const { key } = parseEntryText(text);
  const colonIndex = text.indexOf(':');
  const offset = Math.max(0, $from.pos - $from.start(depth));
  const field: 'key' | 'value' = colonIndex === -1 || offset <= colonIndex
    ? 'key'
    : 'value';

  return {
    entryId: String(entryId),
    key,
    field,
    offset,
  };
}

function restoreEntryCursor(
  transaction: Transaction,
  cursor: EntryCursorSnapshot | undefined,
): void {
  if (!cursor) {
    return;
  }

  transaction.doc.forEach((node, offset) => {
    if (node.type !== entrySchema.nodes.entry || node.attrs.id !== cursor.id) {
      return;
    }

    const position = offset + 1 + Math.min(cursor.offset, node.content.size);
    transaction.setSelection(Selection.near(transaction.doc.resolve(position)));
  });
}

function nextEntryOrder(
  entries: Array<{ entry: Entry }>,
  startIndex: number,
): string | undefined {
  for (let index = startIndex + 1; index < entries.length; index++) {
    const order = entries[index].entry.order;

    if (order) {
      return order;
    }
  }

  return undefined;
}

export class EntryEditor extends EventTarget {
  private readonly container: HTMLElement;
  private readonly schemaRef: { current: SchemaDescriptorMap };
  private readonly onChangeRef: { current?: EntryChangeHandler };
  private stamper: EntryStamper;
  private readonly tooltip: HTMLDivElement;
  private readonly handleMouseOver: (event: MouseEvent) => void;
  private readonly handleMouseOut: (event: MouseEvent) => void;
  private suppressNextInput = false;
  private gutterContent = new Map<string, HTMLElement>();
  private entryGutterSlots = new Map<string, EntryGutterSlotBinding>();
  private lastSelectionSignature: string | null = null;
  private isFocused = false;
  private view: EditorView;

  constructor(container: HTMLElement, options: EntryEditorOptions = {}) {
    super();

    this.container = container;
    this.schemaRef = { current: options.schema ?? {} };
    this.onChangeRef = { current: options.onChange ?? options.onSave };
    this.stamper = new EntryStamper(options.idGenerator);

    container.classList.add('informe-entry-editor');

    if (options.className) {
      container.classList.add(
        ...options.className.split(/\s+/).filter(Boolean),
      );
    }

    const state = EditorState.create({
      doc: entriesToDoc(this.stamper.stampEntries(options.entries ?? [])),
      plugins: [
        schemaValueTypeaheadPlugin(this.schemaRef),
        history(),
        schemaHintsPlugin(this.schemaRef),
        focusedEntryPlugin(),
        schemaKeyTypeaheadPlugin(this.schemaRef),
        keymap({
          'Shift-Enter': insertValueNewline,
          Enter: insertEntry,
          Backspace: backspaceCommand,
          Delete: deleteNonEmptySelection,
          'Mod-/': toggleDisabled,
          'Cmd-Enter': toggleDisabled,
          'Mod-Enter': toggleDisabled,
          'Mod-z': undo,
          'Mod-Shift-z': redo,
          'Mod-y': redo,
        }),
      ],
    });

    let view!: EditorView;
    view = new EditorView(container, {
      state,
      nodeViews: {
        entry: (node, entryView, getPosition, decorations) => (
          createEntryNodeView(
            node,
            entryView,
            getPosition,
            decorations,
            {
              registerGutterSlot: (entryId, binding) => {
                this.entryGutterSlots.set(entryId, binding);
                this.renderGutterSlot(entryId);
              },
              unregisterGutterSlot: (entryId, slotElement) => {
                const current = this.entryGutterSlots.get(entryId);
                if (current && current.slotElement !== slotElement) {
                  return;
                }
                this.clearGutterSlot(entryId);
                this.entryGutterSlots.delete(entryId);
              },
            },
          )
        ),
      },
      dispatchTransaction: (transaction) => {
        const previousEntries = transaction.docChanged
          ? docToEntries(view.state.doc)
          : undefined;
        const focusMeta = transaction.getMeta(focusedEntryKey) as
          | { focused?: boolean }
          | undefined;
        if (typeof focusMeta?.focused === 'boolean') {
          this.isFocused = focusMeta.focused;
        }
        let nextState = view.state.apply(transaction);
        const stampTransaction = transaction.docChanged
          ? this.createStampTransaction(nextState)
          : undefined;

        if (stampTransaction) {
          const schemaKeyTypeaheadMeta = transaction.getMeta(
            schemaKeyTypeaheadKey,
          );
          if (schemaKeyTypeaheadMeta !== undefined) {
            stampTransaction.setMeta(
              schemaKeyTypeaheadKey,
              schemaKeyTypeaheadMeta,
            );
          }
          const schemaValueTypeaheadMeta = transaction.getMeta(
            schemaValueTypeaheadKey,
          );
          if (schemaValueTypeaheadMeta !== undefined) {
            stampTransaction.setMeta(
              schemaValueTypeaheadKey,
              schemaValueTypeaheadMeta,
            );
          }
          nextState = nextState.apply(stampTransaction);
        }

        view.updateState(nextState);

        if (transaction.docChanged && !this.suppressNextInput) {
          this.emitMutation(previousEntries ?? []);
        }

        this.emitSelectionChange();

        this.suppressNextInput = false;
      },
    });
    this.view = view;

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'informe-schema-tooltip';
    document.body.append(this.tooltip);

    this.handleMouseOver = (event) => {
      const target = (event.target as HTMLElement).closest?.(
        '.informe-entry-key',
      ) as HTMLElement | null;

      if (target && this.container.contains(target)) {
        this.showTooltip(target);
      }
    };

    this.handleMouseOut = (event) => {
      const related = (event.relatedTarget as HTMLElement | null)?.closest?.(
        '.informe-entry-key',
      );

      if (!related) {
        this.hideTooltip();
      }
    };

    container.addEventListener('mouseover', this.handleMouseOver);
    container.addEventListener('mouseout', this.handleMouseOut);
  }

  getEntries(): RawEntry[] {
    return docToEntries(this.view.state.doc);
  }

  setEntries(entries: readonly Entry[], options: { emitInput?: boolean } = {}): void {
    const nextDoc = entriesToDoc(this.stamper.stampEntries(entries));

    if (nextDoc.eq(this.view.state.doc)) {
      return;
    }

    const transaction = this.view.state.tr.replaceWith(
      0,
      this.view.state.doc.content.size,
      nextDoc.content,
    );
    transaction.setMeta('addToHistory', false);
    restoreEntryCursor(transaction, captureEntryCursor(this.view.state));
    this.suppressNextInput = options.emitInput === false;
    this.view.dispatch(transaction);
  }

  setSchema(schema: SchemaDescriptorMap): void {
    this.schemaRef.current = schema;
    this.view.dispatch(this.view.state.tr.setMeta(schemaHintsKey, true));
  }

  setOptions(options: EntryEditorOptions): void {
    if ('onChange' in options || 'onSave' in options) {
      this.onChangeRef.current = options.onChange ?? options.onSave;
    }

    if ('idGenerator' in options) {
      this.stamper = new EntryStamper(options.idGenerator);
      this.setEntries(this.getEntries());
    }

    if (options.schema) {
      this.setSchema(options.schema);
    }

    if (options.entries) {
      this.setEntries(options.entries);
    }
  }

  focus(): void {
    this.view.focus();
  }

  getSelectionSnapshot(): EntrySelectionSnapshot | null {
    return this.isFocused
      ? getEntrySelectionSnapshot(this.view.state)
      : null;
  }

  /**
   * Low-level gutter primitive: place a pre-built element into each entry's
   * gutter slot, keyed by entry id. Diffs by element identity so an entry whose
   * element is unchanged is not re-attached. The presence layer builds on top
   * of this; it is not a public presence interface.
   */
  setGutterContents(contents: Map<string, HTMLElement>): void {
    const previous = this.gutterContent;
    this.gutterContent = new Map(contents);

    const entryIds = new Set<string>([
      ...previous.keys(),
      ...this.gutterContent.keys(),
    ]);

    for (const entryId of entryIds) {
      if (previous.get(entryId) === this.gutterContent.get(entryId)) {
        continue;
      }

      this.renderGutterSlot(entryId);
    }
  }

  addEventListener(
    type: 'input',
    listener: EntryEditorInputEventListener | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: 'selectionchange',
    listener: EntryEditorSelectionEventListener | null,
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
      | EntryEditorInputEventListener
      | EntryEditorSelectionEventListener
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
    listener: EntryEditorInputEventListener | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: 'selectionchange',
    listener: EntryEditorSelectionEventListener | null,
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
      | EntryEditorInputEventListener
      | EntryEditorSelectionEventListener
      | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  destroy(): void {
    this.container.removeEventListener('mouseover', this.handleMouseOver);
    this.container.removeEventListener('mouseout', this.handleMouseOut);
    this.hideTooltip();
    this.tooltip.remove();
    this.entryGutterSlots.clear();
    this.gutterContent.clear();

    this.view.destroy();
  }

  private emitSelectionChange(): void {
    const snapshot = this.getSelectionSnapshot();
    const signature = snapshot ? JSON.stringify(snapshot) : null;

    if (signature === this.lastSelectionSignature) {
      return;
    }

    this.lastSelectionSignature = signature;
    this.dispatchEvent(
      new CustomEvent<EntryEditorSelectionDetail>('selectionchange', {
        detail: {
          editor: this,
          selection: snapshot,
        },
      }),
    );
  }

  private clearGutterSlot(entryId: string): void {
    const binding = this.entryGutterSlots.get(entryId);

    if (!binding) {
      return;
    }

    binding.slotElement.replaceChildren();
    binding.entryElement.classList.remove('informe-entry--has-gutter-item');
  }

  private renderGutterSlot(entryId: string): void {
    let binding = this.entryGutterSlots.get(entryId);

    if (!binding) {
      binding = this.lookupGutterSlotBinding(entryId);
      if (binding) {
        this.entryGutterSlots.set(entryId, binding);
      }
    }

    if (!binding) {
      return;
    }

    const element = this.gutterContent.get(entryId);

    if (!element) {
      this.clearGutterSlot(entryId);
      return;
    }

    binding.slotElement.replaceChildren(element);
    binding.entryElement.classList.add('informe-entry--has-gutter-item');
  }

  private lookupGutterSlotBinding(entryId: string): EntryGutterSlotBinding | undefined {
    const entries = this.container.querySelectorAll<HTMLElement>('.informe-entry');

    for (const entryElement of entries) {
      if (entryElement.dataset.entryId !== entryId) {
        continue;
      }

      const slotElement = entryElement.querySelector<HTMLElement>('.informe-entry-gutter-slot');

      if (!slotElement) {
        continue;
      }

      const parsed = parseEntryText(entryElement.textContent ?? '');
      return {
        entry: {
          id: entryId,
          order: entryElement.dataset.entryOrder ?? '',
          key: parsed.key,
          value: parsed.value,
          disabled: entryElement.classList.contains('informe-entry--disabled'),
        },
        entryElement,
        slotElement,
      };
    }

    return undefined;
  }

  private emitMutation(previousEntries: readonly RawEntry[]): void {
    const entries = this.getEntries();
    const changes = diffEntries(previousEntries, entries);

    if (changes.length === 0) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<EntryEditorInputDetail>('input', {
        detail: {
          editor: this,
          changes,
        },
      }),
    );
    this.onChangeRef.current?.(entries, this);
  }

  private createStampTransaction(state: EditorState): Transaction | undefined {
    const entries: Array<{ node: ProseMirrorNode; offset: number; entry: Entry }> = [];
    const usedIds = new Set<string>();

    state.doc.forEach((node, offset) => {
      if (node.type !== entrySchema.nodes.entry) {
        return;
      }

      const entry = entryFromNode(node);
      entries.push({ node, offset, entry });

      if (entry.id) {
        usedIds.add(entry.id);
      }
    });

    let transaction: Transaction | undefined;

    for (let index = 0; index < entries.length; index++) {
      const item = entries[index];
      const needsId = !item.entry.id;
      const needsOrder = !item.entry.order;

      if (!needsId && !needsOrder) {
        continue;
      }

      const id = needsId
        ? this.stamper.generateId(usedIds)
        : item.entry.id as string;
      const order = needsOrder
        ? orderBetween(
            entries[index - 1]?.entry.order,
            nextEntryOrder(entries, index),
          )
        : item.entry.order as string;

      item.entry.id = id;
      item.entry.order = order;
      usedIds.add(id);
      transaction ??= state.tr;
      transaction.setNodeMarkup(item.offset, undefined, {
        ...item.node.attrs,
        id,
        order,
      });
    }

    if (!transaction) {
      return undefined;
    }

    transaction.setMeta('addToHistory', false);
    return transaction;
  }

  private showTooltip(target: HTMLElement): void {
    const key = target.textContent?.trim();

    if (!key) {
      return;
    }

    const descriptor = this.schemaRef.current[key];
    const nodes = descriptor ? buildSchemaDetailNodes(descriptor) : [];

    if (nodes.length === 0) {
      return;
    }

    const rect = target.getBoundingClientRect();
    this.tooltip.replaceChildren(...nodes);
    this.tooltip.style.left = `${rect.left}px`;
    this.tooltip.style.top = `${rect.bottom + 4}px`;
    this.tooltip.classList.add('informe-schema-tooltip--visible');
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove('informe-schema-tooltip--visible');
  }
}

export function createEntryEditor(
  container: HTMLElement,
  options?: EntryEditorOptions,
): EntryEditor {
  return new EntryEditor(container, options);
}
