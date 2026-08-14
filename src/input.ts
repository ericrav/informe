export interface Entry {
  id?: string;
  key: string;
  value: string;
  hasSeparator?: boolean;
  disabled?: boolean;
  order?: string;
}

export interface RawEntry extends Entry {
  id: string;
  order: string;
}

export type IdGenerator = () => string;

export type InformeInputType = 'string' | 'number' | 'color' | 'date' | 'datetime';
export type InformeFieldValue = string | number;

export type WidgetCleanup = () => void;
export type WidgetUpdateCallback = (value: string) => WidgetCleanup | void;

export interface InputWidgetContext {
  descriptor: SchemaDescriptor;
  setValue(newValue: string): void;
  onUpdate(callback: WidgetUpdateCallback): void;
  onDestroy(callback: WidgetCleanup): void;
}

export type InputWidget = (ctx: InputWidgetContext) => HTMLElement;

export interface InputOption {
  label: string;
  value: string;
}

export type InputOptionList = Array<string | InputOption>;

export interface SchemaDescriptor {
  type?: InformeInputType | string;
  label?: string;
  description?: string;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  step?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string | RegExp;
  default?: unknown;
  placeholder?: string;
  options?: InputOptionList;
  widget?: InputWidget;
  [key: string]: unknown;
}

export type SchemaDescriptorMap = Record<string, SchemaDescriptor>;

const inputDescriptorKey = '__informeInput';

export interface InputOptions<
  TValue extends InformeFieldValue = InformeFieldValue,
> extends SchemaDescriptor {
  type?: 'string' | 'number';
  default?: TValue;
  options?: InputOptionList;
}

export interface InputDescriptor<
  TValue extends InformeFieldValue = InformeFieldValue,
> extends Omit<InputOptions<TValue>, 'type'> {
  type?: InformeInputType | string;
  readonly __informeInput: true;
}

export type InformeFieldDefinition = InformeFieldValue | InputDescriptor;
export type InformeFieldMap = Record<string, InformeFieldDefinition>;

type WidenFieldValue<TValue> = TValue extends number
  ? number
  : TValue extends string
    ? string
    : InformeFieldValue;

type ExtractOptionValue<T> = T extends string
  ? T
  : T extends { readonly value: infer V extends string }
    ? V
    : never;

type InferOptionsValue<TOptions> = TOptions extends {
  readonly options: readonly (infer Option)[];
}
  ? ExtractOptionValue<Option>
  : never;

type InferInputOptionsValue<TOptions extends InputOptions> = TOptions extends {
  type: 'number';
}
  ? number
  : TOptions extends { readonly options: readonly unknown[] }
    ? InferOptionsValue<TOptions>
    : TOptions extends { default: infer TValue extends InformeFieldValue }
      ? WidenFieldValue<TValue>
      : string;

type InferInputValue<TDescriptor> =
  TDescriptor extends InputDescriptor<infer TValue> ? TValue : never;
type InferFieldValue<TField> = TField extends number
  ? number
  : TField extends string
    ? string
    : TField extends InputDescriptor
      ? InferInputValue<TField>
      : InformeFieldValue;

export type InformeValue<TFields extends InformeFieldMap> = {
  [Key in keyof TFields]: InferFieldValue<TFields[Key]> | undefined;
};
export type InformeFieldKey<TFields extends InformeFieldMap> = Extract<
  keyof TFields,
  string
>;
export type InformeResolvedValue<
  TFields extends InformeFieldMap,
  TKey extends InformeFieldKey<TFields>,
> = InferFieldValue<TFields[TKey]>;

export interface NormalizedFields {
  entries: Entry[];
  schema: SchemaDescriptorMap;
}

export function input<const TOptions extends InputOptions>(
  options: TOptions &
    (TOptions extends { type: 'number' } ? { options?: never } : unknown),
): InputDescriptor<InferInputOptionsValue<TOptions>> {
  const descriptor = {
    ...options,
    type: options.type ?? inferInputType(options.default) ?? 'string',
  };

  Object.defineProperty(descriptor, inputDescriptorKey, {
    value: true,
    enumerable: false,
  });

  return descriptor as unknown as InputDescriptor<
    InferInputOptionsValue<TOptions>
  >;
}

export function normalizeInformeFields(
  fields: InformeFieldMap,
): NormalizedFields {
  const entries: Entry[] = [];
  const schema: SchemaDescriptorMap = {};

  for (const [key, field] of Object.entries(fields)) {
    const descriptor = normalizeFieldDescriptor(field);
    schema[key] = descriptor;

    if (shouldCreateInitialEntry(field, descriptor)) {
      entries.push({ key, value: serializeInitialValue(descriptor) });
    }
  }

  return { entries, schema };
}

function isInputDescriptor(
  value: InformeFieldDefinition,
): value is InputDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as InputDescriptor).__informeInput === true
  );
}

function hasOwnDefault(descriptor: SchemaDescriptor): boolean {
  return Object.prototype.hasOwnProperty.call(descriptor, 'default');
}

function inferInputType(value: unknown): InformeInputType | undefined {
  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  return undefined;
}

function normalizeFieldDescriptor(
  field: InformeFieldDefinition,
): SchemaDescriptor {
  if (!isInputDescriptor(field)) {
    return {
      type: inferInputType(field) ?? 'string',
      default: field,
    };
  }

  const descriptor: SchemaDescriptor = { ...field };
  delete descriptor[inputDescriptorKey];
  const type =
    descriptor.type ?? inferInputType(descriptor.default) ?? 'string';

  return { ...descriptor, type };
}

function shouldCreateInitialEntry(
  field: InformeFieldDefinition,
  descriptor: SchemaDescriptor,
): boolean {
  return (
    !isInputDescriptor(field) ||
    hasOwnDefault(descriptor) ||
    descriptor.required === true
  );
}

function serializeInitialValue(descriptor: SchemaDescriptor): string {
  return hasOwnDefault(descriptor) && descriptor.default != null
    ? String(descriptor.default)
    : '';
}
