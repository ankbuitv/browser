/**
 * Aurelia preference schema.
 *
 * Every user-visible setting is declared here with:
 *  - a single source of truth for defaults (never duplicated in C++ and TS);
 *  - an explicit scope, so managed/enterprise policy cannot be overwritten by
 *    the settings UI;
 *  - a sync classification, so secret material can never be synced in the
 *    clear (see docs/SYNC-ARCHITECTURE.md);
 *  - a privacy note that the settings UI surfaces next to the control.
 *
 * Keys use `group.name` dot notation. The values are stored in Chromium
 * profile preferences by the `components/aurelia/` integration layer; the
 * schema below is the contract that layer must honour.
 */

export type PrefScope = 'profile' | 'local' | 'managed';

/** How a preference participates in optional cloud sync. */
export type SyncClass =
  /** Never synced. */
  | 'none'
  /** Synced inside the encrypted payload (E2EE). */
  | 'e2ee';

export type Sensitivity = 'public' | 'private' | 'secret';

export type PrefValue = boolean | string | number;

interface PrefDefinitionBase {
  readonly key: string;
  readonly scope: PrefScope;
  readonly sync: SyncClass;
  readonly sensitivity: Sensitivity;
  /** Shown in settings and in generated documentation. */
  readonly description: string;
  /** Shown in settings when the setting affects network privacy. */
  readonly privacyImpact?: string;
}

export interface BooleanPrefDefinition extends PrefDefinitionBase {
  readonly type: 'boolean';
  readonly default: boolean;
}

export interface StringPrefDefinition extends PrefDefinitionBase {
  readonly type: 'string';
  readonly default: string;
  readonly maxLength: number;
}

export interface NumberPrefDefinition extends PrefDefinitionBase {
  readonly type: 'number';
  readonly default: number;
  readonly min: number;
  readonly max: number;
}

export interface EnumPrefDefinition extends PrefDefinitionBase {
  readonly type: 'enum';
  readonly default: string;
  readonly values: readonly string[];
}

export type PrefDefinition =
  | BooleanPrefDefinition
  | StringPrefDefinition
  | NumberPrefDefinition
  | EnumPrefDefinition;

export const SEARCH_TEMPLATE_GOOGLE =
  'https://www.google.com/search?q={searchTerms}';

