/**
 * Derived preferences and cross-preference invariants.
 *
 * Some preferences cannot be expressed as independent values - High Privacy
 * Mode, for example, must actually disable search suggestions, prefetch and
 * speculative connections. Rather than mutating the user's stored values
 * behind their back (which makes "why is this off?" unanswerable), Aurelia
 * computes an *effective* set of values plus a reason for each override.
 * The settings UI renders those reasons so a disabled control always explains
 * itself.
 */
import { getPrefDefinition, type PrefValue } from './schema.js';

export interface PrefOverride {
  key: string;
  storedValue: PrefValue;
  effectiveValue: PrefValue;
  /** Machine-readable cause, e.g. `high-privacy-mode`. */
  cause: string;
  /** User-facing explanation. */
  explanation: string;
}

export interface EffectivePrefs {
  values: Record<string, PrefValue>;
  overrides: PrefOverride[];
}

/** Network-request-producing preferences disabled by High Privacy Mode. */
export const HIGH_PRIVACY_DISABLES: ReadonlyArray<{
  key: string;
  value: PrefValue;
  explanation: string;
}> = [
  {
    key: 'search.suggestions',
    value: false,
    explanation:
      'Search suggestions send what you type to your search provider, so High Privacy Mode turns them off.',
  },
  {
    key: 'search.prefetch',
    value: false,
    explanation:
      'Prefetching fetches pages you have not chosen to open, so High Privacy Mode turns it off.',
  },
  {
    key: 'search.dnsPrefetch',
    value: false,
    explanation:
      'DNS prefetch reveals hostnames of links you may never follow, so High Privacy Mode turns it off.',
  },
  {
    key: 'search.preconnect',
    value: false,
    explanation:
      'Preconnecting opens TLS sessions to origins before you visit them, so High Privacy Mode turns it off.',
  },
];

/**
 * Compute effective preference values from the stored ones.
 * Never mutates the input.
 */
export function effectivePrefs(
  stored: Readonly<Record<string, PrefValue>>,
): EffectivePrefs {
  const values: Record<string, PrefValue> = { ...stored };
  const overrides: PrefOverride[] = [];

  const highPrivacy = stored['privacy.highPrivacyMode'] === true;
  if (highPrivacy) {
    for (const rule of HIGH_PRIVACY_DISABLES) {
      const definition = getPrefDefinition(rule.key);
      if (definition === undefined) continue;
      const storedValue = stored[rule.key] ?? definition.default;
      if (storedValue === rule.value) continue;
      values[rule.key] = rule.value;
      overrides.push({
        key: rule.key,
        storedValue,
        effectiveValue: rule.value,
        cause: 'high-privacy-mode',
        explanation: rule.explanation,
      });
    }
  }

  return { values, overrides };
}

export interface InvariantViolation {
  /** Machine-readable identifier, stable for tests and diagnostics. */
  id: string;
  severity: 'error' | 'warning';
  keys: readonly string[];
  message: string;
}

/**
 * Check cross-preference invariants.
 *
 * `error` means the configuration must be repaired before the affected
 * feature may run (for example: sync without E2EE). `warning` means the
 * configuration is allowed but the user must be told about the consequence.
 */
export function checkInvariants(
  stored: Readonly<Record<string, PrefValue>>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (stored['sync.enabled'] === true && stored['sync.e2eeEnabled'] !== true) {
    violations.push({
      id: 'sync-requires-e2ee',
      severity: 'error',
      keys: ['sync.enabled', 'sync.e2eeEnabled'],
      message:
        'Sync will not run without end-to-end encryption. Aurelia never uploads readable browsing data.',
    });
  }

  if (
    stored['dns.secureMode'] === 'automatic' &&
    stored['dns.allowPlaintextFallback'] === true
  ) {
    violations.push({
      id: 'dns-plaintext-fallback',
      severity: 'warning',
      keys: ['dns.secureMode', 'dns.allowPlaintextFallback'],
      message:
        'In automatic mode, failed encrypted DNS lookups may fall back to unencrypted DNS. Use secure mode to fail closed instead.',
    });
  }

  if (
    stored['translation.mode'] !== 'off' &&
    stored['translation.providerId'] === 'none'
  ) {
    violations.push({
      id: 'translation-without-provider',
      severity: 'warning',
      keys: ['translation.mode', 'translation.providerId'],
      message:
        'Translation is enabled but no provider is configured. Nothing is sent anywhere until you configure one.',
    });
  }

  if (
    stored['privacy.crashReporting'] !== 'off' &&
    stored['privacy.telemetryEnabled'] !== true &&
    stored['privacy.crashReporting'] === 'on'
  ) {
    violations.push({
      id: 'crash-reporting-endpoint-missing',
      severity: 'warning',
      keys: ['privacy.crashReporting'],
      message:
        'Crash reporting is enabled but Aurelia ships no crash endpoint. Reports stay local until an endpoint is configured explicitly.',
    });
  }

  if (
    stored['appearance.siteCss'] === 'global' &&
    stored['privacy.highPrivacyMode'] === true
  ) {
    violations.push({
      id: 'global-site-css-in-high-privacy',
      severity: 'warning',
      keys: ['appearance.siteCss', 'privacy.highPrivacyMode'],
      message:
        'A global website stylesheet is enabled while High Privacy Mode is on. Stylesheets cannot execute script, but you enabled them for every site you visit.',
    });
  }

  return violations;
}
