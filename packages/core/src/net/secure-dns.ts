/**
 * Secure DNS (DNS-over-HTTPS) policy for Aurelia.
 *
 * Design goals, in priority order (see docs/DNS-POLICY.md):
 *  1. Never leak DNS queries in plaintext to the local network because of a
 *     naive fallback. A secure configuration must be *fail-closed* by default.
 *  2. Never silently downgrade from an encrypted resolver to plaintext DNS.
 *  3. Be transparent: every configuration returns a human-readable
 *     explanation and, where relevant, an explicit warning.
 *
 * The semantics here mirror Chromium's own model:
 *  - `off`       - no DoH. System/plaintext DNS is used.
 *  - `automatic` - DoH is attempted with the configured provider; Chromium is
 *                  allowed to fall back to the system resolver if DoH fails.
 *                  This can send queries in plaintext: shown as a warning.
 *  - `secure`    - DoH only. If the provider cannot be reached, resolution
 *                  FAILS rather than falling back to plaintext. When the user
 *                  opts into encrypted redundancy, additional DoH providers
 *                  are appended (all still encrypted) instead of plaintext.
 */

export type SecureDnsMode = 'off' | 'automatic' | 'secure';

export interface DohProvider {
  /** Stable identifier used in preferences. */
  id: string;
  /** Display name. */
  name: string;
  /** DoH URI template, without `{?dns}` unless the server requires it. */
  template: string;
  /** Provider documentation, shown in settings. */
  homepage: string;
  /** Privacy policy URL, shown in settings. */
  privacyPolicy: string;
  /** Whether Aurelia ships this entry as a default (vs. a preset). */
  isDefault?: boolean;
}

/**
 * Product-default resolvers. These are public endpoint identifiers, not
 * secrets. No API key or account is required by the browser to use them.
 *
 * NOTE for maintainers: the NextDNS endpoint below is a *profile* endpoint
 * ("cf9c1d"), i.e. it identifies a NextDNS configuration owned by the
 * project. It grants no administrative access and requires no credential.
 * See PRIVACY.md (data-flow matrix) before changing it.
 */
export const AURELIA_DEFAULT_DOH_TEMPLATE = 'https://dns.nextdns.io/cf9c1d';

export const DOH_PROVIDERS: readonly DohProvider[] = [
  {
    id: 'aurelia-default',
    name: 'Aurelia default (NextDNS)',
    template: AURELIA_DEFAULT_DOH_TEMPLATE,
    homepage: 'https://nextdns.io/',
    privacyPolicy: 'https://nextdns.io/privacy',
    isDefault: true,
  },
  {
    id: 'quad9',
    name: 'Quad9',
    template: 'https://dns.quad9.net/dns-query',
    homepage: 'https://www.quad9.net/',
    privacyPolicy: 'https://www.quad9.net/privacy/',
  },
  {
    id: 'google',
    name: 'Google Public DNS',
    template: 'https://dns.google/dns-query',
    homepage: 'https://developers.google.com/speed/public-dns',
    privacyPolicy: 'https://developers.google.com/speed/public-dns/privacy',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare (1.1.1.1)',
    template: 'https://cloudflare-dns.com/dns-query',
    homepage: 'https://developers.cloudflare.com/1.1.1.1/',
    privacyPolicy: 'https://www.cloudflare.com/privacypolicy/',
  },
  {
    id: 'custom',
    name: 'Custom DoH URL',
    template: '',
    homepage: '',
    privacyPolicy: '',
  },
];

export const DEFAULT_DOH_PROVIDER_ID = 'aurelia-default';

/** Order used when the user enables encrypted redundancy in `secure` mode. */
export const SECURE_REDUNDANCY_ORDER: readonly string[] = [
  'aurelia-default',
  'quad9',
  'google',
  'cloudflare',
];

export interface SecureDnsSettings {
  mode: SecureDnsMode;
  /** Provider id from {@link DOH_PROVIDERS}. */
  providerId: string;
  /** Required when `providerId === 'custom'`. */
  customTemplate?: string | undefined;
  /**
   * When true in `secure` mode, additional *encrypted* resolvers are used if
   * the primary fails. Plaintext fallback is never enabled by this flag.
   */
  encryptedRedundancy: boolean;
  /**
   * Explicit opt-in for plaintext fallback in `automatic` mode. Default false.
   * Never has any effect in `secure` mode.
   */
  allowPlaintextFallback: boolean;
}

export const DEFAULT_SECURE_DNS_SETTINGS: SecureDnsSettings = {
  mode: 'secure',
  providerId: DEFAULT_DOH_PROVIDER_ID,
  customTemplate: undefined,
  encryptedRedundancy: true,
  allowPlaintextFallback: false,
};

