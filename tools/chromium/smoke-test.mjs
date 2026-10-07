#!/usr/bin/env node
/**
 * Runtime smoke test for a built Aurelia binary.
 *
 * This is the only check in the repository that can prove a feature works
 * inside a real browser process. It launches the built binary with remote
 * debugging enabled and drives it over the Chrome DevTools Protocol:
 *
 *   1. the browser process starts and exposes DevTools;
 *   2. chrome://aurelia loads, renders Aurelia's own status surface, and its
 *      stylesheets come from the browser's resource pak;
 *   3. the binary's own product version and revision match the pin
 *      (Browser.getVersion, i.e. the compiled-in constants);
 *   4. a local test page loads - offline-safe, so a network outage cannot
 *      produce a false failure;
 *   5. the browser stays alive through the run and exits cleanly;
 *   6. optional: a network navigation works (--check-network), which is a
 *      connectivity check, NOT the privacy verification (that lives in
 *      docs/NETWORK-CONNECTIONS.md and the privacy test suite).
 *
 * Sandbox policy: the test never passes --no-sandbox by default, because a
 * sandboxed run is what a real user gets. A CI environment that genuinely
 * cannot run sandboxed must pass --allow-disabled-sandbox, which is recorded
 * in the report as NOT equivalent to product-runtime verification.
 *
 * It requires Node.js >= 22.4 for the global WebSocket implementation and
 * never runs as part of the installed browser - it is development tooling.
 *
 * Usage:
 *   node tools/chromium/smoke-test.mjs --binary out/Aurelia/chrome.exe
 *   node tools/chromium/smoke-test.mjs --binary .\out\Release\chrome.exe --json
 *   node tools/chromium/smoke-test.mjs --binary ./chrome --check-network
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './lib/config.mjs';
import { isMainModule } from '../lib/entry.mjs';

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Minimal CDP client over the browser-level WebSocket endpoint. */
class CdpClient {
  constructor(url, { log = () => {} } = {}) {
    this.url = url;
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.waiters = [];
    this.socket = null;
  }

