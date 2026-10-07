#!/usr/bin/env node
/**
 * WCAG 2.1 contrast checker for the Aurelia design tokens.
 *
 * The tokens promise WCAG AA; this tool is the evidence. It is deliberately
 * small, runs offline, and has no dependencies: WCAG's relative luminance and
 * contrast-ratio formulas are short enough that pulling in a library would add
 * supply-chain surface for no benefit.
 *
 * Each checked pair is *declared* here with the surface it actually occurs on,
 * so a failure names a real UI situation ("muted text on the elevated surface")
 * rather than a colour pair nobody can place. Translucent surfaces are
 * composited over their base before measuring, because that is what a user
 * sees.
 *
 * Usage:
 *   node tools/design/check-contrast.mjs         # check; exit 1 on failure
 *   node tools/design/check-contrast.mjs --json  # machine-readable result
 *   node tools/design/check-contrast.mjs --list  # print the checked pairs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/entry.mjs';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const TOKENS_FILE = path.join(
  REPO_ROOT,
  'packages/design-tokens/tokens.json',
);

/** WCAG 2.1 thresholds. */
export const THRESHOLDS = {
  bodyText: 4.5,
  largeText: 3.0,
  nonText: 3.0,
};

/** @typedef {{foreground: string, background: string, composite?: string[], minimum: number, note: string}} Pair */

/**
 * The reviewed pair list. `composite` lists translucent layers applied over
 * `background`, in painting order, before the foreground is measured.
 *
 * @type {{light: Pair[], dark: Pair[]}}
 */
