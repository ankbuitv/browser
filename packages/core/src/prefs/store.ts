/**
 * Preference store: schema-validated, observable, policy-aware.
 *
 * Two properties matter for security review:
 *  1. A preference whose scope is `managed` cannot be written by anything but
 *     an enterprise policy source. The settings UI therefore cannot silently
 *     undo an administrator decision, and an administrator cannot be
 *     impersonated by web content through a UI bug.
 *  2. Sensitive preferences (`sensitivity: 'secret'`) are never serialised by
 *     this store into plaintext sync payloads - see docs/SYNC-ARCHITECTURE.md.
 */
import {
  defaultPrefs,
  getPrefDefinition,
  validatePrefValue,
  type PrefDefinition,
  type PrefValue,
} from './schema.js';

export type PrefWriteSource = 'user' | 'policy' | 'extension' | 'default';

export interface PrefChange {
  key: string;
  oldValue: PrefValue;
  newValue: PrefValue;
  source: PrefWriteSource;
}

export interface PrefWriteResult {
  ok: boolean;
  /** Machine-readable failure reason when `ok` is false. */
  reason: string | null;
}

export type PrefChangeListener = (change: PrefChange) => void;

export interface PrefStoreOptions {
  /** Overrides layered on top of schema defaults (e.g. loaded profile prefs). */
  initial?: Readonly<Record<string, PrefValue>>;
  /** Non-fatal problems encountered while loading `initial`. */
  onRejected?: (key: string, value: PrefValue, reason: string) => void;
}

export class PrefStore {
  readonly #values: Map<string, PrefValue>;
  readonly #listeners = new Set<PrefChangeListener>();
  readonly #rejected: Array<{ key: string; value: PrefValue; reason: string }> =
    [];

  constructor(options: PrefStoreOptions = {}) {
    this.#values = new Map(Object.entries(defaultPrefs()));
    if (options.initial !== undefined) {
      for (const [key, value] of Object.entries(options.initial)) {
        const result = this.set(key, value, 'default');
        if (!result.ok) {
          const reason = result.reason ?? 'invalid-value';
          this.#rejected.push({ key, value, reason });
          options.onRejected?.(key, value, reason);
        }
      }
    }
  }

  /** Values that were dropped while loading, for diagnostics. */
  get rejectedValues(): ReadonlyArray<{
    key: string;
    value: PrefValue;
    reason: string;
  }> {
    return this.#rejected;
  }

  /** All current values, including defaults. */
  snapshot(): Record<string, PrefValue> {
    return Object.fromEntries(this.#values);
  }

  get(key: string): PrefValue | undefined {
    return this.#values.get(key);
  }

  getBoolean(key: string): boolean {
    const value = this.#values.get(key);
    return typeof value === 'boolean' ? value : false;
  }

  getString(key: string): string {
    const value = this.#values.get(key);
    return typeof value === 'string' ? value : '';
  }

  getNumber(key: string): number {
    const value = this.#values.get(key);
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Write a value. The write is rejected (and nothing changes) when:
   *  - the key is unknown;
   *  - the value fails schema validation;
   *  - the preference is managed and the source is not `policy`.
   */
  set(
    key: string,
    value: PrefValue,
    source: PrefWriteSource = 'user',
  ): PrefWriteResult {
    const definition: PrefDefinition | undefined = getPrefDefinition(key);
    if (definition === undefined) {
      return { ok: false, reason: 'unknown-pref' };
    }
    if (definition.scope === 'managed' && source !== 'policy') {
      return { ok: false, reason: 'managed-pref-read-only' };
    }
    const problem = validatePrefValue(definition, value);
    if (problem !== null) {
      return { ok: false, reason: problem };
    }
    const oldValue = this.#values.get(key);
    if (oldValue === value) {
      return { ok: true, reason: null };
    }
    this.#values.set(key, value);
    const change: PrefChange = {
      key,
      oldValue: oldValue ?? value,
      newValue: value,
      source,
    };
    for (const listener of this.#listeners) {
      listener(change);
    }
    return { ok: true, reason: null };
  }

  /** Restore a preference to its schema default. */
  reset(key: string, source: PrefWriteSource = 'user'): PrefWriteResult {
    const definition = getPrefDefinition(key);
    if (definition === undefined) {
      return { ok: false, reason: 'unknown-pref' };
    }
    return this.set(key, definition.default, source);
  }

  /**
   * Reset everything the given source is allowed to change.
   * Managed preferences are left untouched: an admin policy outlives a
   * "restore settings" action.
   */
  resetAll(source: PrefWriteSource = 'user'): void {
    for (const key of Object.keys(defaultPrefs())) {
      const definition = getPrefDefinition(key);
      if (definition === undefined) continue;
      if (definition.scope === 'managed' && source !== 'policy') continue;
      this.#values.set(key, definition.default);
    }
  }

  subscribe(listener: PrefChangeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Keys whose definition matches the predicate. */
  keysWhere(predicate: (definition: PrefDefinition) => boolean): string[] {
    const keys: string[] = [];
    for (const key of this.#values.keys()) {
      const definition = getPrefDefinition(key);
      if (definition !== undefined && predicate(definition)) {
        keys.push(key);
      }
    }
    return keys;
  }
}
