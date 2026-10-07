/**
 * Omnibox input classification.
 *
 * Aurelia mirrors Chromium's behaviour for user-typed omnibox input but keeps
 * the policy in Aurelia-owned, unit-tested code so that the fork delta inside
 * `components/omnibox/` stays small (see docs/CHROMIUM-UPSTREAM.md).
 *
 * Security rules encoded here (see docs/THREAT-MODEL.md):
 *  - `javascript:` and `vbscript:` are NEVER treated as navigable URLs.
 *  - `data:` URLs are only allowed when the caller explicitly opts in
 *    (paste-and-go), because `data:` URLs are a common phishing vector.
 *  - Unknown schemes are surfaced as `search` rather than being handed to the
 *    network stack.
 */

export type InputKind =
  'empty' | 'url' | 'search' | 'blocked-scheme' | 'internal';

export interface ClassifiedInput {
  kind: InputKind;
  /** Navigation target for `url` and `internal` kinds. */
  target: string | undefined;
  /** Query text for the `search` kind (never URL-encoded here). */
  query: string | undefined;
  /** Rejected scheme for the `blocked-scheme` kind. */
  scheme: string | undefined;
  /** Machine-readable explanation, useful for tests and diagnostics. */
  reason: string | undefined;
}

export interface ClassifyOptions {
  /** Search template containing `{searchTerms}`, e.g. Google's default. */
  searchTemplate: string;
  /** Allow `data:` URLs (paste-and-go). Defaults to false. */
  allowDataUrls?: boolean;
  /** Additional internal URL hosts that may be navigated to. */
  internalHosts?: readonly string[];
}

/** Schemes that must never be treated as a user-navigable URL. */
export const BLOCKED_NAVIGATION_SCHEMES: readonly string[] = [
  'javascript',
  'vbscript',
  'data',
  'blob',
  'filesystem',
];

/** Schemes Chromium (and therefore Aurelia) understands natively. */
export const KNOWN_SCHEMES: readonly string[] = [
  'http',
  'https',
  'file',
  'about',
  'chrome',
  'chrome-extension',
  'chrome-untrusted',
  'view-source',
  'devtools',
  'ftp',
];

/**
 * Handed to the operating system rather than to the network stack. These are
 * navigable, but Aurelia does not claim to understand their payload.
 */
export const OS_HANDLED_SCHEMES: readonly string[] = [
  'mailto',
  'tel',
  'sms',
  'geo',
  'magnet',
];

/** Aurelia's own internal pages, e.g. `aurelia://settings`. */
export const AURELIA_SCHEME = 'aurelia';

/**
 * Schemes that are legitimately written without a `//` authority, e.g.
 * `mailto:someone@example.com`. Anything else must use `scheme://` to be
 * treated as a scheme - otherwise `example.com:8080` (a host and a port)
 * would be misread as a scheme called "example.com".
 */
export const SCHEMELESS_SCHEMES: readonly string[] = [
  'http',
  'https',
  'file',
  'about',
  'mailto',
  'tel',
  'sms',
  'geo',
  'magnet',
  'blob',
  'filesystem',
  'javascript',
  'vbscript',
  'data',
  'view-source',
  'devtools',
  'chrome',
  'chrome-extension',
  'chrome-untrusted',
  AURELIA_SCHEME,
];

