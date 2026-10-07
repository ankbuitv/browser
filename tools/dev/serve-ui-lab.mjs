#!/usr/bin/env node
/**
 * Static server for the UI development harness.
 *
 * The harness is a *development and test harness for components that are meant
 * to become real Chromium WebUI/resources*. It is not the Aurelia browser and
 * is labelled as such in the UI itself.
 *
 * Zero dependencies on purpose: this must never become a second application
 * stack next to Chromium. It serves files from packages/ui-lab (and the
 * generated token CSS from packages/design-tokens) with correct MIME types and
 * binds to 0.0.0.0 so a remote preview can reach it.
 *
 * Usage:
 *   node tools/dev/serve-ui-lab.mjs [--port 5174]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const ROOTS = [
  path.join(REPO_ROOT, 'packages/ui-lab'),
  path.join(REPO_ROOT, 'packages/design-tokens'),
];

const MIME = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  }),
);

export async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const relative = clean === '/' ? '/index.html' : clean;
  if (relative.includes('..')) {
    return null;
  }
  for (const root of ROOTS) {
    const candidate = path.join(root, relative.replace(/^\//, ''));
    if (!candidate.startsWith(root)) {
      continue;
    }
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        return candidate;
      }
    } catch {
      // try the next root
    }
  }
  return null;
}

export function createHarnessServer({ log = console.log } = {}) {
  return createServer(async (request, response) => {
    const file = await resolveFile(request.url ?? '/');
    if (file === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(
        'not found - the harness only serves packages/ui-lab and packages/design-tokens\n',
      );
      log(`404 ${request.url}`);
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type':
        MIME.get(path.extname(file)) ?? 'application/octet-stream',
      'cache-control': 'no-store',
      // The harness is explicitly not the browser: nothing here may claim to be.
      'x-aurelia-harness': 'development-harness-not-the-browser',
    });
    response.end(body);
  });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf('--port');
  const port =
    portIndex === -1
      ? Number(process.env.PORT ?? 5174)
      : Number(argv[portIndex + 1]);
  const host = process.env.HOST ?? '0.0.0.0';
  const server = createHarnessServer();
  server.listen(port, host, () => {
    console.log(
      `UI development harness (NOT the Aurelia browser) on http://${host}:${port}/`,
    );
  });
}
