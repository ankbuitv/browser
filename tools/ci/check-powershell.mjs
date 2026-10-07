#!/usr/bin/env node
/**
 * Structural checks for the PowerShell that Windows operators run.
 *
 * Fast CI runs on Linux, where Windows PowerShell cannot execute, so the value
 * here is catching the mistakes a text-level check *can* catch before they cost
 * somebody a failed build on their own machine:
 *
 *  - delimiters that do not balance outside strings, comments and here-strings;
 *  - an unterminated here-string or quoted string;
 *  - a line-continuation backtick with whitespace after it (the continuation is
 *    silently lost, and the next line becomes a new statement);
 *  - a tab, CRLF ending or trailing whitespace;
 *  - `Set-Content -Encoding UTF8` in a script that writes JSON: under Windows
 *    PowerShell 5.1 that adds a byte-order mark, which JSON.parse rejects.
 *
 * This is a lint, not a parser: the script is also parsed with tree-sitter
 * before it is handed to an operator, and the result of that parse is recorded
 * in the pull request. Syntax that only a real parser can see is still a real
 * risk, which is why nothing on this path claims to be verified on Windows
 * until it has actually run there.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from '../chromium/lib/config.mjs';
import { isMainModule } from '../lib/entry.mjs';

const OPENERS = { '{': '}', '(': ')', '[': ']' };
const CLOSERS = { '}': '{', ')': '(', ']': '[' };

/**
 * Replace every comment and string with spaces, preserving newlines so line
 * numbers keep pointing at the original text. The result is what the
 * delimiter scan and the "no BOM-writing cmdlet" check look at, so a comment
 * that merely *mentions* a bad pattern cannot fail the build.
 *
 * @returns {{ code: string, problems: string[] }}
 */
