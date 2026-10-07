/**
 * Entry-point detection that also works on Windows.
 *
 * The naive comparison
 *
 *   import.meta.url === `file://${path.resolve(process.argv[1])}`
 *
 * builds `file://D:\a\...` on Windows while `import.meta.url` is
 * `file:///D:/a/...`, so the condition is never true. The tool then exits 0
 * without doing anything - which looks exactly like success. The first two
 * hosted Windows experiment runs both died this way: `check-builder.mjs` never
 * wrote its record, and the classification step failed on the missing file.
 * (It also breaks on POSIX paths containing spaces or other characters that
 * URLs percent-encode, e.g. `file:///tmp/a b.mjs` vs `file:///tmp/a%20b.mjs`.)
 *
 * `pathToFileURL` produces the same escaping Node uses for `import.meta.url`
 * (forward slashes, percent-encoding), so always compare through it. The
 * realpath fallback keeps `node ./symlink-to-tool.mjs` working too, because
 * Node resolves symlinks before setting `import.meta.url`.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} metaUrl the module's own `import.meta.url`
 * @param {string} [argv1] defaults to `process.argv[1]`
 * @returns {boolean} true when this module is the process entry point
 */
export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (typeof metaUrl !== 'string' || typeof argv1 !== 'string') {
    return false;
  }
  if (argv1.length === 0) {
    return false;
  }
  if (matches(metaUrl, argv1)) {
    return true;
  }
  // Invoked through a symlink: Node resolves the real path for import.meta.url.
  try {
    return matches(metaUrl, realpathSync(argv1));
  } catch {
    return false;
  }
}

function matches(metaUrl, candidate) {
  try {
    return metaUrl === pathToFileURL(candidate).href;
  } catch {
    return false;
  }
}
