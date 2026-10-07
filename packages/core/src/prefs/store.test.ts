import { describe, expect, it, vi } from 'vitest';

import {
  PREF_KEYS,
  PREFS,
  defaultPrefs,
  getPrefDefinition,
  validatePrefValue,
} from './schema.js';
import { PrefStore } from './store.js';
import { checkInvariants, effectivePrefs } from './derived.js';

describe('preference schema', () => {
  it('exposes every preference with a unique key', () => {
    const keys = PREFS.map((pref) => pref.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('documents every preference and never leaves a privacy note empty when it has an impact', () => {
    for (const pref of PREFS) {
      expect(pref.description.length).toBeGreaterThan(10);
      if ('privacyImpact' in pref && pref.privacyImpact !== undefined) {
        expect(pref.privacyImpact.length).toBeGreaterThan(10);
      }
    }
  });

  it('ships privacy-preserving defaults: no telemetry, no crash upload, no sync', () => {
    const defaults = defaultPrefs();
    expect(defaults['privacy.telemetryEnabled']).toBe(false);
    expect(defaults['privacy.crashReporting']).toBe('off');
    expect(defaults['sync.enabled']).toBe(false);
    expect(defaults['translation.mode']).toBe('off');
    expect(defaults['dns.secureMode']).toBe('secure');
    expect(defaults['dns.allowPlaintextFallback']).toBe(false);
    expect(defaults['privacy.globalPrivacyControl']).toBe(true);
    expect(defaults['privacy.stripTrackingParameters']).toBe(true);
  });

  it('keeps Google as the default search engine while leaving it changeable', () => {
    expect(defaultPrefs()['search.engineId']).toBe('google');
    expect(getPrefDefinition('search.template')?.type).toBe('string');
  });

  it('validates values against their definitions', () => {
    const booleanPref = getPrefDefinition('shields.enabled');
    const enumPref = getPrefDefinition('privacy.safeBrowsing');
    const stringPref = getPrefDefinition('appearance.accent');
    expect(booleanPref).toBeDefined();
    expect(enumPref).toBeDefined();
    expect(stringPref).toBeDefined();

    expect(validatePrefValue(booleanPref!, true)).toBeNull();
    expect(validatePrefValue(booleanPref!, 'yes')).toBe('expected-boolean');
    expect(validatePrefValue(enumPref!, 'enhanced')).toBeNull();
    expect(validatePrefValue(enumPref!, 'paranoid')).toBe('value-not-in-enum');
    expect(validatePrefValue(stringPref!, '#fff')).toBeNull();
    expect(validatePrefValue(stringPref!, 'x'.repeat(100))).toBe(
      'string-too-long',
    );
  });
});

describe('PrefStore', () => {
  it('starts from schema defaults', () => {
    const store = new PrefStore();
    expect(store.snapshot()).toEqual(defaultPrefs());
    expect(PREF_KEYS.every((key) => store.get(key) !== undefined)).toBe(true);
  });

  it('rejects unknown preferences', () => {
    const store = new PrefStore();
    expect(store.set('nope.nope', true)).toEqual({
      ok: false,
      reason: 'unknown-pref',
    });
  });

  it('rejects invalid values without changing state', () => {
    const store = new PrefStore();
    const result = store.set('appearance.theme', 'neon');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('value-not-in-enum');
    expect(store.getString('appearance.theme')).toBe('system');
  });

  it('notifies subscribers with the previous value', () => {
    const store = new PrefStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('appearance.theme', 'dark');
    expect(listener).toHaveBeenCalledWith({
      key: 'appearance.theme',
      oldValue: 'system',
      newValue: 'dark',
      source: 'user',
    });
  });

  it('does not notify when the value is unchanged', () => {
    const store = new PrefStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('appearance.theme', 'system');
    expect(listener).not.toHaveBeenCalled();
  });

  it('protects managed preferences from user writes', () => {
    const store = new PrefStore();
    expect(store.set('enterprise.managed', true, 'user')).toEqual({
      ok: false,
      reason: 'managed-pref-read-only',
    });
    expect(store.set('enterprise.managed', true, 'policy').ok).toBe(true);
    expect(store.getBoolean('enterprise.managed')).toBe(true);
  });

  it('keeps managed preferences across a user reset', () => {
    const store = new PrefStore();
    store.set('enterprise.managed', true, 'policy');
    store.set('appearance.theme', 'dark');
    store.resetAll('user');
    expect(store.getBoolean('enterprise.managed')).toBe(true);
    expect(store.getString('appearance.theme')).toBe('system');
  });

  it('reports rejected values loaded from disk', () => {
    const rejected: string[] = [];
    const store = new PrefStore({
      initial: {
        'appearance.theme': 'neon',
        'dns.secureMode': 'secure',
      },
      onRejected: (key) => rejected.push(key),
    });
    expect(rejected).toEqual(['appearance.theme']);
    expect(store.rejectedValues).toHaveLength(1);
    expect(store.getString('dns.secureMode')).toBe('secure');
  });

  it('can list keys by definition predicate', () => {
    const store = new PrefStore();
    const synced = store.keysWhere((definition) => definition.sync === 'e2ee');
    expect(synced).toContain('appearance.theme');
    expect(synced).not.toContain('sync.enabled');
  });
});

describe('effectivePrefs (High Privacy Mode)', () => {
  it('disables non-essential network features and explains each override', () => {
    const stored = defaultPrefs();
    stored['privacy.highPrivacyMode'] = true;
    const { values, overrides } = effectivePrefs(stored);

    expect(values['search.suggestions']).toBe(false);
    expect(values['search.prefetch']).toBe(false);
    expect(values['search.dnsPrefetch']).toBe(false);
    expect(values['search.preconnect']).toBe(false);
    expect(overrides).toHaveLength(4);
    for (const override of overrides) {
      expect(override.cause).toBe('high-privacy-mode');
      expect(override.explanation.length).toBeGreaterThan(10);
    }
  });

  it('never mutates the stored values', () => {
    const stored = defaultPrefs();
    stored['privacy.highPrivacyMode'] = true;
    effectivePrefs(stored);
    expect(stored['search.suggestions']).toBe(true);
  });

  it('leaves values alone when the mode is off', () => {
    const { values, overrides } = effectivePrefs(defaultPrefs());
    expect(overrides).toEqual([]);
    expect(values['search.suggestions']).toBe(true);
  });
});

describe('checkInvariants', () => {
  it('blocks sync without end-to-end encryption', () => {
    const prefs = defaultPrefs();
    prefs['sync.enabled'] = true;
    prefs['sync.e2eeEnabled'] = false;
    const violations = checkInvariants(prefs);
    expect(violations).toContainEqual(
      expect.objectContaining({ id: 'sync-requires-e2ee', severity: 'error' }),
    );
  });

  it('warns about plaintext DNS fallback in automatic mode', () => {
    const prefs = defaultPrefs();
    prefs['dns.secureMode'] = 'automatic';
    prefs['dns.allowPlaintextFallback'] = true;
    expect(checkInvariants(prefs)).toContainEqual(
      expect.objectContaining({
        id: 'dns-plaintext-fallback',
        severity: 'warning',
      }),
    );
  });

  it('reports nothing for the shipped defaults', () => {
    expect(checkInvariants(defaultPrefs())).toEqual([]);
  });
});
