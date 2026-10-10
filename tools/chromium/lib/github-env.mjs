/**
 * Let gh set the Authorization header; never put credentials in command args.
 * Actions does not export github.token automatically. Workflows bind it to
 * GH_TOKEN on the network steps only, with contents: read permission.
 */
export function githubEnv(env = process.env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (env.GITHUB_ACTIONS === 'true' && !token) {
    throw new Error(
      'GitHub API verification in Actions requires GH_TOKEN from github.token (contents: read); refusing an unauthenticated request',
    );
  }
  // Outside Actions, preserve support for an existing `gh auth login` session.
  return token ? { ...env, GH_TOKEN: token } : env;
}
