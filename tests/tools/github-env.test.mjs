import { describe, expect, it } from 'vitest';
import { githubEnv } from '../../tools/chromium/lib/github-env.mjs';

describe('GitHub API authentication', () => {
  it('requires an explicit token in Actions instead of an anonymous fallback', () => {
    expect(() => githubEnv({ GITHUB_ACTIONS: 'true' })).toThrow(
      /requires GH_TOKEN/,
    );
    expect(() => githubEnv({ GITHUB_ACTIONS: 'true', GH_TOKEN: '' })).toThrow(
      /requires GH_TOKEN/,
    );
  });

  it('uses GH_TOKEN first and preserves unrelated environment variables', () => {
    const env = {
      GITHUB_ACTIONS: 'true',
      GH_TOKEN: 'test-only-gh',
      GITHUB_TOKEN: 'test-only-github',
      PATH: '/bin',
    };
    expect(githubEnv(env)).toEqual(env);
  });

  it('accepts GITHUB_TOKEN without mutating the caller environment', () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'test-only-github' };
    expect(githubEnv(env).GH_TOKEN).toBe(env.GITHUB_TOKEN);
    expect(env.GH_TOKEN).toBeUndefined();
  });

  it('preserves a local gh login when no token is exported', () => {
    const env = { PATH: '/bin' };
    expect(githubEnv(env)).toBe(env);
  });
});
