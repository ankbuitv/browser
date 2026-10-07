/**
 * Tracking-parameter stripping.
 *
 * Removes well-known cross-site tracking identifiers from navigations without
 * breaking single-use tokens. The rule set is intentionally conservative:
 * unknown parameters are never removed, because silently deleting parameters
 * breaks logins, payments and share links.
 *
 * This module is pure and is applied by the Aurelia navigation throttle before
 * a URL is handed to Chromium; it never rewrites the address bar text the user
 * typed (the user sees their own input until the navigation commits).
 */

/** Exact parameter names that are known tracking identifiers. */
export const TRACKING_PARAMS_EXACT: readonly string[] = [
  // Google / Ads / Analytics
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  's_kwcid',
  'ef_id',
  '_ga',
  '_gl',
  // Meta
  'fbclid',
  'igshid',
  'igsh',
  // Microsoft
  'msclkid',
  // X / Twitter
  'twclid',
  // TikTok
  'ttclid',
  // LinkedIn
  'li_fat_id',
  'trk_contact',
  'trk_msg',
  'trk_module',
  'trk_sid',
  // Mailchimp / HubSpot / Marketo / Salesforce
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'elqtrackid',
  'elqtrack',
  // Marketing automation
  'yclid',
  '_openstat',
  'vero_id',
  'vero_conv',
  'wickedid',
  'oly_enc_id',
  'oly_anon_id',
  's_cid',
  'spm',
];

/** Parameter name prefixes that are known tracker namespaces. */
export const TRACKING_PARAM_PREFIXES: readonly string[] = [
  'utm_',
  'mtm_',
  'pk_',
  'hsa_',
  'matomo_',
  'piwik_',
];

export interface TrackingParamRuleSet {
  exact: readonly string[];
  prefixes: readonly string[];
}

export const DEFAULT_TRACKING_RULES: TrackingParamRuleSet = {
  exact: TRACKING_PARAMS_EXACT,
  prefixes: TRACKING_PARAM_PREFIXES,
};

/** True when a parameter name should be stripped. Comparison is case-insensitive. */
export function isTrackingParam(
  name: string,
  rules: TrackingParamRuleSet = DEFAULT_TRACKING_RULES,
): boolean {
  const lowered = name.toLowerCase();
  if (rules.exact.includes(lowered)) return true;
  return rules.prefixes.some((prefix) => lowered.startsWith(prefix));
}

export interface StripTrackingParamsOptions {
  /** Master switch. When false the URL is returned untouched. */
  enabled?: boolean;
  /** Hosts that must never be rewritten (e.g. payment providers). */
  allowlistHosts?: readonly string[];
  /** Parameter names that must be preserved even if they look like trackers. */
  allowlistParams?: readonly string[];
  /** Override the rule set (used by tests and enterprise policy). */
  rules?: TrackingParamRuleSet;
}

export interface StripTrackingParamsResult {
  url: string;
  /** Names of the parameters that were removed, in URL order. */
  removed: string[];
  changed: boolean;
}

const SKIPPED_RESULT = (url: string): StripTrackingParamsResult => ({
  url,
  removed: [],
  changed: false,
});

/**
 * Remove tracking parameters from an absolute http(s) URL.
 *
 * Behaviour:
 *  - non-http(s) URLs, relative URLs and unparseable input are returned as-is;
 *  - the fragment is preserved;
 *  - `?` is dropped when every parameter was removed;
 *  - parameter order is preserved for the parameters that remain.
 */
export function stripTrackingParams(
  url: string,
  options: StripTrackingParamsOptions = {},
): StripTrackingParamsResult {
  const enabled = options.enabled ?? true;
  if (!enabled) return SKIPPED_RESULT(url);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return SKIPPED_RESULT(url);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return SKIPPED_RESULT(url);
  }

  const allowlistHosts = options.allowlistHosts ?? [];
  const host = parsed.hostname.toLowerCase();
  if (
    allowlistHosts.some((allowed) => {
      const candidate = allowed.toLowerCase();
      return host === candidate || host.endsWith(`.${candidate}`);
    })
  ) {
    return SKIPPED_RESULT(url);
  }

  const allowlistParams = new Set(
    (options.allowlistParams ?? []).map((param) => param.toLowerCase()),
  );
  const rules = options.rules ?? DEFAULT_TRACKING_RULES;

  const removed: string[] = [];
  const kept: Array<[string, string]> = [];

  for (const [name, value] of parsed.searchParams) {
    if (
      !allowlistParams.has(name.toLowerCase()) &&
      isTrackingParam(name, rules)
    ) {
      removed.push(name);
      continue;
    }
    kept.push([name, value]);
  }

  if (removed.length === 0) {
    return {
      url,
      removed: [],
      changed: false,
    };
  }

  const search = new URLSearchParams();
  for (const [name, value] of kept) {
    search.append(name, value);
  }
  const searchString = search.toString();
  const rebuilt = `${parsed.origin}${parsed.pathname}${
    searchString.length > 0 ? `?${searchString}` : ''
  }${parsed.hash}`;

  return {
    url: rebuilt,
    removed,
    changed: true,
  };
}
