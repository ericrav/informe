import type { InformeFieldValue, RawEntry } from './input';

export type ChangeRecord =
  | { type: 'add'; newEntry: RawEntry }
  | { type: 'remove'; oldEntry: RawEntry }
  | { type: 'update'; oldEntry: RawEntry; newEntry: RawEntry };

export type ResolvedView = Record<string, InformeFieldValue | undefined>;

export function diffEntries(
  previousEntries: readonly RawEntry[],
  nextEntries: readonly RawEntry[],
): ChangeRecord[] {
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
  const nextById = new Map(nextEntries.map((entry) => [entry.id, entry]));
  const changes: ChangeRecord[] = [];

  for (const nextEntry of nextEntries) {
    const previousEntry = previousById.get(nextEntry.id);

    if (!previousEntry) {
      changes.push({ type: 'add', newEntry: cloneEntry(nextEntry) });
      continue;
    }

    if (!entriesEqual(previousEntry, nextEntry)) {
      changes.push({
        type: 'update',
        oldEntry: cloneEntry(previousEntry),
        newEntry: cloneEntry(nextEntry),
      });
    }
  }

  for (const previousEntry of previousEntries) {
    if (!nextById.has(previousEntry.id)) {
      changes.push({ type: 'remove', oldEntry: cloneEntry(previousEntry) });
    }
  }

  return changes;
}

export function resolvedViewDiffers(
  previousView: ResolvedView,
  nextView: ResolvedView,
): boolean {
  const previousKeys = Object.keys(previousView);
  const nextKeys = Object.keys(nextView);

  if (previousKeys.length !== nextKeys.length) {
    return true;
  }

  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(nextView, key)) {
      return true;
    }

    if (previousView[key] !== nextView[key]) {
      return true;
    }
  }

  return false;
}

function entriesEqual(left: RawEntry, right: RawEntry): boolean {
  return (
    left.id === right.id &&
    left.order === right.order &&
    left.key === right.key &&
    left.value === right.value &&
    Boolean(left.hasSeparator) === Boolean(right.hasSeparator) &&
    Boolean(left.disabled) === Boolean(right.disabled)
  );
}

function cloneEntry(entry: RawEntry): RawEntry {
  return { ...entry };
}