export interface ResolvedSecureDns {
  mode: SecureDnsMode;
  /** DoH templates in preference order. Empty when mode is `off`. */
  servers: string[];
  /**
   * True when a failure of the encrypted path may result in plaintext DNS.
   * Aurelia surfaces this in the UI and defaults it to `false`.
   */
  plaintextFallbackPossible: boolean;
  /** Short, user-facing description of the resulting behaviour. */
  explanation: string;
  /** Non-fatal problems the UI must surface. */
  warnings: string[];
  /** Fatal configuration errors; navigation must not proceed while present. */
  errors: string[];
}

export class DohTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DohTemplateError';
  }
}

/**
 * Validate a DoH URI template.
 *
 * Rejected on purpose:
 *  - non-HTTPS templates (`http:`) - would defeat the point of DoH;
 *  - credentials in the URL (`user:pass@host`) - would leak a secret into
 *    preferences, sync and logs;
 *  - templates containing whitespace or control characters.
 */
export function validateDohTemplate(template: string): string[] {
  const problems: string[] = [];
  const trimmed = template.trim();
  if (trimmed.length === 0) {
    problems.push('template-empty');
    return problems;
  }
  if (/\s/.test(trimmed)) {
    problems.push('template-contains-whitespace');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    problems.push('template-contains-control-characters');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    problems.push('template-not-a-url');
    return problems;
  }
  if (url.protocol !== 'https:') {
    problems.push('template-must-use-https');
  }
  if (url.username !== '' || url.password !== '') {
    problems.push('template-must-not-contain-credentials');
  }
  if (url.hostname.length === 0) {
    problems.push('template-missing-host');
  }
  return problems;
}

/** Look up a provider by id. */
export function getDohProvider(id: string): DohProvider | undefined {
  return DOH_PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Resolve preferences into the concrete DoH configuration handed to
 * Chromium's `SecureDnsConfig` (see docs/CHROMIUM-UPSTREAM.md for the
 * upstream integration points).
 */
export function resolveSecureDns(
  settings: SecureDnsSettings,
): ResolvedSecureDns {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (settings.mode === 'off') {
    return {
      mode: 'off',
      servers: [],
      plaintextFallbackPossible: true,
      explanation:
        'Secure DNS is disabled. DNS queries use the operating system resolver and may be visible to your network.',
      warnings: ['secure-dns-disabled'],
      errors,
    };
  }

  const provider = getDohProvider(settings.providerId);
  if (provider === undefined) {
    errors.push('unknown-doh-provider');
    return {
      mode: settings.mode,
      servers: [],
      plaintextFallbackPossible: false,
      explanation: 'The configured secure DNS provider is unknown.',
      warnings,
      errors,
    };
  }

  let primary = provider.template;
  if (provider.id === 'custom') {
    primary = (settings.customTemplate ?? '').trim();
    const problems = validateDohTemplate(primary);
    if (problems.length > 0) {
      errors.push(...problems.map((problem) => `custom-template:${problem}`));
      return {
        mode: settings.mode,
        servers: [],
        plaintextFallbackPossible: false,
        explanation: 'The custom secure DNS URL is not valid.',
        warnings,
        errors,
      };
    }
  }

  const servers: string[] = [primary];

  if (settings.mode === 'secure') {
    if (settings.encryptedRedundancy) {
      for (const candidateId of SECURE_REDUNDANCY_ORDER) {
        const candidate = getDohProvider(candidateId);
        if (candidate === undefined) continue;
        if (candidate.template === '') continue;
        if (candidate.template === primary) continue;
        if (servers.includes(candidate.template)) continue;
        servers.push(candidate.template);
      }
    }
    return {
      mode: 'secure',
      servers,
      // In `secure` mode Chromium does not fall back to plaintext: resolution
      // fails instead. Adding more servers only adds encrypted options.
      plaintextFallbackPossible: false,
      explanation: settings.encryptedRedundancy
        ? 'DNS queries are sent over HTTPS only. If the first resolver is unreachable, other encrypted resolvers are tried. Queries fail rather than falling back to unencrypted DNS.'
        : 'DNS queries are sent over HTTPS only. If the resolver is unreachable, resolution fails rather than falling back to unencrypted DNS.',
      warnings,
      errors,
    };
  }

  // mode === 'automatic'
  if (settings.allowPlaintextFallback) {
    warnings.push('plaintext-fallback-enabled');
  } else {
    warnings.push('automatic-mode-may-fall-back-to-system-resolver');
  }

  return {
    mode: 'automatic',
    servers,
    plaintextFallbackPossible: true,
    explanation: settings.allowPlaintextFallback
      ? 'Encrypted DNS is attempted first. If it fails, queries fall back to unencrypted system DNS. The browser cannot guarantee queries stay encrypted.'
      : 'Encrypted DNS is attempted first. Chromium may use the system resolver if the encrypted path is unavailable, which can expose queries to your network.',
    warnings,
    errors,
  };
}

/**
 * Serialise DoH templates into Chromium's preference format: a
 * whitespace-separated list of URI templates (see
 * `net/dns/public/dns_over_https_config.h`).
 */
export function formatDohPref(servers: readonly string[]): string {
  return servers
    .map((server) => server.trim())
    .filter((server) => server.length > 0)
    .join(' ');
}
