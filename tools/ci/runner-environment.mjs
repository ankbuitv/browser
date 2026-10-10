/** Return whether the current process is executing on a GitHub-hosted runner. */
export function isGithubHostedRunner(env = process.env) {
  return (
    env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted'
  );
}
