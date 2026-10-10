import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../tools/chromium/lib/exec.mjs', () => ({
  captureCommand: vi.fn(),
  captureCommandBuffer: vi.fn(),
}));
import { captureCommand } from '../../tools/chromium/lib/exec.mjs';
import { fetchUpstreamFileViaApi } from '../../tools/chromium/lib/upstream.mjs';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe('upstream API transport', () => {
  it('passes Actions authentication through the environment, never arguments', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GH_TOKEN', 'test-only-token');
    captureCommand.mockReturnValue(
      Buffer.from('upstream bytes').toString('base64'),
    );
    expect(
      fetchUpstreamFileViaApi(
        'chromium/chromium',
        'a'.repeat(40),
        'chrome/VERSION',
      ).toString(),
    ).toBe('upstream bytes');
    const [command, options] = captureCommand.mock.calls[0];
    expect(command.args.join(' ')).not.toContain('test-only-token');
    expect(options.env.GH_TOKEN).toBe('test-only-token');
  });

  it('propagates API rate limit 403 errors instead of returning success', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GH_TOKEN', 'test-only-token');
    captureCommand.mockImplementation(() => {
      throw new Error('API rate limit exceeded (HTTP 403)');
    });
    expect(() =>
      fetchUpstreamFileViaApi(
        'chromium/chromium',
        'a'.repeat(40),
        'chrome/VERSION',
      ),
    ).toThrow(/HTTP 403/);
  });
});
