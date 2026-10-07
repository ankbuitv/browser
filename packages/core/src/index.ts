/**
 * @aurelia/core - Aurelia-owned browser logic that is independent of the
 * Chromium checkout.
 *
 * Everything here is pure, unit-tested and free of Chromium/node dependencies
 * so it can be:
 *   - unit tested in fast CI;
 *   - consumed by Chromium's WebUI TypeScript build (the overlay imports the
 *     same rules through generated copies where necessary);
 *   - reused by the development harness.
 *
 * IMPORTANT: this package is NOT a browser runtime. It contains no DOM shell,
 * no browser process and no Node.js dependency. The browser itself is Chromium
 * (C++/Views/WebUI); this code describes policy, not the product.
 */

export {
  BLOCKED_NAVIGATION_SCHEMES,
  KNOWN_SCHEMES,
  OS_HANDLED_SCHEMES,
  SCHEMELESS_SCHEMES,
  AURELIA_SCHEME,
  DEFAULT_INTERNAL_HOSTS,
  buildSearchUrl,
  classifyOmniboxInput,
  extractScheme,
  hasExplicitScheme,
  looksLikeUrl,
  normalizeUrlInput,
  resolveNavigationTarget,
  type ClassifiedInput,
  type ClassifyOptions,
  type InputKind,
} from './url/classify.js';

export {
  AURELIA_DEFAULT_DOH_TEMPLATE,
  DEFAULT_DOH_PROVIDER_ID,
  DEFAULT_SECURE_DNS_SETTINGS,
  DOH_PROVIDERS,
  DohTemplateError,
  SECURE_REDUNDANCY_ORDER,
  formatDohPref,
  getDohProvider,
  resolveSecureDns,
  validateDohTemplate,
  type DohProvider,
  type ResolvedSecureDns,
  type SecureDnsMode,
  type SecureDnsSettings,
} from './net/secure-dns.js';

export {
  DEFAULT_TRACKING_RULES,
  TRACKING_PARAMS_EXACT,
  TRACKING_PARAM_PREFIXES,
  isTrackingParam,
  stripTrackingParams,
  type StripTrackingParamsOptions,
  type StripTrackingParamsResult,
  type TrackingParamRuleSet,
} from './privacy/tracking-params.js';

export {
  PREF_KEYS,
  PREFS,
  SEARCH_TEMPLATE_GOOGLE,
  defaultPrefs,
  getPrefDefinition,
  validatePrefValue,
  type BooleanPrefDefinition,
  type EnumPrefDefinition,
  type NumberPrefDefinition,
  type PrefDefinition,
  type PrefScope,
  type PrefValue,
  type Sensitivity,
  type StringPrefDefinition,
  type SyncClass,
} from './prefs/schema.js';

export {
  PrefStore,
  type PrefChange,
  type PrefChangeListener,
  type PrefStoreOptions,
  type PrefWriteResult,
  type PrefWriteSource,
} from './prefs/store.js';

export {
  HIGH_PRIVACY_DISABLES,
  checkInvariants,
  effectivePrefs,
  type EffectivePrefs,
  type InvariantViolation,
  type PrefOverride,
} from './prefs/derived.js';
