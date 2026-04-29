import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
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
import { history, redo, undo } from 'prosemirror-history';
import type { Entry, SchemaDescriptor, SchemaDescriptorMap } from './input';

export type EntryChangeHandler = (
  entries: Entry[],
  editor: EntryEditor,
) => void;

export interface EntryEditorOptions {
  entries?: readonly Entry[];
  schema?: SchemaDescriptorMap;
  onChange?: EntryChangeHandler;
  onSave?: EntryChangeHandler;
  debounceMs?: number;
  className?: string;
}

const entrySchema = new Schema({
  nodes: {
    doc: { content: 'entry+' },
    entry: {
      content: 'text*',
      attrs: { disabled: { default: false }, id: { default: null } },
      toDOM(node) {
        const attrs: Record<string, string> = {
          class: `informe-entry${node.attrs.disabled ? ' informe-entry--disabled' : ''}`,
        };

        if (node.attrs.id) {
          attrs['data-entry-id'] = String(node.attrs.id);
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
            };
          },
        },
      ],
    },
    text: { inline: true },
  },
});

export function parseEntryText(text: string): { key: string; value: string } {
  const index = text.indexOf(':');

  if (index === -1) {
    return { key: text.trim(), value: '' };
  }

  return {
    key: text.slice(0, index).trim(),
    value: text.slice(index + 1).trimStart(),
  };
}

function entriesToDoc(entries: readonly Entry[]): ProseMirrorNode {
  const nodes = entries.map((entry) => {
    const text =
      entry.value === '' ? entry.key : `${entry.key}: ${entry.value}`;
    const content = text ? [entrySchema.text(text)] : [];

    return entrySchema.nodes.entry.create(
      { disabled: entry.disabled ?? false, id: entry.id ?? null },
      content,
    );
  });

  if (nodes.length === 0) {
    nodes.push(entrySchema.nodes.entry.create({}, []));
  }

  return entrySchema.nodes.doc.create(null, nodes);
}

function docToEntries(doc: ProseMirrorNode): Entry[] {
  const entries: Entry[] = [];

  doc.forEach((node) => {
    const { key, value } = parseEntryText(node.textContent);

    if (!key && !value) {
      return;
    }

    const entry: Entry = { key, value };

    if (node.attrs.id) {
      entry.id = node.attrs.id as string;
    }

    if (node.attrs.disabled) {
      entry.disabled = true;
    }

    entries.push(entry);
  });

  return entries;
}

const schemaHintsKey = new PluginKey<DecorationSet>('schemaHints');

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