export const PREFS: readonly PrefDefinition[] = [
  // ---------------------------------------------------------------- startup
  {
    key: 'startup.behavior',
    type: 'enum',
    default: 'newtab',
    values: ['newtab', 'continue', 'homepage'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'What Aurelia opens on launch.',
  },
  {
    key: 'startup.sessionRestore',
    type: 'enum',
    default: 'ask',
    values: ['ask', 'restore', 'newtab'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'Session restore behaviour. `ask` prompts after an unclean shutdown instead of restoring silently.',
    privacyImpact:
      'Restoring a session re-requests pages that were open at shutdown.',
  },
  {
    key: 'startup.restoreAfterCrash',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Offer to restore tabs after an unclean shutdown.',
  },

  // ------------------------------------------------------------- appearance
  {
    key: 'appearance.theme',
    type: 'enum',
    default: 'system',
    values: ['system', 'light', 'dark'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Browser UI theme.',
  },
  {
    key: 'appearance.accent',
    type: 'string',
    default: '#6e7bf2',
    maxLength: 32,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Accent colour used by the browser UI.',
  },
  {
    key: 'appearance.compactMode',
    type: 'boolean',
    default: false,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Reduce toolbar and tab strip density.',
  },
  {
    key: 'appearance.verticalTabs',
    type: 'boolean',
    default: false,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Show tabs in a collapsible vertical rail.',
  },
  {
    key: 'appearance.motion',
    type: 'enum',
    default: 'system',
    values: ['system', 'reduced', 'full'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description:
      'Animation preference. `system` follows the operating system reduce-motion setting.',
  },
  {
    key: 'appearance.transparency',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description:
      'Enable subtle blur/transparency in the browser UI where the platform supports it.',
    privacyImpact:
      'Transparency is skipped automatically on unsupported GPUs, in remote sessions and when the OS requests reduced transparency.',
  },
  {
    key: 'appearance.customUiCss',
    type: 'boolean',
    default: false,
    scope: 'local',
    sync: 'none',
    sensitivity: 'private',
    description:
      'Apply a user-provided stylesheet to the browser UI. This is a separate mechanism from website CSS and never runs on web content.',
    privacyImpact:
      'Browser-UI CSS runs with browser-UI privileges. Only enable stylesheets you wrote or trust.',
  },
  {
    key: 'appearance.siteCss',
    type: 'enum',
    default: 'off',
    values: ['off', 'per-site', 'global'],
    scope: 'local',
    sync: 'none',
    sensitivity: 'private',
    description:
      'Opt-in stylesheet injection into web pages. `per-site` requires an explicit grant per origin.',
    privacyImpact:
      'Injected CSS applies to web pages you visit. Aurelia restricts it to CSS: no script execution path is created.',
  },

  // ------------------------------------------------------------------ search
  {
    key: 'search.engineId',
    type: 'string',
    default: 'google',
    maxLength: 64,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Identifier of the default search provider.',
  },
  {
    key: 'search.template',
    type: 'string',
    default: SEARCH_TEMPLATE_GOOGLE,
    maxLength: 2048,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Search URL template containing {searchTerms}.',
  },
  {
    key: 'search.suggestions',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Request search suggestions while typing in the omnibox.',
    privacyImpact:
      'Every keystroke that forms a suggestion request is sent to the selected search provider.',
  },
  {
    key: 'search.prefetch',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Prefetch pages the browser predicts you will open.',
    privacyImpact:
      'Prefetching opens network connections to sites you have not chosen to visit yet.',
  },
  {
    key: 'search.dnsPrefetch',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Resolve hostnames of links and page subresources early.',
    privacyImpact:
      'DNS prefetch hints reveal hostnames to your resolver even for links you never follow.',
  },
  {
    key: 'search.preconnect',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Preconnect (TCP/TLS) to origins the browser predicts.',
    privacyImpact:
      'Preconnecting opens TLS sessions to origins before you navigate to them.',
  },

  // ----------------------------------------------------------------- privacy
  {
    key: 'privacy.highPrivacyMode',
    type: 'boolean',
    default: false,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'Enable High Privacy Mode: disables search suggestions, prefetch, preconnect and DNS prefetch, and tightens other defaults.',
    privacyImpact:
      'Reduces non-essential network traffic. Some sites will feel slower.',
  },
  {
    key: 'privacy.telemetryEnabled',
    type: 'boolean',
    default: false,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'Send product telemetry to Aurelia infrastructure. Ships disabled and is not required for any feature.',
    privacyImpact:
      'Aurelia ships no telemetry endpoint. This preference exists so that a future decision can never flip the default silently.',
  },
  {
    key: 'privacy.crashReporting',
    type: 'enum',
    default: 'off',
    values: ['off', 'ask', 'on'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Upload crash reports. Off by default; `ask` prompts first.',
    privacyImpact:
      'Crash reports can contain memory contents. Aurelia uploads only after explicit consent and only to a configured endpoint, never by default.',
  },
  {
    key: 'privacy.diagnosticsExport',
    type: 'boolean',
    default: false,
    scope: 'local',
    sync: 'none',
    sensitivity: 'private',
    description:
      'Allow the user to export a diagnostics bundle for bug reports. Export is always manually triggered and reviewed before sharing.',
  },
  {
    key: 'privacy.safeBrowsing',
    type: 'enum',
    default: 'standard',
    values: ['off', 'standard', 'enhanced'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'Phishing and malware protection level. `standard` uses Chromium Safe Browsing lookups; `enhanced` may send more data.',
    privacyImpact:
      'Standard mode sends partial URL hashes to Google Safe Browsing. See PRIVACY.md for the exact data flow.',
  },
  {
    key: 'privacy.httpsOnlyMode',
    type: 'enum',
    default: 'balanced',
    values: ['off', 'balanced', 'strict'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description:
      'Upgrade navigations to HTTPS. `balanced` warns before falling back to HTTP; `strict` never falls back.',
  },
  {
    key: 'privacy.thirdPartyCookies',
    type: 'enum',
    default: 'block-trackers',
    values: ['allow', 'block-trackers', 'block-third-party'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Third-party cookie policy.',
    privacyImpact:
      'Blocking third-party cookies breaks embedded sign-in flows on some sites; per-site exceptions are available.',
  },
  {
    key: 'privacy.globalPrivacyControl',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Send the Global Privacy Control (Sec-GPC) header.',
  },
  {
    key: 'privacy.stripTrackingParameters',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description:
      'Remove known tracking parameters (utm_*, fbclid, gclid, ...) before navigating.',
    privacyImpact:
      'Unknown parameters are never removed, so single-use tokens and share links keep working.',
  },
  {
    key: 'privacy.fingerprintProtection',
    type: 'enum',
    default: 'standard',
    values: ['off', 'standard'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description:
      'Randomise or normalise selected fingerprintable surfaces using Chromium-supported techniques. Aurelia never adds *new* entropy.',
    privacyImpact:
      'Aurelia deliberately avoids randomising values that would make each user more identifiable (no per-site canvas noise seeds, no fake User-Agent strings).',
  },
  {
    key: 'privacy.webrtcPolicy',
    type: 'enum',
    default: 'public-interfaces-only',
    values: ['default', 'public-interfaces-only', 'disable-non-proxied-udp'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'WebRTC IP-handling policy.',
    privacyImpact:
      'Restricting WebRTC to public interfaces prevents local IP disclosure to sites that do not need it, at the cost of some LAN peer-to-peer use cases.',
  },
  {
    key: 'privacy.clearDataOnExit',
    type: 'boolean',
    default: false,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'Clear selected browsing data when Aurelia closes.',
  },

  // --------------------------------------------------------------------- DNS
  {
    key: 'dns.secureMode',
    type: 'enum',
    default: 'secure',
    values: ['off', 'automatic', 'secure'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Secure DNS (DNS-over-HTTPS) mode.',
    privacyImpact:
      '`secure` fails closed: if the encrypted resolver is unreachable, name resolution fails instead of falling back to plaintext DNS.',
  },
  {
    key: 'dns.providerId',
    type: 'string',
    default: 'aurelia-default',
    maxLength: 64,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Selected secure DNS provider.',
  },
  {
    key: 'dns.customTemplate',
    type: 'string',
    default: '',
    maxLength: 2048,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'Custom DoH URI template. Must be HTTPS and must not contain credentials.',
  },
  {
    key: 'dns.encryptedRedundancy',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description:
      'In `secure` mode, try additional encrypted resolvers if the primary fails.',
    privacyImpact:
      'Redundancy uses other DoH providers. It never introduces plaintext DNS fallback.',
  },
  {
    key: 'dns.allowPlaintextFallback',
    type: 'boolean',
    default: false,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description:
      'Permit fallback to unencrypted system DNS when encrypted DNS is unavailable. Ignored in `secure` mode.',
    privacyImpact:
      'Enabling this can expose DNS queries to your network operator. Aurelia keeps it off by default.',
  },

  // ----------------------------------------------------------- ad / tracking
  {
    key: 'shields.enabled',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Enable ad and tracker blocking.',
  },
  {
    key: 'shields.filterLists',
    type: 'string',
    default: '["easylist","easyprivacy","aurelia-annoyances"]',
    maxLength: 8192,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description: 'JSON array of enabled filter list identifiers.',
  },
  {
    key: 'shields.cosmeticFiltering',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Enable cosmetic (element hiding) filtering.',
  },
  {
    key: 'shields.blockedCountBadge',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Show the blocked-request count on the toolbar shield.',
  },

  // ---------------------------------------------------------------- sync
  {
    key: 'sync.enabled',
    type: 'boolean',
    default: false,
    scope: 'local',
    sync: 'none',
    sensitivity: 'private',
    description:
      'Enable optional cloud sync. Aurelia works fully without an account.',
  },
  {
    key: 'sync.providerId',
    type: 'enum',
    default: 'none',
    values: ['none', 'supabase', 'self-hosted'],
    scope: 'local',
    sync: 'none',
    sensitivity: 'private',
    description: 'Sync backend provider.',
  },
  {
    key: 'sync.e2eeEnabled',
    type: 'boolean',
    default: true,
    scope: 'local',
    sync: 'none',
    sensitivity: 'private',
    description:
      'End-to-end encrypt synced payloads. Sync refuses to run without E2EE for sensitive data.',
  },

  // ---------------------------------------------------------------- translation
  {
    key: 'translation.mode',
    type: 'enum',
    default: 'off',
    values: ['off', 'on-demand', 'auto'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'Translation behaviour. `off` disables remote translation entirely; `on-demand` requires an explicit action per page.',
    privacyImpact:
      'When enabled, the text you choose to translate is sent to the configured translation provider.',
  },
  {
    key: 'translation.providerId',
    type: 'enum',
    default: 'none',
    values: ['none', 'siliconflow'],
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'Translation provider. Requires a provider credential unless `none`.',
  },

  // ------------------------------------------------------------------------ ui
  {
    key: 'ui.commandPaletteEnabled',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Enable the Ctrl+K / Cmd+K command palette.',
  },
  {
    key: 'ui.newTabWallpaper',
    type: 'string',
    default: 'builtin:aurora',
    maxLength: 512,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'private',
    description:
      'New tab wallpaper: `builtin:<name>`, `gradient:<preset>`, `solid:<#rrggbb>`, or `file:<path>`.',
  },
  {
    key: 'ui.newTabShowClock',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Show the clock on the new tab page.',
  },

  // --------------------------------------------------------------- developer
  {
    key: 'developer.devtoolsEnabled',
    type: 'boolean',
    default: true,
    scope: 'profile',
    sync: 'e2ee',
    sensitivity: 'public',
    description: 'Allow opening DevTools.',
  },

  // ---------------------------------------------------------------- enterprise
  {
    key: 'enterprise.managed',
    type: 'boolean',
    default: false,
    scope: 'managed',
    sync: 'none',
    sensitivity: 'public',
    description:
      'Set by enterprise policy. When true the browser shows "managed by your organization".',
  },
];

const PREFS_BY_KEY: ReadonlyMap<string, PrefDefinition> = new Map(
  PREFS.map((pref) => [pref.key, pref]),
);

export const PREF_KEYS: readonly string[] = PREFS.map((pref) => pref.key);

/** Look up a preference definition. */
export function getPrefDefinition(key: string): PrefDefinition | undefined {
  return PREFS_BY_KEY.get(key);
}

/** Build a snapshot of all default values. */
export function defaultPrefs(): Record<string, PrefValue> {
  const snapshot: Record<string, PrefValue> = {};
  for (const pref of PREFS) {
    snapshot[pref.key] = pref.default;
  }
  return snapshot;
}

export interface PrefValidationProblem {
  key: string;
  value: PrefValue;
  reason: string;
}

/**
 * Validate a single value against its definition.
 * Returns `null` when valid, otherwise a machine-readable reason.
 */
export function validatePrefValue(
  definition: PrefDefinition,
  value: PrefValue,
): string | null {
  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected-boolean';
    case 'string':
      if (typeof value !== 'string') return 'expected-string';
      if (value.length > definition.maxLength) return 'string-too-long';
      return null;
    case 'number':
      if (typeof value !== 'number') return 'expected-number';
      if (!Number.isFinite(value)) return 'expected-finite-number';
      if (value < definition.min) return 'number-below-minimum';
      if (value > definition.max) return 'number-above-maximum';
      return null;
    case 'enum':
      if (typeof value !== 'string') return 'expected-string';
      return definition.values.includes(value) ? null : 'value-not-in-enum';
  }
}
