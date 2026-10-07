import { describe, expect, it } from 'vitest';

import {
  AURELIA_DEFAULT_DOH_TEMPLATE,
  DEFAULT_SECURE_DNS_SETTINGS,
  DOH_PROVIDERS,
  formatDohPref,
  getDohProvider,
  resolveSecureDns,
  validateDohTemplate,
  type SecureDnsSettings,
} from './secure-dns.js';

const base: SecureDnsSettings = { ...DEFAULT_SECURE_DNS_SETTINGS };

describe('provider catalogue', () => {
  it('ships the documented default endpoint', () => {
    expect(AURELIA_DEFAULT_DOH_TEMPLATE).toBe('https://dns.nextdns.io/cf9c1d');
  });

  it('contains no duplicate provider ids or templates', () => {
    const ids = DOH_PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
    const templates = DOH_PROVIDERS.map((provider) => provider.template).filter(
      (template) => template !== '',
    );
    expect(new Set(templates).size).toBe(templates.length);
  });

  it('defaults to the Aurelia provider', () => {
    expect(DEFAULT_SECURE_DNS_SETTINGS.providerId).toBe('aurelia-default');
    expect(DEFAULT_SECURE_DNS_SETTINGS.mode).toBe('secure');
  });
});

describe('validateDohTemplate', () => {
  it('accepts a plain https template', () => {
    expect(validateDohTemplate('https://dns.quad9.net/dns-query')).toEqual([]);
  });

  it.each([
    ['http://dns.example.com/dns-query', 'template-must-use-https'],
    [
      'https://user:pass@dns.example.com/dns-query',
      'template-must-not-contain-credentials',
    ],
    ['not a url', 'template-contains-whitespace'],
    ['', 'template-empty'],
  ])('rejects %j', (template, expected) => {
    expect(validateDohTemplate(template)).toContain(expected);
  });
});

describe('resolveSecureDns', () => {
  it('secure mode fails closed and never allows plaintext', () => {
    const resolved = resolveSecureDns(base);
    expect(resolved.mode).toBe('secure');
    expect(resolved.plaintextFallbackPossible).toBe(false);
    expect(resolved.errors).toEqual([]);
    expect(resolved.servers[0]).toBe(AURELIA_DEFAULT_DOH_TEMPLATE);
  });

  it('secure mode with redundancy adds only encrypted resolvers', () => {
    const resolved = resolveSecureDns(base);
    expect(resolved.servers.length).toBeGreaterThan(1);
    for (const server of resolved.servers) {
      expect(server.startsWith('https://')).toBe(true);
    }
  });

  it('secure mode without redundancy keeps a single resolver', () => {
    const resolved = resolveSecureDns({ ...base, encryptedRedundancy: false });
    expect(resolved.servers).toHaveLength(1);
  });

  it('off mode reports that plaintext DNS is in use', () => {
    const resolved = resolveSecureDns({ ...base, mode: 'off' });
    expect(resolved.servers).toEqual([]);
    expect(resolved.warnings).toContain('secure-dns-disabled');
    expect(resolved.explanation).toMatch(/operating system resolver/i);
  });

  it('automatic mode warns that queries may fall back to plaintext', () => {
    const resolved = resolveSecureDns({ ...base, mode: 'automatic' });
    expect(resolved.plaintextFallbackPossible).toBe(true);
    expect(resolved.warnings).toContain(
      'automatic-mode-may-fall-back-to-system-resolver',
    );
  });

  it('refuses an invalid custom template', () => {
    const resolved = resolveSecureDns({
      ...base,
      providerId: 'custom',
      customTemplate: 'http://insecure.example/dns-query',
    });
    expect(resolved.errors).toContain(
      'custom-template:template-must-use-https',
    );
    expect(resolved.servers).toEqual([]);
  });

  it('accepts a valid custom template and still fails closed', () => {
    const resolved = resolveSecureDns({
      ...base,
      providerId: 'custom',
      customTemplate: 'https://doh.example.com/dns-query',
    });
    expect(resolved.errors).toEqual([]);
    expect(resolved.servers[0]).toBe('https://doh.example.com/dns-query');
    expect(resolved.plaintextFallbackPossible).toBe(false);
  });

  it('reports an unknown provider instead of guessing', () => {
    const resolved = resolveSecureDns({ ...base, providerId: 'mystery' });
    expect(resolved.errors).toContain('unknown-doh-provider');
  });

  it('never duplicates a server in the redundancy list', () => {
    const resolved = resolveSecureDns({
      ...base,
      providerId: 'quad9',
    });
    const servers = resolved.servers;
    expect(new Set(servers).size).toBe(servers.length);
    expect(servers).toContain('https://dns.quad9.net/dns-query');
  });
});

describe('formatDohPref', () => {
  it('produces the whitespace-separated form Chromium expects', () => {
    expect(
      formatDohPref([
        'https://a.example/dns-query',
        ' https://b.example/dns-query ',
      ]),
    ).toBe('https://a.example/dns-query https://b.example/dns-query');
    expect(formatDohPref([])).toBe('');
  });
});

describe('getDohProvider', () => {
  it('finds providers and returns undefined otherwise', () => {
    expect(getDohProvider('quad9')?.name).toBe('Quad9');
    expect(getDohProvider('nope')).toBeUndefined();
  });
});
