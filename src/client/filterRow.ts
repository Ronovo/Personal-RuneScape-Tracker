// The filter drawer both the Grand Exchange and Flip Helper pages carry. A page
// declares its fields here and keeps whatever is its own (which sorts exist,
// what a preset means, when to reload).

import { el, safeJsonParse, storageGet, storageRemove, storageSet } from './format.js';
import type { SortDir } from '../shared/types.js';

export interface FieldSpec {
  /** Element id. Also the key in the stored object unless `key` says otherwise. */
  id: string;
  /** Stored key, when it differs from the element id (GE's #sortBy holds `sort`). */
  key?: string;
  /** Checkboxes carry `checked`; everything else carries `value`. */
  kind?: 'value' | 'checked';
  /**
   * Blank is a real answer for this field - "no price cap", "any age" - so
   * restoring an empty value must leave it empty rather than substituting the
   * default. Without this, clearing Max price would silently re-cap the scan.
   */
  blankable?: boolean;
}

export type FilterValue = string | boolean;

export interface FilterRow<V extends Record<string, FilterValue>> {
  /** Current control values, keyed as stored. */
  read(): V;
  /** Writes values into the controls, falling back to the defaults per field. */
  apply(values: Partial<V>): void;
  /** Saves the current controls, plus any page state passed in. */
  persist(extra?: Record<string, unknown>): void;
  /** What was last saved, if anything. */
  saved<T extends object>(): Partial<V> & Partial<T>;
  /** Forgets the saved row, so the next apply(defaults) is what the page opens with. */
  clear(): void;
}

// A stored value that is no longer one of the control's options would blank it,
// so fall back rather than trusting whatever came out of localStorage.
function isRealOption(el: HTMLSelectElement, value: string): boolean {
  return [...el.options].some((o) => o.value === value);
}

export function createFilterRow<V extends Record<string, FilterValue>>(
  storageKey: string,
  fields: FieldSpec[],
  defaults: V,
): FilterRow<V> {
  const keyOf = (f: FieldSpec): string => f.key ?? f.id;

  function read(): V {
    const values = {} as Record<string, FilterValue>;
    for (const field of fields) {
      const control = el<HTMLInputElement | HTMLSelectElement | null>(field.id);
      if (!control) continue;
      values[keyOf(field)] = field.kind === 'checked' ? (control as HTMLInputElement).checked : control.value;
    }
    return values as V;
  }

  function apply(values: Partial<V>): void {
    for (const field of fields) {
      const control = el<HTMLInputElement | HTMLSelectElement | null>(field.id);
      if (!control) continue;
      const key = keyOf(field);
      const incoming = values[key as keyof V];

      if (field.kind === 'checked') {
        (control as HTMLInputElement).checked = Boolean(incoming ?? defaults[key as keyof V]);
        continue;
      }

      // An absent value takes the default; a blank one is kept only where the
      // field says blank means something.
      const fallback = String(defaults[key as keyof V] ?? '');
      const next = incoming === undefined || incoming === null || (incoming === '' && !field.blankable)
        ? fallback
        : String(incoming);
      control.value = control instanceof HTMLSelectElement && !isRealOption(control, next) ? fallback : next;
    }
  }

  function persist(extra: Record<string, unknown> = {}): void {
    storageSet(localStorage, storageKey, JSON.stringify({ ...read(), ...extra }));
  }

  function saved<T extends object>(): Partial<V> & Partial<T> {
    return safeJsonParse<Partial<V> & Partial<T>>(storageGet(localStorage, storageKey), {});
  }

  function clear(): void {
    storageRemove(localStorage, storageKey);
  }

  return { read, apply, persist, saved, clear };
}

/** The sort-direction button's label. Both pages show the same two strings. */
export function sortDirLabel(dir: SortDir): string {
  return dir === 'desc' ? '↓ High to low' : '↑ Low to high';
}

export function flipSortDir(dir: SortDir): SortDir {
  return dir === 'desc' ? 'asc' : 'desc';
}