export function stripPowerShell(text) {
  const problems = [];
  let code = '';
  let index = 0;
  const length = text.length;
  const lineOf = (position) => text.slice(0, position).split('\n').length;
  const pad = (from, to) => {
    for (let cursor = from; cursor < to; cursor += 1) {
      code += text[cursor] === '\n' ? '\n' : ' ';
    }
  };

  while (index < length) {
    const character = text[index];
    const next = text[index + 1];

    // here-strings: @' ... '@ and @" ... "@ with the terminator at line start
    if (
      character === '@' &&
      (next === "'" || next === '"') &&
      (index + 2 >= length || text[index + 2] === '\n')
    ) {
      const terminator = next === "'" ? "'@" : '"@';
      let found = -1;
      for (let cursor = index + 2; cursor < length; cursor += 1) {
        if (
          (cursor === 0 || text[cursor - 1] === '\n') &&
          text.startsWith(terminator, cursor)
        ) {
          found = cursor;
          break;
        }
      }
      if (found === -1) {
        problems.push(
          `line ${lineOf(index)}: here-string (${terminator}) is never closed`,
        );
        pad(index, length);
        break;
      }
      pad(index, found + 2);
      index = found + 2;
      continue;
    }

    // block comment
    if (character === '<' && next === '#') {
      const close = text.indexOf('#>', index + 2);
      const stop = close === -1 ? length : close + 2;
      if (close === -1) {
        problems.push(`line ${lineOf(index)}: block comment is never closed`);
      }
      pad(index, stop);
      index = stop;
      continue;
    }

    // line comment
    if (character === '#') {
      while (index < length && text[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    // single-quoted string: only '' escapes a quote
    if (character === "'") {
      let cursor = index + 1;
      let closed = false;
      while (cursor < length) {
        if (text[cursor] === "'" && text[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === "'") {
          closed = true;
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      if (!closed) {
        problems.push(
          `line ${lineOf(index)}: single-quoted string is never closed`,
        );
      }
      pad(index, cursor);
      index = cursor;
      continue;
    }

    // double-quoted string: backtick escapes, "" is an escaped quote
    if (character === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < length) {
        if (text[cursor] === '`') {
          cursor += 2;
          continue;
        }
        if (text[cursor] === '"' && text[cursor + 1] === '"') {
          cursor += 2;
          continue;
        }
        if (text[cursor] === '"') {
          closed = true;
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      if (!closed) {
        problems.push(
          `line ${lineOf(index)}: double-quoted string is never closed`,
        );
      }
      pad(index, cursor);
      index = cursor;
      continue;
    }

    // an escape outside a string: also the line continuation
    if (character === '`') {
      index += 2;
      continue;
    }

    code += character;
    index += 1;
  }

  return { code, problems };
}

/** Balanced delimiters plus the whitespace rules, for one script. */
export function analyzePowerShellText(name, text) {
  const problems = [];

  if (text.charCodeAt(0) === 0xfeff) {
    problems.push(
      `${name}: starts with a UTF-8 byte-order mark; keep repository files BOM-free`,
    );
  }

  text.split('\n').forEach((line, index) => {
    const number = index + 1;
    if (line.endsWith('\r')) {
      problems.push(`${name}:${number}: CRLF line ending`);
    }
    if (line.includes('\t')) {
      problems.push(`${name}:${number}: contains a tab`);
    }
    if (/[ ]+$/.test(line)) {
      problems.push(`${name}:${number}: trailing whitespace`);
    }
    if (/`[ \t]+$/.test(line)) {
      problems.push(
        `${name}:${number}: a line-continuation backtick followed by whitespace does not continue the line`,
      );
    }
  });

  const { code, problems: stringProblems } = stripPowerShell(text);
  problems.push(...stringProblems.map((problem) => `${name}: ${problem}`));

  const stack = [];
  for (let position = 0; position < code.length; position += 1) {
    const character = code[position];
    if (OPENERS[character] !== undefined) {
      stack.push({ character, position });
    } else if (CLOSERS[character] !== undefined) {
      const open = stack.pop();
      if (open === undefined || open.character !== CLOSERS[character]) {
        const line = code.slice(0, position).split('\n').length;
        const expected = open === undefined ? 'nothing' : `"${open.character}"`;
        problems.push(
          `${name}:${line}: "${character}" closes ${expected}; delimiters are unbalanced`,
        );
        return { problems };
      }
    }
  }
  for (const open of stack) {
    const line = code.slice(0, open.position).split('\n').length;
    problems.push(`${name}:${line}: "${open.character}" is never closed`);
  }

  // The JSON export path: Set-Content -Encoding UTF8 writes a BOM in 5.1.
  if (/Set-Content[^\n]*Encoding\s+UTF8/.test(code)) {
    problems.push(
      `${name}: Set-Content -Encoding UTF8 writes a byte-order mark under Windows PowerShell 5.1; use the shared Write-Json helper`,
    );
  }

  return { problems };
}

/** Every `.ps1` under tools/. */
export function powerShellFiles(root = path.join(REPO_ROOT, 'tools')) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ps1')) {
        found.push(full);
      }
    }
  };
  if (statSync(root).isDirectory()) {
    walk(root);
  }
  return found.sort();
}

export function checkPowerShellScripts({
  root = path.join(REPO_ROOT, 'tools'),
} = {}) {
  const files = powerShellFiles(root);
  const problems = [];
  for (const file of files) {
    const name = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    const text = readFileSync(file, 'utf8');
    problems.push(...analyzePowerShellText(name, text).problems);
  }
  return { ok: problems.length === 0, files, problems };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const result = checkPowerShellScripts();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const problem of result.problems) {
      console.error(`FAIL  ${problem}`);
    }
    console.log(
      result.ok
        ? `PASS  PowerShell scripts are structurally sound\n        ${result.files.length} script(s)`
        : `FAIL  PowerShell scripts: ${result.problems.length} problem(s)`,
    );
  }
  process.exitCode = result.ok ? 0 : 1;
}