export const DEFAULT_INTERNAL_HOSTS: readonly string[] = [
  'newtab',
  'settings',
  'history',
  'bookmarks',
  'downloads',
  'passwords',
  'shields',
  'dns',
  'palette',
  'workspaces',
  'profiles',
  'themes',
  'about',
];

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** IP literals, including IPv6 in brackets and IPv4 with an optional port. */
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/;
const IPV6_RE = /^\[[0-9a-fA-F:]+\](?::\d{1,5})?(?:[/?#].*)?$/;
const LOCALHOST_RE = /^localhost(?::\d{1,5})?(?:[/?#].*)?$/;
/**
 * Host-like input: a label, a dot, a TLD-ish label, optional port/path.
 * Deliberately conservative; anything that looks like prose is a search.
 */
const HOSTLIKE_RE =
  /^(?!-)[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})+(?::\d{1,5})?(?:[/?#]\S*)?$/;

const HAS_INTERNAL_WHITESPACE_RE = /\s/;

/**
 * Extract a scheme from raw input, lower-cased, or `null` when the input does
 * not unambiguously start with a scheme.
 *
 * A scheme is only recognised when it is followed by `//` (authority form) or
 * when it is one of {@link SCHEMELESS_SCHEMES}. This is what keeps
 * `example.com:8080` and `localhost:3000` treated as hosts rather than as
 * schemes named after the host.
 */
export function extractScheme(input: string): string | null {
  const trimmed = input.trim();
  const match = SCHEME_RE.exec(trimmed);
  if (!match) return null;
  const scheme = match[1];
  if (scheme === undefined) return null;
  // A single letter followed by ':' is ambiguous: "c:" is a Windows drive
  // letter, not a scheme. Chromium treats it as a file path.
  if (/^[a-zA-Z]$/.test(scheme)) return null;
  const lowered = scheme.toLowerCase();
  const rest = trimmed.slice(match[0].length);
  if (rest.startsWith('//')) return lowered;
  if (SCHEMELESS_SCHEMES.includes(lowered)) return lowered;
  return null;
}

/** True when the input has an explicit scheme prefix such as `https:`. */
export function hasExplicitScheme(input: string): boolean {
  return extractScheme(input) !== null;
}

/** True when the input looks like something the network stack could fetch. */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  if (HAS_INTERNAL_WHITESPACE_RE.test(trimmed)) return false;
  if (hasExplicitScheme(trimmed)) return true;
  if (LOCALHOST_RE.test(trimmed)) return true;
  if (IPV4_RE.test(trimmed)) return true;
  if (IPV6_RE.test(trimmed)) return true;
  if (HOSTLIKE_RE.test(trimmed)) {
    // Require a dot-separated final label that is not all digits, so that
    // "3.14159" or a decimal number is still a search query.
    const hostPart = trimmed.split(/[/?#]/)[0] ?? '';
    const labels = hostPart.split('.');
    const last = labels[labels.length - 1] ?? '';
    return /[a-zA-Z]/.test(last);
  }
  return false;
}

/**
 * Build a search URL from a template containing `{searchTerms}`.
 * Throws when the template is missing the placeholder: silently mis-built
 * search URLs are a common source of "search did nothing" bugs.
 */
export function buildSearchUrl(template: string, query: string): string {
  if (!template.includes('{searchTerms}')) {
    throw new Error('search template must contain {searchTerms}');
  }
  return template.replaceAll('{searchTerms}', encodeURIComponent(query));
}

/** Normalise user input into a navigable URL string. */
export function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  const scheme = extractScheme(trimmed);
  if (scheme !== null && !BLOCKED_NAVIGATION_SCHEMES.includes(scheme)) {
    return trimmed;
  }
  if (
    LOCALHOST_RE.test(trimmed) ||
    IPV4_RE.test(trimmed) ||
    IPV6_RE.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

/**
 * Classify raw omnibox input into one of five kinds.
 *
 * This function is pure: it performs no network access and no navigation.
 */
export function classifyOmniboxInput(
  input: string,
  options: ClassifyOptions,
): ClassifiedInput {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      kind: 'empty',
      target: undefined,
      query: undefined,
      scheme: undefined,
      reason: 'empty-input',
    };
  }

  const scheme = extractScheme(trimmed);

  if (scheme === AURELIA_SCHEME) {
    const host = trimmed.slice(`${AURELIA_SCHEME}:`.length).replace(/^\/+/, '');
    const hostName = host.split(/[/?#]/)[0]?.toLowerCase() ?? '';
    const allowed = options.internalHosts ?? DEFAULT_INTERNAL_HOSTS;
    if (allowed.includes(hostName)) {
      return {
        kind: 'internal',
        target: `${AURELIA_SCHEME}://${host}`,
        query: undefined,
        scheme: AURELIA_SCHEME,
        reason: 'internal-page',
      };
    }
    return {
      kind: 'blocked-scheme',
      target: undefined,
      query: undefined,
      scheme: AURELIA_SCHEME,
      reason: 'unknown-internal-page',
    };
  }

  if (scheme !== null) {
    if (scheme === 'data' && options.allowDataUrls === true) {
      return {
        kind: 'url',
        target: trimmed,
        query: undefined,
        scheme,
        reason: 'explicit-data-url',
      };
    }
    if (BLOCKED_NAVIGATION_SCHEMES.includes(scheme)) {
      return {
        kind: 'blocked-scheme',
        target: undefined,
        query: undefined,
        scheme,
        reason: 'blocked-scheme',
      };
    }
    if (KNOWN_SCHEMES.includes(scheme) || OS_HANDLED_SCHEMES.includes(scheme)) {
      return {
        kind: 'url',
        target: normalizeUrlInput(trimmed),
        query: undefined,
        scheme,
        reason: KNOWN_SCHEMES.includes(scheme)
          ? 'known-scheme'
          : 'handed-to-operating-system',
      };
    }
    // Unknown scheme: treat as a search query rather than handing an
    // arbitrary scheme to the network stack.
    return {
      kind: 'search',
      target: undefined,
      query: trimmed,
      scheme,
      reason: 'unknown-scheme-searched',
    };
  }

  if (looksLikeUrl(trimmed)) {
    return {
      kind: 'url',
      target: normalizeUrlInput(trimmed),
      query: undefined,
      scheme: undefined,
      reason: 'host-like',
    };
  }

  return {
    kind: 'search',
    target: undefined,
    query: trimmed,
    scheme: undefined,
    reason: 'search-query',
  };
}

/** Convenience: resolve a classified input to its final navigation target. */
export function resolveNavigationTarget(
  classified: ClassifiedInput,
  searchTemplate: string,
): string | null {
  switch (classified.kind) {
    case 'url':
    case 'internal':
      return classified.target ?? null;
    case 'search':
      return classified.query === undefined
        ? null
        : buildSearchUrl(searchTemplate, classified.query);
    case 'empty':
    case 'blocked-scheme':
      return null;
  }
}
