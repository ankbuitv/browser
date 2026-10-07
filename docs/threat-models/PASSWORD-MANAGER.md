# Threat model: password manager

**Status: design only (M4). No password storage code exists yet.** The threat
model comes first on purpose: password storage is the one feature whose failure
is immediately catastrophic for users.

## Scope

Storing, filling and (optionally, later) syncing credentials, plus autofill
behaviour in the browser. Aurelia does not intend to replace dedicated password
managers; it intends to be safe for users who expect a browser to remember
passwords.

## Assets

| Asset                                                 | Impact if disclosed                                         |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| Stored credentials                                    | Account takeover; credential-reuse turns one leak into many |
| The vault encryption key                              | Same as above, immediately                                  |
| Vault metadata (which sites the user has accounts on) | Highly identifying even without passwords                   |
| Autofill behaviour at runtime                         | A wrong fill can leak a password to the wrong origin        |

## Adversaries and mitigations

### A1. Web page trying to steal credentials

_Capability:_ renders content, can imitate login forms, can embed iframes.

_Mitigations:_

- filling is bound to **exact origin match** (scheme, host, port), never
  fuzzy/contains/substring matching;
- no filling inside cross-origin iframes, popups or sandboxed frames;
- password fields inside iframes are handled per the top-level origin rules
  Chromium provides, and uncertain cases are refused rather than guessed;
- filling requires a user gesture for stored credentials;
- the vault never exposes a "list all passwords" API to page context.

### A2. Memory/API scraping by a hostile extension

_Capability:_ extension APIs, DOM access, background scripts.

_Mitigations:_ vault contents are not reachable through an extension API; the
vault must be unlocked explicitly; extension access to autofill internals is
blocked by default, and enterprise policy can block extensions entirely.

### A3. Local attacker or malware

_Capability:_ reads files and memory as the user.

_Mitigations:_ encrypted vault on disk with a key wrapped by the OS secure store
(DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux); a lock
timeout and explicit lock action; re-authentication for viewing or exporting
secrets.

_Residual risk (explicit):_ live malware with the user's privileges can read a
decrypted vault from memory. Client-side encryption is not a defence against a
compromised endpoint.

### A4. Offline attack on the vault file

_Capability:_ attacker copies the vault file and brute-forces it.

_Mitigations:_ memory-hard KDF (Argon2id) for any password-derived key;
AEAD for storage; never store a key alongside the vault it protects; a decoy
"panic" behaviour is **not** implemented and never claimed.

### A5. Server-side compromise (if sync is enabled)

_Mitigations:_ the vault is E2EE; the server holds ciphertext; wrapped keys
travel only as ciphertext; see [SYNC.md](SYNC.md). Passwords sync only when the
user opts in separately from other data classes.

### A6. Origin confusion and phishing

_Mitigations:_ origin is displayed in the fill prompt; fills never occur on
origins without a stored match; a fallback "fill by hand from the vault" is
explicit; look-alike domains produce no match - the absence of a match is shown
as a warning rather than silently ignored.

### A7. Accidental disclosure through logs, crash reports or diagnostics

_Mitigations:_ passwords and vault keys are excluded from diagnostics bundles by
construction (allowlist-based export, not blocklist); crash reporting is off by
default; any field that could contain a secret is redacted before an export is
even offered.

## Trust boundaries and invariants

1. **Never expose a password to a non-matching origin.** Enforced by exact
   origin comparison in a single code path, with tests for port/scheme/subdomain
   differences.
2. **Never write plaintext secrets to disk, logs, or the network.**
3. **Never build custom cryptography.** Use a reviewed library for AEAD and KDF.
4. **Locking is real**: locked means the key material is gone from memory, not
   merely hidden.
5. **Export is explicit, authenticated and allowlisted** - never a silent
   side effect of "export diagnostics".

## Planned tests (M4)

- exact-origin matching: `https://a.example` vs `http://a.example`,
  `https://a.example:8443`, `https://b.a.example`, punycode look-alikes;
- no autofill in cross-origin iframes or sandboxed frames;
- vault file is ciphertext: a test asserts a password string never appears in the
  vault file bytes;
- wrong password / tampered vault file is rejected;
- lock/unlock lifecycle, including lock on idle and on sign-out;
- export flow refuses to include secrets in a diagnostics bundle;
- a filled password never appears in a URL, page title, or history entry.

## Out of scope

- Defending against a fully compromised OS while the vault is unlocked.
- Preventing the user from pasting a password into a phishing page themselves.
- Password generation quality beyond using the OS CSPRNG and a reviewed
  generator configuration.
