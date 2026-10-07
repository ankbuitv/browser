import { describe, expect, it } from 'vitest';

import {
  AURELIA_SCHEME,
  buildSearchUrl,
  classifyOmniboxInput,
  extractScheme,
  looksLikeUrl,
  normalizeUrlInput,
  resolveNavigationTarget,
} from './classify.js';

const GOOGLE = 'https://www.google.com/search?q={searchTerms}';

describe('extractScheme', () => {
  it('extracts and lower-cases a scheme', () => {
    expect(extractScheme('HTTPS://example.com')).toBe('https');
  });

  it('does not treat a Windows drive letter as a scheme', () => {
    expect(extractScheme('c:/users/me/file.txt')).toBeNull();
  });

  it('returns null for input without a scheme', () => {
    expect(extractScheme('example.com')).toBeNull();
  });
});

describe('looksLikeUrl', () => {
  it.each([
    ['example.com', true],
    ['sub.example.co.uk/path?q=1', true],
    ['localhost:8080', true],
    ['127.0.0.1:3000/x', true],
    ['http://example.com', true],
    ['[::1]:8443', true],
    ['how do i bake bread', false],
    ['3.14159', false],
    ['two words.example.com extra', false],
    ['', false],
  ])('classifies %j as url=%s', (input, expected) => {
    expect(looksLikeUrl(input)).toBe(expected);
  });
});

describe('classifyOmniboxInput', () => {
  it('treats empty input as empty', () => {
    expect(classifyOmniboxInput('   ', { searchTemplate: GOOGLE }).kind).toBe(
      'empty',
    );
  });

  it('navigates bare hosts over https', () => {
    const result = classifyOmniboxInput('example.com/path', {
      searchTemplate: GOOGLE,
    });
    expect(result.kind).toBe('url');
    expect(result.target).toBe('https://example.com/path');
  });

  it('keeps an explicit scheme', () => {
    const result = classifyOmniboxInput('http://example.com', {
      searchTemplate: GOOGLE,
    });
    expect(result.target).toBe('http://example.com');
  });

  it('treats host:port input as a host, not as a scheme', () => {
    const withPort = classifyOmniboxInput('example.com:8080/admin', {
      searchTemplate: GOOGLE,
    });
    expect(withPort.kind).toBe('url');
    expect(withPort.target).toBe('https://example.com:8080/admin');

    const loopback = classifyOmniboxInput('localhost:3000', {
      searchTemplate: GOOGLE,
    });
    expect(loopback.kind).toBe('url');
    expect(loopback.target).toBe('http://localhost:3000');
  });

  it('still understands schemeless schemes such as mailto:', () => {
    const result = classifyOmniboxInput('mailto:dev@example.com', {
      searchTemplate: GOOGLE,
    });
    expect(result.kind).toBe('url');
    expect(result.scheme).toBe('mailto');
  });

  it('sends prose to search', () => {
    const result = classifyOmniboxInput('best pizza in bien hoa', {
      searchTemplate: GOOGLE,
    });
    expect(result.kind).toBe('search');
    expect(result.query).toBe('best pizza in bien hoa');
  });

  // Security-relevant cases: these must never become navigations.
  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<b>x'])(
    'refuses to navigate to %s',
    (input) => {
      const result = classifyOmniboxInput(input, { searchTemplate: GOOGLE });
      expect(result.kind).toBe('blocked-scheme');
      expect(result.target).toBeUndefined();
      expect(result.scheme).toBe(input.split(':')[0]);
    },
  );

  it('allows a data: URL only when explicitly enabled', () => {
    const input = 'data:text/plain,hello';
    expect(classifyOmniboxInput(input, { searchTemplate: GOOGLE }).kind).toBe(
      'blocked-scheme',
    );
    expect(
      classifyOmniboxInput(input, {
        searchTemplate: GOOGLE,
        allowDataUrls: true,
      }).kind,
    ).toBe('url');
  });

  it('searches an unknown scheme form instead of handing it to the network stack', () => {
    // "scheme://" form with a scheme nobody registered: searched, not fetched.
    const withAuthority = classifyOmniboxInput('weirdscheme://payload', {
      searchTemplate: GOOGLE,
    });
    expect(withAuthority.kind).toBe('search');
    expect(withAuthority.reason).toBe('unknown-scheme-searched');

    // "scheme:payload" form that is not a known schemeless scheme is also a
    // search query, because it could equally be a mistyped host:port.
    const opaque = classifyOmniboxInput('spotify:track:123', {
      searchTemplate: GOOGLE,
    });
    expect(opaque.kind).toBe('search');
    expect(opaque.reason).toBe('search-query');
  });

  it('accepts known internal pages', () => {
    const result = classifyOmniboxInput('aurelia://settings', {
      searchTemplate: GOOGLE,
    });
    expect(result.kind).toBe('internal');
    expect(result.target).toBe('aurelia://settings');
  });

  it('rejects unknown internal pages', () => {
    const result = classifyOmniboxInput('aurelia://definitely-not-a-page', {
      searchTemplate: GOOGLE,
    });
    expect(result.kind).toBe('blocked-scheme');
    expect(result.reason).toBe('unknown-internal-page');
  });
});

describe('buildSearchUrl', () => {
  it('encodes the query', () => {
    expect(buildSearchUrl(GOOGLE, 'a b&c')).toBe(
      'https://www.google.com/search?q=a%20b%26c',
    );
  });

  it('throws when the template lacks {searchTerms}', () => {
    expect(() => buildSearchUrl('https://example.com/', 'x')).toThrow(
      /searchTerms/,
    );
  });
});

describe('resolveNavigationTarget', () => {
  it('resolves searches and urls, and refuses blocked input', () => {
    expect(
      resolveNavigationTarget(
        classifyOmniboxInput('example.com', { searchTemplate: GOOGLE }),
        GOOGLE,
      ),
    ).toBe('https://example.com');
    expect(
      resolveNavigationTarget(
        classifyOmniboxInput('hello', { searchTemplate: GOOGLE }),
        GOOGLE,
      ),
    ).toBe('https://www.google.com/search?q=hello');
    expect(
      resolveNavigationTarget(
        classifyOmniboxInput('javascript:alert(1)', { searchTemplate: GOOGLE }),
        GOOGLE,
      ),
    ).toBeNull();
    expect(
      resolveNavigationTarget(
        classifyOmniboxInput('', { searchTemplate: GOOGLE }),
        GOOGLE,
      ),
    ).toBeNull();
  });
});

describe('normalizeUrlInput', () => {
  it('uses http for loopback and IP literals, https otherwise', () => {
    expect(normalizeUrlInput('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeUrlInput('192.168.0.1/admin')).toBe(
      'http://192.168.0.1/admin',
    );
    expect(normalizeUrlInput('example.org')).toBe('https://example.org');
  });
});

describe('internal scheme constant', () => {
  it('is the documented internal scheme', () => {
    expect(AURELIA_SCHEME).toBe('aurelia');
  });
});
