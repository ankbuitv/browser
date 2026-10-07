import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRACKING_RULES,
  isTrackingParam,
  stripTrackingParams,
} from './tracking-params.js';

describe('isTrackingParam', () => {
  it.each([
    ['utm_source', true],
    ['UTM_Campaign', true],
    ['fbclid', true],
    ['gclid', true],
    ['mc_eid', true],
    ['msclkid', true],
    ['mtm_campaign', true],
  ])('%s -> %s', (name, expected) => {
    expect(isTrackingParam(name)).toBe(expected);
  });

  it.each([
    ['q', false],
    ['page', false],
    ['token', false],
    ['id', false],
    ['product', false],
  ])('%s -> %s', (name, expected) => {
    expect(isTrackingParam(name)).toBe(expected);
  });
});

describe('stripTrackingParams', () => {
  it('removes known tracking parameters and keeps the rest', () => {
    const result = stripTrackingParams(
      'https://shop.example/product?id=42&utm_source=news&utm_medium=email&color=red',
    );
    expect(result.changed).toBe(true);
    expect(result.url).toBe('https://shop.example/product?id=42&color=red');
    expect(result.removed.sort()).toEqual(['utm_medium', 'utm_source']);
  });

  it('preserves the fragment', () => {
    const result = stripTrackingParams(
      'https://example.com/page?fbclid=abc#section',
    );
    expect(result.url).toBe('https://example.com/page#section');
  });

  it('drops the ? when everything was removed', () => {
    const result = stripTrackingParams('https://example.com/?gclid=1');
    expect(result.url).toBe('https://example.com/');
  });

  it('keeps duplicate non-tracking parameters', () => {
    const result = stripTrackingParams(
      'https://example.com/?tag=a&tag=b&utm_source=x',
    );
    expect(result.url).toBe('https://example.com/?tag=a&tag=b');
  });

  it('never rewrites non-http(s) URLs or relative input', () => {
    for (const input of [
      'mailto:someone@example.com?subject=utm_source',
      'file:///etc/hosts',
      'aurelia://settings',
      '/relative/path',
      'not a url',
    ]) {
      const result = stripTrackingParams(input);
      expect(result.changed).toBe(false);
      expect(result.url).toBe(input);
    }
  });

  it('honours the master switch', () => {
    const result = stripTrackingParams('https://example.com/?utm_source=x', {
      enabled: false,
    });
    expect(result.changed).toBe(false);
  });

  it('does not touch allowlisted hosts (payment flows)', () => {
    const result = stripTrackingParams(
      'https://checkout.example.com/pay?utm_source=bank',
      { allowlistHosts: ['example.com'] },
    );
    expect(result.changed).toBe(false);
  });

  it('allows an operator to protect specific parameter names', () => {
    const result = stripTrackingParams(
      'https://example.com/?utm_source=x&token=keepme',
      { allowlistParams: ['token'] },
    );
    expect(result.url).toBe('https://example.com/?token=keepme');
  });

  it('accepts a custom rule set', () => {
    const result = stripTrackingParams(
      'https://example.com/?trackme=1&keep=2',
      {
        rules: { exact: ['trackme'], prefixes: [] },
      },
    );
    expect(result.url).toBe('https://example.com/?keep=2');
  });

  it('keeps parameters that only look similar', () => {
    const result = stripTrackingParams(
      'https://example.com/?utm=1&utmsource=2&_glx=3',
    );
    expect(result.changed).toBe(false);
  });

  it('exposes its default rule set for documentation and enterprise policy', () => {
    expect(DEFAULT_TRACKING_RULES.exact).toContain('fbclid');
    expect(DEFAULT_TRACKING_RULES.prefixes).toContain('utm_');
  });
});
