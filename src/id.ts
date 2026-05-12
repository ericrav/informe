import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

import type { Entry, IdGenerator, RawEntry } from './input';

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
  return generateKeyBetween(left ?? null, right ?? null);
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
    const generatedOrders = keepOrders
      ? undefined
      : generateNKeysBetween(null, null, entries.length);

    this.advanceDefaultId(entries);

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const id = this.entryId(entry, usedIds);
      const order = keepOrders
        ? (entry.order as string)
        : (generatedOrders as string[])[index];

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
  if (typeof value !== 'string' || !orderPattern.test(value)) {
    return false;
  }

  try {
    generateKeyBetween(value, null);
    return true;
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