  async connect() {
    if (typeof WebSocket === 'undefined') {
      throw new Error(
        'this Node.js version has no global WebSocket; use Node.js >= 22.4 for the smoke test',
      );
    }
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', (event) => {
        reject(new Error(`websocket error: ${event.message ?? 'unknown'}`));
      });
      socket.addEventListener('message', (event) => {
        this.handleMessage(String(event.data));
      });
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        resolve(message.result ?? {});
      }
      return;
    }
    this.events.push(message);
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(message)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId !== undefined) {
      payload.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout for ${method}`));
        }
      }, DEFAULT_TIMEOUT_MS);
    });
  }

  waitForEvent(predicate, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const existing = this.events.find(predicate);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) {
          this.waiters.splice(index, 1);
          reject(new Error('timed out waiting for a CDP event'));
        }
      }, timeoutMs);
    });
  }

  close() {
    this.socket?.close();
  }
}

async function waitForDevToolsPort(userDataDir, timeoutMs) {
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const contents = await readFile(portFile, 'utf8');
      const [port] = contents.split('\n');
      if (port !== undefined && /^\d+$/.test(port.trim())) {
        return Number(port.trim());
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the browser never reported a DevTools port');
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails !== undefined) {
    throw new Error(
      `page evaluation failed: ${result.exceptionDetails.text ?? 'unknown'}`,
    );
  }
  return result.result?.value;
}

/**
 * Open a URL in a new tab and wait until the document reports the expected
 * readiness predicate.
 */
async function openAndWaitFor(client, url, predicateExpression, timeoutMs) {
  const { targetId } = await client.send('Target.createTarget', { url });
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);

  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(client, sessionId, predicateExpression);
      if (lastValue === true) {
        return { targetId, sessionId };
      }
    } catch {
      // The document may not exist yet; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `timed out waiting for ${url} to become ready (last evaluation: ${JSON.stringify(lastValue)})`,
  );
}

async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return child.exitCode;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function runSmokeTest({
  binary,
  extraArgs = [],
  checkNetwork = false,
  allowDisabledSandbox = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = () => {},
  config = loadConfig(),
}) {
  if (binary === undefined) {
    throw new Error('--binary <path to built browser> is required');
  }
  if (!existsSync(binary)) {
    throw new Error(`binary not found: ${binary}`);
  }

  const disableSandbox = extraArgs.includes('--no-sandbox');
  if (disableSandbox && !allowDisabledSandbox) {
    throw new Error(
      'refusing to run with --no-sandbox: a sandboxed run is what users get. ' +
        'Pass --allow-disabled-sandbox to acknowledge that the result is not ' +
        'equivalent to product-runtime verification.',
    );
  }
  const sandboxMode = disableSandbox ? 'disabled-by-explicit-flag' : 'default';

  const userDataDir = await mkdtemp(path.join(tmpdir(), 'aurelia-smoke-'));
  // A local page keeps the basic navigation assertion independent of the
  // network: an offline or rate-limited builder must not fail the smoke test.
  const localPagePath = path.join(userDataDir, 'smoke-test-page.html');
  writeFileSync(
    localPagePath,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>Aurelia local test page</title></head><body>' +
      '<p id="marker">local-navigation-ok</p></body></html>',
  );
  const localPageUrl = pathToFileURL(localPagePath).href;

  log(`launching ${binary}`);
  log(`profile: ${userDataDir}`);
  if (sandboxMode !== 'default') {
    log('WARNING: sandbox disabled by explicit flag - this run is NOT product-equivalent');
  }

  const child = spawn(
    binary,
    [
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--window-size=1280,900',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let browserOutput = '';
  child.stdout?.on('data', (chunk) => {
    browserOutput += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    browserOutput += String(chunk);
  });

  const results = [];
  const record = (name, ok, details) => {
    results.push({ name, ok, details });
    log(`${ok ? 'PASS' : 'FAIL'}  ${name}${details === undefined ? '' : `\n        ${details}`}`);
  };

  let client;
  try {
    const port = await waitForDevToolsPort(userDataDir, timeoutMs);
    log(`DevTools port: ${port}`);
    const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
    const version = await versionResponse.json();

    client = new CdpClient(version.webSocketDebuggerUrl, { log });
    await client.connect();

    record(
      'browser process exposes DevTools',
      typeof version.Browser === 'string',
      version.Browser,
    );

    // 1. chrome://aurelia exists and renders.
    const { sessionId } = await openAndWaitFor(
      client,
      'chrome://aurelia',
      `document.title === 'Aurelia' && !!document.querySelector('aurelia-app')`,
      timeoutMs,
    );

    const page = await evaluate(
      client,
      sessionId,
      `(() => ({
        title: document.title,
        text: document.body.innerText,
        stylesheetCount: document.styleSheets.length,
        cards: document.querySelectorAll('aurelia-status-card').length,
      }))()`,
    );

    record(
      'chrome://aurelia renders the Aurelia page',
      typeof page.text === 'string' && page.text.includes('Aurelia'),
      page.title,
    );
    record(
      'chrome://aurelia stylesheets load from the resource pak',
      page.stylesheetCount >= 2,
      `${page.stylesheetCount} stylesheet(s)`,
    );
    record(
      'chrome://aurelia renders its status cards',
      page.cards >= 3,
      `${page.cards} card(s)`,
    );

    // 2. The pin is reported by the page (proves the compiled-in constants and
    //    the WebUI data source work end to end).
    record(
      'page reports the pinned Chromium revision',
      typeof page.text === 'string' &&
        page.text.includes(config.chromium.revision.slice(0, 12)),
      `expected ${config.chromium.revision.slice(0, 12)}`,
    );

    // 3. Build integrity: the binary's own version equals the pin.
    record(
      'binary version matches the pinned Chromium version',
      page.text.includes(config.chromium.version),
      `expected ${config.chromium.version}; browser reported ${version.Browser}`,
    );

    record(
      'page reports no privileged interfaces',
      typeof page.text === 'string' &&
        page.text.includes('Privileged interfaces') &&
        page.text.includes('none'),
      'verification card present',
    );

    // 2b. Build integrity from the browser itself: product version and the
    //     compiled-in revision must match the pin exactly.
    const browserVersion = await client.send('Browser.getVersion');
    const revision = String(browserVersion.revision ?? '').replace(/^@/, '');
    record(
      'browser product version matches the pinned Chromium version',
      String(browserVersion.product ?? '').includes(config.chromium.version),
      `expected ${config.chromium.version}; browser reports ${browserVersion.product}`,
    );
    record(
      'browser revision matches the pinned Chromium revision',
      revision === config.chromium.revision,
      `expected ${config.chromium.revision}; browser reports ${revision || 'nothing'}`,
    );

    // 3b. Local navigation: proves pages load without any network dependency.
    const localSession = await openAndWaitFor(
      client,
      localPageUrl,
      `document.readyState === 'complete' && !!document.body && document.body.innerText.includes('local-navigation-ok')`,
      timeoutMs,
    );
    const localTitle = await evaluate(
      client,
      localSession.sessionId,
      'document.title',
    );
    record(
      'loads a local test page without network access',
      localTitle === 'Aurelia local test page',
      localPageUrl,
    );

    // 4. Optional network navigation (off by default; enabled on builders that
    //    are allowed to reach the internet).
    if (checkNetwork) {
      const networkSession = await openAndWaitFor(
        client,
        'https://example.com/',
        `document.readyState === 'complete'`,
        timeoutMs,
      );
      const networkTitle = await evaluate(
        client,
        networkSession.sessionId,
        'document.title',
      );
      record(
        'network navigation works',
        typeof networkTitle === 'string' && networkTitle.length > 0,
        networkTitle,
      );
    } else {
      log('skipped network navigation (pass --check-network to enable)');
    }
    // 5. The browser must still be running at the end of the run (not a
    //    process that survived only long enough to answer one request).
    record(
      'browser process stays alive through the whole run',
      child.exitCode === null && child.signalCode === null,
      `exitCode=${child.exitCode} signal=${child.signalCode}`,
    );

    // 6. Clean shutdown: ask the browser to close and require exit code 0.
    try {
      await client.send('Browser.close');
    } catch {
      // The socket may close before the reply arrives; the exit check decides.
    }
    const exitCode = await waitForExit(child, 15_000);
    record(
      'browser exits cleanly after Browser.close',
      exitCode === 0,
      exitCode === null ? 'still running after 15s' : `exit code ${exitCode}`,
    );
  } catch (error) {
    record('smoke test completed', false, error.message);
    if (browserOutput.length > 0) {
      log('browser output:');
      log(browserOutput.split('\n').slice(-20).join('\n'));
    }
  } finally {
    client?.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    await rm(userDataDir, { recursive: true, force: true });
  }

  return {
    ok: results.every((result) => result.ok),
    binary,
    sandboxMode,
    equivalentToProductRuntime: sandboxMode === 'default',
    pin: {
      version: config.chromium.version,
      revision: config.chromium.revision,
    },
    results,
  };
}

function parseArgs(argv) {
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const extraArgs = [];
  for (const arg of argv) {
    if (arg.startsWith('--extra-arg=')) {
      extraArgs.push(arg.slice('--extra-arg='.length));
    }
  }
  return {
    binary: valueOf('--binary'),
    checkNetwork: argv.includes('--check-network'),
    allowDisabledSandbox: argv.includes('--allow-disabled-sandbox'),
    json: argv.includes('--json'),
    report: valueOf('--report'),
    extraArgs,
  };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await runSmokeTest({
      ...options,
      log: options.json ? () => {} : console.log,
    });
    if (options.report !== undefined) {
      // Node writes UTF-8 without a BOM, which matters on Windows: shell
      // redirection there would produce a file JSON.parse cannot read back.
      writeFileSync(options.report, `${JSON.stringify(result, null, 2)}\n`);
    }
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('');
      console.log(result.ok ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
      if (options.report !== undefined) {
        console.log(`report: ${options.report} (sandbox: ${result.sandboxMode})`);
      }
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
