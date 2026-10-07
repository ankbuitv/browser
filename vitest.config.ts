// Vitest configuration for Aurelia-owned code.
//
// This test suite covers ONLY Aurelia-owned components and tooling. Chromium
// upstream code is tested by Chromium's own test infrastructure inside the
// pinned upstream checkout (see docs/CHROMIUM-UPSTREAM.md and docs/TESTING.md).
//
// The default environment is `node`; individual tests that need a DOM opt in
// with a `// @vitest-environment jsdom` docblock.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@aurelia/core': src('packages/core/src/index.ts'),
      '@aurelia/design-tokens': src('packages/design-tokens/src/index.ts'),
      '@aurelia/ui-shell': src('packages/ui-shell/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      'tests/**/*.test.ts',
      'tests/**/*.test.mjs',
      'tools/**/*.test.mjs',
    ],
    exclude: ['node_modules/**', 'chromium/**', 'artifacts/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**', 'tools/**'],
      exclude: ['**/*.test.*', 'packages/*/src/index.ts'],
    },
  },
});
