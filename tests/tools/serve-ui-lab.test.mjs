import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createHarnessServer,
  resolveFile,
} from '../../tools/dev/serve-ui-lab.mjs';

describe('UI development harness server', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = createHarnessServer({ log: () => {} });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves the harness page, its script and the generated tokens', async () => {
    for (const [path, contentType] of [
      ['/', 'text/html'],
      ['/src/harness.js', 'text/javascript'],
      ['/src/harness.css', 'text/css'],
      ['/src/tokens.generated.css', 'text/css'],
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toContain(contentType);
    }
  });

  it('labels every response as a harness, never as the browser', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.headers.get('x-aurelia-harness')).toBe(
      'development-harness-not-the-browser',
    );
    const html = await response.text();
    expect(html).toContain('UI development harness');
    expect(html).toContain('not the Aurelia browser');
  });

  it('refuses to serve anything outside the harness directories', async () => {
    expect(await resolveFile('/../../package.json')).toBeNull();
    expect(await resolveFile('/../.git/config')).toBeNull();
    const response = await fetch(`${baseUrl}/../package.json`);
    expect(response.status).toBe(404);
  });

  it('serves the token stylesheet the WebUI also consumes', async () => {
    const css = await (
      await fetch(`${baseUrl}/src/tokens.generated.css`)
    ).text();
    expect(css).toContain('--aurelia-color-background');
    expect(css).toContain('GENERATED FILE - DO NOT EDIT');
  });
});
