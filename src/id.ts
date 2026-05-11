import type { Entry, IdGenerator, RawEntry } from './input';

const orderAlphabet =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const orderBase = orderAlphabet.length;
const orderPattern = /^[0-9A-Za-z]+$/;

export class InformeIdCollisionError extends Error {
  constructor(id: string) {
    super(`Informe id generator returned a duplicate id: "${id}".`);
    this.name = 'InformeIdCollisionError';
  }
}

export function randomIds(): IdGenerator {
  return () => {
    const crypto = globalThis.crypto;

    if (typeof crypto?.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    if (typeof crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return [...bytes]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };
}

export function orderBetween(
  left: string | undefined,
  right: string | undefined,
): string {
  if (left != null && !isValidOrder(left)) {
    throw new TypeError(`Invalid Informe order value: "${left}".`);
  }

  if (right != null && !isValidOrder(right)) {
    throw new TypeError(`Invalid Informe order value: "${right}".`);
  }

  if (left != null && right != null && left >= right) {
    throw new Error('Cannot create an Informe order between unordered bounds.');
  }

  let prefix = '';
  let offset = 0;

  while (true) {
    const leftDigit =
      left != null && offset < left.length
        ? orderAlphabet.indexOf(left[offset])
        : -1;
    const rightDigit =
      right != null && offset < right.length
        ? orderAlphabet.indexOf(right[offset])
        : orderBase;

    if (rightDigit - leftDigit > 1) {
      return prefix + orderAlphabet[Math.floor((leftDigit + rightDigit) / 2)];
    }

    if (leftDigit < 0) {
      throw new Error('Cannot create an Informe order before the minimum value.');
    }

    prefix += orderAlphabet[leftDigit];
    offset += 1;
  }
}

export function validateOrderInput(entries: readonly Entry[]): boolean {
  const seen = new Set<string>();
  let previous: string | undefined;

  for (const entry of entries) {
    if (!isValidOrder(entry.order)) {
      return false;
    }

    if (seen.has(entry.order) || (previous != null && previous >= entry.order)) {
      return false;
    }

    seen.add(entry.order);
    previous = entry.order;
  }

  return true;
}

export class EntryStamper {
  private nextDefaultId = 1;

  constructor(private readonly idGenerator?: IdGenerator) {}

  stampEntries(entries: readonly Entry[]): RawEntry[] {
    const keepOrders = validateOrderInput(entries);
    const usedIds = this.usedIds(entries);
    const stamped: RawEntry[] = [];

    this.advanceDefaultId(entries);

    for (const entry of entries) {
      const id = this.entryId(entry, usedIds);
      const order = keepOrders
        ? (entry.order as string)
        : orderBetween(stamped.at(-1)?.order, undefined);

      stamped.push({ ...entry, id, order });
    }

    return stamped;
  }

  generateId(usedIds: ReadonlySet<string>): string {
    const id = this.idGenerator?.() ?? this.defaultId();

    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('Informe id generator must return a non-empty string.');
    }

    if (usedIds.has(id)) {
      throw new InformeIdCollisionError(id);
    }

    return id;
  }

  private entryId(entry: Entry, usedIds: Set<string>): string {
    if (isNonEmptyString(entry.id)) {
      return entry.id;
    }

    const id = this.generateId(usedIds);
    usedIds.add(id);
    return id;
  }

  private defaultId(): string {
    const id = String(this.nextDefaultId);
    this.nextDefaultId += 1;
    return id;
  }

  private advanceDefaultId(entries: readonly Entry[]): void {
    if (this.idGenerator) {
      return;
    }

    for (const entry of entries) {
      if (!isNonEmptyString(entry.id)) {
        continue;
      }

      const numericId = Number(entry.id);

      if (
        Number.isInteger(numericId) &&
        numericId >= this.nextDefaultId &&
        String(numericId) === entry.id
      ) {
        this.nextDefaultId = numericId + 1;
      }
    }
  }

  private usedIds(entries: readonly Entry[]): Set<string> {
    const ids = new Set<string>();

    for (const entry of entries) {
      if (!isNonEmptyString(entry.id)) {
        continue;
      }

      if (ids.has(entry.id)) {
        throw new InformeIdCollisionError(entry.id);
      }

      ids.add(entry.id);
    }

    return ids;
  }
}

function isValidOrder(value: unknown): value is string {
  return typeof value === 'string' && orderPattern.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
