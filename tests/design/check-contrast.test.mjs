import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CONTRAST_PAIRS,
  THRESHOLDS,
  checkContrast,
  composite,
  contrastRatio,
  parseColor,
  relativeLuminance,
  tokenValue,
} from '../../tools/design/check-contrast.mjs';

describe('WCAG colour maths', () => {
  it('parses hex, short hex and rgb/rgba', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 1,
    });
    expect(parseColor('rgba(10, 20, 30, 0.5)').a).toBeCloseTo(0.5);
    expect(parseColor('#00000080').a).toBeCloseTo(0.502, 2);
  });

  it('refuses values it cannot measure instead of guessing', () => {
    expect(() => parseColor('rebeccapurple')).toThrow(/unsupported/);
    expect(() => parseColor('rgb(50%, 0%, 0%)')).toThrow(/percentage/);
  });

  it('computes the spec contrast extremes', () => {
    const white = parseColor('#ffffff');
    const black = parseColor('#000000');
    expect(contrastRatio(black, white)).toBe(21);
    expect(contrastRatio(white, white)).toBe(1);
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
  });

  it('composites translucent layers the way a user sees them', () => {
    const white = parseColor('#ffffff');
    const black = parseColor('#000000');
    const half = { r: 0, g: 0, b: 0, a: 0.5 };
    expect(composite(half, white)).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
    expect(composite(white, black)).toEqual(white);
  });

  it('resolves themed token values and rejects unknown tokens', () => {
    const tokens = { color: { text: { light: '#111111', dark: '#eeeeee' } } };
    expect(tokenValue(tokens, 'color.text', 'light')).toBe('#111111');
    expect(tokenValue(tokens, 'color.text', 'dark')).toBe('#eeeeee');
    expect(() => tokenValue(tokens, 'color.missing', 'light')).toThrow(
      /unknown token/,
    );
  });
});

describe('the shipped token set', () => {
  it('declares pairs for both themes and beats the thresholds', () => {
    const { ok, results, problems } = checkContrast();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
    expect(results.length).toBe(
      CONTRAST_PAIRS.light.length + CONTRAST_PAIRS.dark.length,
    );
    for (const { pair, ratio, pass } of results) {
      expect(ratio, `${pair.note} measured ${ratio}:1`).toBeGreaterThanOrEqual(
        pair.minimum,
      );
      expect(pass).toBe(true);
    }
  });

  it('checks composited surfaces, not only flat colours', () => {
    const composited = [...CONTRAST_PAIRS.light, ...CONTRAST_PAIRS.dark].some(
      (pair) => (pair.composite ?? []).length > 0,
    );
    expect(composited).toBe(true);
  });

  it('fails loudly when a pair is below threshold', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aurelia-contrast-'));
    const tokensFile = path.join(dir, 'tokens.json');
    writeFileSync(
      tokensFile,
      JSON.stringify({
        color: {
          text: { light: '#bbbbbb' },
          background: { light: '#ffffff' },
        },
      }),
    );
    const result = checkContrast({
      tokensFile,
      pairs: {
        light: [
          {
            foreground: 'color.text',
            background: 'color.background',
            minimum: THRESHOLDS.bodyText,
            note: 'deliberately bad pair',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/deliberately bad pair/);
    expect(result.results[0].pass).toBe(false);
  });

  it('reports a missing token as a problem instead of crashing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aurelia-contrast-'));
    const tokensFile = path.join(dir, 'tokens.json');
    writeFileSync(tokensFile, JSON.stringify({ color: {} }));
    const result = checkContrast({
      tokensFile,
      pairs: {
        light: [
          {
            foreground: 'color.nope',
            background: 'color.background',
            minimum: 4.5,
            note: 'missing token',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/unknown token/);
  });
});