export const CONTRAST_PAIRS = {
  light: [
    {
      foreground: 'color.text',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'primary text on the page background',
    },
    {
      foreground: 'color.text',
      background: 'color.backgroundElevated',
      minimum: THRESHOLDS.bodyText,
      note: 'primary text on an opaque surface',
    },
    {
      foreground: 'color.textMuted',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'secondary text on the page background',
    },
    {
      foreground: 'color.textMuted',
      background: 'color.backgroundElevated',
      minimum: THRESHOLDS.bodyText,
      note: 'secondary text on an opaque surface',
    },
    {
      foreground: 'color.accentText',
      background: 'color.accent',
      minimum: THRESHOLDS.bodyText,
      note: 'label on a filled accent control',
    },
    {
      foreground: 'color.success',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'success status text',
    },
    {
      foreground: 'color.warning',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'warning status text',
    },
    {
      foreground: 'color.danger',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'error status text',
    },
    {
      foreground: 'color.accent',
      background: 'color.background',
      minimum: THRESHOLDS.nonText,
      note: 'focus ring / accent indicator (non-text)',
    },
    {
      foreground: 'color.text',
      background: 'color.background',
      composite: ['color.surfaceGlass'],
      minimum: THRESHOLDS.bodyText,
      note: 'primary text on the glass card surface (composited)',
    },
    {
      foreground: 'color.textMuted',
      background: 'color.background',
      composite: ['color.surfaceGlass'],
      minimum: THRESHOLDS.bodyText,
      note: 'secondary text on the glass card surface (composited)',
    },
  ],
  dark: [
    {
      foreground: 'color.text',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'primary text on the page background',
    },
    {
      foreground: 'color.text',
      background: 'color.backgroundElevated',
      minimum: THRESHOLDS.bodyText,
      note: 'primary text on an opaque surface',
    },
    {
      foreground: 'color.textMuted',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'secondary text on the page background',
    },
    {
      foreground: 'color.textMuted',
      background: 'color.backgroundElevated',
      minimum: THRESHOLDS.bodyText,
      note: 'secondary text on an opaque surface',
    },
    {
      foreground: 'color.accentText',
      background: 'color.accent',
      minimum: THRESHOLDS.bodyText,
      note: 'label on a filled accent control',
    },
    {
      foreground: 'color.success',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'success status text',
    },
    {
      foreground: 'color.warning',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'warning status text',
    },
    {
      foreground: 'color.danger',
      background: 'color.background',
      minimum: THRESHOLDS.bodyText,
      note: 'error status text',
    },
    {
      foreground: 'color.accent',
      background: 'color.background',
      minimum: THRESHOLDS.nonText,
      note: 'focus ring / accent indicator (non-text)',
    },
    {
      foreground: 'color.text',
      background: 'color.background',
      composite: ['color.surfaceGlass'],
      minimum: THRESHOLDS.bodyText,
      note: 'primary text on the glass card surface (composited)',
    },
    {
      foreground: 'color.textMuted',
      background: 'color.background',
      composite: ['color.surfaceGlass'],
      minimum: THRESHOLDS.bodyText,
      note: 'secondary text on the glass card surface (composited)',
    },
  ],
};

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb[a](...)` into {r,g,b,a}. */
export function parseColor(value) {
  const text = String(value).trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex !== null) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = digits
        .split('')
        .map((digit) => digit + digit)
        .join('');
    }
    const hasAlpha = digits.length === 8;
    const r = parseInt(digits.slice(0, 2), 16);
    const g = parseInt(digits.slice(2, 4), 16);
    const b = parseInt(digits.slice(4, 6), 16);
    const a = hasAlpha ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgba !== null) {
    const parts = rgba[1].split(/[\s,/]+/).filter((part) => part !== '');
    const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    // Percentages are legal in CSS and would silently measure as 0-1 here.
    if (parts.slice(0, 3).some((part) => part.includes('%'))) {
      throw new Error(`percentage components are not supported: ${text}`);
    }
    const a = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
    return { r, g, b, a };
  }
  throw new Error(`unsupported colour value: ${text}`);
}

/** Composite `top` over `bottom` (both {r,g,b,a}), returning an opaque colour. */
export function composite(top, bottom) {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha === 0) {
    return { r: 0, g: 0, b: 0, a: 1 };
  }
  const channel = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / alpha;
  return {
    r: channel(top.r, bottom.r),
    g: channel(top.g, bottom.g),
    b: channel(top.b, bottom.b),
    a: 1,
  };
}

/** WCAG relative luminance. */
export function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, rounded to two decimals like the spec's tables. */
export function contrastRatio(foreground, background) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/** Resolve a token path to its value for a theme. */
export function tokenValue(tokens, tokenPath, theme) {
  const parts = tokenPath.split('.');
  let node = tokens;
  for (const part of parts) {
    node = node?.[part];
    if (node === undefined) {
      throw new Error(`unknown token: ${tokenPath}`);
    }
  }
  if (typeof node === 'string') {
    return node;
  }
  const value = node[theme] ?? node.value;
  if (typeof value !== 'string') {
    throw new Error(`token ${tokenPath} has no ${theme} value`);
  }
  return value;
}

/**
 * Check every declared pair.
 *
 * @returns {{ok: boolean, results: {theme: string, pair: Pair, ratio: number, pass: boolean}[], problems: string[]}}
 */
export function checkContrast({
  tokensFile = TOKENS_FILE,
  pairs = CONTRAST_PAIRS,
} = {}) {
  const tokens = JSON.parse(readFileSync(tokensFile, 'utf8'));
  const results = [];
  const problems = [];

  for (const [theme, themePairs] of Object.entries(pairs)) {
    for (const pair of themePairs) {
      try {
        let background = parseColor(tokenValue(tokens, pair.background, theme));
        for (const layerPath of pair.composite ?? []) {
          background = composite(
            parseColor(tokenValue(tokens, layerPath, theme)),
            background,
          );
        }
        const foreground = parseColor(
          tokenValue(tokens, pair.foreground, theme),
        );
        const opaqueForeground =
          foreground.a === 1 ? foreground : composite(foreground, background);
        const ratio = contrastRatio(opaqueForeground, background);
        const pass = ratio >= pair.minimum;
        results.push({ theme, pair, ratio, pass });
        if (!pass) {
          problems.push(
            `${theme}: ${pair.note} — ${pair.foreground} on ${pair.background} is ${ratio}:1, needs ${pair.minimum}:1`,
          );
        }
      } catch (error) {
        problems.push(`${theme}: ${pair.note} — ${error.message}`);
      }
    }
  }

  return { ok: problems.length === 0, results, problems };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Check the design tokens against WCAG 2.1 AA.

  --json   machine-readable result
  --list   print the checked pairs without measuring`);
    process.exitCode = 0;
  } else if (argv.includes('--list')) {
    for (const [theme, pairs] of Object.entries(CONTRAST_PAIRS)) {
      for (const pair of pairs) {
        console.log(
          `${theme.padEnd(5)} ${pair.foreground} on ${pair.background} (min ${pair.minimum}:1) — ${pair.note}`,
        );
      }
    }
    process.exitCode = 0;
  } else {
    const result = checkContrast();
    if (argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const { theme, pair, ratio, pass } of result.results) {
        console.log(
          `${pass ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${String(ratio).padStart(6)}:1  ${pair.note}`,
        );
      }
      console.log('');
      if (result.ok) {
        console.log(
          `contrast OK (${result.results.length} pair(s), WCAG 2.1 AA thresholds)`,
        );
      } else {
        for (const problem of result.problems) {
          console.error(`contrast: ${problem}`);
        }
        console.error('CONTRAST CHECK FAILED');
      }
    }
    process.exitCode = result.ok ? 0 : 1;
  }
}