function buildDecorations(
  doc: ProseMirrorNode,
  schema: SchemaDescriptorMap,
): DecorationSet {
  const decorations: Decoration[] = [];
  const knownKeys = new Set(Object.keys(schema));
  const entryKeys: Array<{ key: string; offset: number; disabled: boolean }> =
    [];

  doc.forEach((node, offset) => {
    const text = node.textContent;

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
    const text = node.textContent;

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
        }),
      );
    }

    if (colonIndex === -1) {
      return;
    }

    const descriptor = key ? schema[key] : undefined;
    const keyClass =
      descriptor && hasTooltipContent(descriptor)
        ? 'informe-entry-key informe-entry-key--has-info'
        : 'informe-entry-key';

    decorations.push(
      Decoration.inline(offset + 1, offset + 1 + colonIndex, {
        class: keyClass,
      }),
    );
    decorations.push(
      Decoration.inline(offset + 1 + colonIndex, offset + 1 + colonIndex + 1, {
        class: 'informe-entry-separator',
      }),
    );

    if (colonIndex + 1 < text.length) {
      decorations.push(
        Decoration.inline(
          offset + 1 + colonIndex + 1,
          offset + 1 + text.length,
          {
            class: 'informe-entry-value',
          },
        ),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function schemaHintsPlugin(schemaRef: {
  current: SchemaDescriptorMap;
}): Plugin {
  return new Plugin({
    key: schemaHintsKey,
    state: {
      init(_, state) {
        return buildDecorations(state.doc, schemaRef.current);
      },
      apply(transaction, oldDecorations) {
        if (transaction.docChanged || transaction.getMeta(schemaHintsKey)) {
          return buildDecorations(transaction.doc, schemaRef.current);
        }

        return oldDecorations.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations(state) {
        return schemaHintsKey.getState(state);
      },
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

  const afterEntry = $from.after();
  const transaction = state.tr.insert(
    afterEntry,
    entrySchema.nodes.entry.create({}, []),
  );
  transaction.setSelection(
    Selection.near(transaction.doc.resolve(afterEntry + 1)),
  );
  dispatch(transaction.scrollIntoView());

  return true;
}

function deleteEmptyEntry(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  const { $from } = state.selection;

  if (
    $from.parent.type !== entrySchema.nodes.entry ||
    $from.parent.textContent.length > 0 ||
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

function createEntryNodeView(
  node: ProseMirrorNode,
  view: EditorView,
  getPosition: () => number | undefined,
  decorations: readonly Decoration[],
): NodeView {
  const dom = document.createElement('div');
  dom.className = `informe-entry${node.attrs.disabled ? ' informe-entry--disabled' : ''}${decorationClasses(decorations)}`;

  const toggleWrapper = document.createElement('span');
  toggleWrapper.contentEditable = 'false';
  toggleWrapper.className = 'informe-entry-toggle-wrapper';

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

  return {
    dom,
    contentDOM,
    update(updatedNode, updatedDecorations) {
      if (updatedNode.type !== entrySchema.nodes.entry) {
        return false;
      }

      const disabled = Boolean(updatedNode.attrs.disabled);
      dom.className = `informe-entry${disabled ? ' informe-entry--disabled' : ''}${decorationClasses(updatedDecorations)}`;
      toggle.checked = !disabled;

      return true;
    },
  };
}

function buildTooltipContent(descriptor: SchemaDescriptor): string {
  const parts: string[] = [];

  if (descriptor.label) {
    parts.push(
      `<div class="informe-schema-tooltip-label">${escapeHtml(String(descriptor.label))}</div>`,
    );
  }

  if (descriptor.description) {
    parts.push(
      `<div class="informe-schema-tooltip-description">${escapeHtml(String(descriptor.description))}</div>`,
    );
  }

  const meta: string[] = [];

  if (descriptor.type) {
    meta.push(String(descriptor.type));
  }

  if (descriptor.required) {
    meta.push('required');
  }

  if (meta.length > 0) {
    parts.push(
      `<div class="informe-schema-tooltip-meta">${meta.map((item) => `<span class="informe-schema-tooltip-tag">${escapeHtml(item)}</span>`).join(' ')}</div>`,
    );
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
    parts.push(
      `<div class="informe-schema-tooltip-constraints">${escapeHtml(constraints.join(', '))}</div>`,
    );
  }

  return parts.join('');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export class EntryEditor {
  private readonly container: HTMLElement;
  private readonly schemaRef: { current: SchemaDescriptorMap };
  private readonly onChangeRef: { current?: EntryChangeHandler };
  private readonly tooltip: HTMLDivElement;
  private readonly handleMouseOver: (event: MouseEvent) => void;
  private readonly handleMouseOut: (event: MouseEvent) => void;
  private view: EditorView;
  private debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(container: HTMLElement, options: EntryEditorOptions = {}) {
    this.container = container;
    this.schemaRef = { current: options.schema ?? {} };
    this.onChangeRef = { current: options.onChange ?? options.onSave };
    this.debounceMs = options.debounceMs ?? 300;

    container.classList.add('informe-entry-editor');

    if (options.className) {
      container.classList.add(
        ...options.className.split(/\s+/).filter(Boolean),
      );
    }

    const state = EditorState.create({
      doc: entriesToDoc(options.entries ?? []),
      plugins: [
        history(),
        schemaHintsPlugin(this.schemaRef),
        keymap({
          Enter: insertEntry,
          Backspace: deleteEmptyEntry,
          'Mod-/': toggleDisabled,
          'Mod-z': undo,
          'Mod-Shift-z': redo,
          'Mod-y': redo,
        }),
      ],
    });

    let view!: EditorView;
    view = new EditorView(container, {
      state,
      nodeViews: { entry: createEntryNodeView },
      dispatchTransaction: (transaction) => {
        const nextState = view.state.apply(transaction);
        view.updateState(nextState);

        if (transaction.docChanged) {
          this.scheduleChange();
        }
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

  getEntries(): Entry[] {
    return docToEntries(this.view.state.doc);
  }

  setEntries(entries: readonly Entry[]): void {
    const nextDoc = entriesToDoc(entries);

    if (nextDoc.eq(this.view.state.doc)) {
      return;
    }

    this.view.updateState(
      EditorState.create({
        doc: nextDoc,
        plugins: this.view.state.plugins,
      }),
    );
  }

  setSchema(schema: SchemaDescriptorMap): void {
    this.schemaRef.current = schema;
    this.view.dispatch(this.view.state.tr.setMeta(schemaHintsKey, true));
  }

  setOptions(options: EntryEditorOptions): void {
    if ('onChange' in options || 'onSave' in options) {
      this.onChangeRef.current = options.onChange ?? options.onSave;
    }

    if (options.debounceMs != null) {
      this.debounceMs = options.debounceMs;
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

  destroy(): void {
    this.container.removeEventListener('mouseover', this.handleMouseOver);
    this.container.removeEventListener('mouseout', this.handleMouseOut);
    this.hideTooltip();
    this.tooltip.remove();

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.view.destroy();
  }

  private scheduleChange(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.onChangeRef.current?.(this.getEntries(), this);
    }, this.debounceMs);
  }

  private showTooltip(target: HTMLElement): void {
    const key = target.textContent?.trim();

    if (!key) {
      return;
    }

    const descriptor = this.schemaRef.current[key];
    const html = descriptor ? buildTooltipContent(descriptor) : '';

    if (!html) {
      return;
    }

    const rect = target.getBoundingClientRect();
    this.tooltip.innerHTML = html;
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
