# Sync architecture

**Status: SCAFFOLDED. Nothing syncs today.** This document defines the shape of
the optional sync feature so that implementation happens behind a stable
abstraction, and so that the cryptographic boundaries are decided _before_ any
code exists. Detailed adversary analysis: [threat-models/SYNC.md](threat-models/SYNC.md).

## Invariants

These are product promises, not implementation details. A change that breaks one
of them is a product change, not a refactor:

1. **The browser works completely without an account.** Sync off is a real
   state, not a degraded one.
2. **The server never receives plaintext passwords, browsing history,
   bookmarks, tabs or settings.** Everything sensitive is encrypted on the
   device before upload.
3. **No home-grown cryptography.** Only reviewed libraries and standard
   primitives.
4. **Sync refuses to run without E2EE.** `checkInvariants()` in
   `packages/core/src/prefs/derived.ts` raises a hard error for
   `sync.enabled && !sync.e2eeEnabled`.
5. **Account and data deletion deletes cloud data**, not just local copies.
6. **A provider abstraction exists from day one**, so the backend can be
   replaced, self-hosted or migrated without changing the client's crypto.

## Layering

```
UI (settings, sync status)
  |
SyncEngine        - orchestration, retry, conflict resolution, backoff
  |
CryptoLayer       - E2EE: key derivation, AEAD encrypt/decrypt, key wrapping
  |
PayloadCodec      - versioned, typed payloads per data class
  |
ProviderAdapter   - interface: auth, list, get, put, delete, device registry
  |----------------+---------------------------------+
  |                |                                 |
SupabaseProvider  SelfHostedProvider       (future providers)
(reference)       (same interface)
```

The `ProviderAdapter` interface is deliberately dumb. It moves opaque blobs and
handles authentication. It never sees a key, and the client never trusts it to
validate anything.

## Data classes and encryption

| Data class                          | Sync?                      | Encryption                  | Notes                                                                                                                                               |
| ----------------------------------- | -------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bookmarks                           | yes                        | E2EE                        | Full structure including folder tree.                                                                                                               |
| History                             | yes                        | E2EE                        | Optional per-user; can be excluded from sync.                                                                                                       |
| Open tabs / session                 | yes                        | E2EE                        | Ephemeral; also useful for "send to device".                                                                                                        |
| Settings & themes                   | yes                        | E2EE                        | Only prefs marked `sync: e2ee` in the schema are eligible. `sync: none` prefs (device-local secrets, sync configuration itself) are never uploaded. |
| Workspaces                          | yes                        | E2EE                        | Metadata + tab sets.                                                                                                                                |
| Passwords                           | yes (**opt-in, separate**) | E2EE, separate key wrapping | Requires the manager to be unlocked; see `threat-models/PASSWORD-MANAGER.md`.                                                                       |
| Extension metadata                  | later                      | E2EE                        | Installed-extension identity, not content.                                                                                                          |
| Autofill form data                  | later                      | E2EE                        | Treated like passwords for sensitivity.                                                                                                             |
| Browsing history of private windows | **never**                  | -                           | Private-window data is not persisted locally by design, so there is nothing to sync.                                                                |

## Cryptography (planned, reviewed libraries only)

| Purpose                                 | Primitive                                                                                                     | Rationale                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Content encryption                      | AEAD (e.g. XChaCha20-Poly1305 or AES-256-GCM) from a vetted library                                           | Authenticated encryption prevents silent tampering of synced data |
| Key derivation from the master password | Memory-hard KDF (Argon2id) with per-account salt                                                              | Slows offline guessing if the server is compromised               |
| Device key wrapping                     | AEAD with a key stored in OS secure storage (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux) | "Something the device has" without inventing a new scheme         |
| Randomness                              | OS CSPRNG only                                                                                                | No custom PRNGs, ever                                             |
| Recovery                                | High-entropy recovery key, wrapped and displayed under an explicit confirmation flow                          | Recovery without weakening the master secret                      |

Libraries are pinned (lockfile + version) and reviewed before introduction. No
cryptographic code is written by this project beyond wiring these libraries
together.

## Key hierarchy

```
master password ──(Argon2id, per-account salt)──> master key
master key ──(HKDF, per-purpose info)──> data keys (bookmarks, history, ...)
master key ──(AEAD wrap)──> device key (protected by DPAPI / Keychain)
recovery key ──(AEAD wrap of master key)──> escrowed recovery blob
```

Rationale: one secret the user knows, distinct keys per purpose (so a leak in
one class does not decrypt another), and device-local unwrapping so a stolen
server database is useless without the password _and_ a wrapped blob.

Server-side, the account is identified by a public key fingerprint and an opaque
blob namespace. The server must not need to understand any payload to operate.

## Metadata leakage (documented, not hidden)

Even with perfect E2EE the server can observe:

- account existence and authentication events;
- blob counts and sizes per data class (approximate activity: "this account has
  4,000 bookmark records");
- timestamps of updates (when a device is active);
- device count and coarse platform information;
- IP addresses, unless the deployment adds a proxy.

Mitigations: padding to size buckets, batch uploads on a schedule rather than per
event, and avoiding user-identifying names in blob keys. Residual leakage is
listed explicitly in `threat-models/SYNC.md` — we do not claim "the server learns
nothing".

## Reference backend: Supabase (conditional)

Supabase's free tier is the preferred starting point _if_ its current terms
allow it without a payment card and with acceptable data handling. This has
**not** been verified yet; it is a milestone task, not an assumption. Until then:

- the provider is `none`;
- nothing in the product depends on Supabase;
- the adapter interface is designed so a self-hosted Postgres object store (or
  any other backend) can implement it without touching the crypto layer.

Never commit: service-role keys, project secrets, or database credentials. The
client must use only public anon endpoints plus row-level security, or an
explicitly designed self-hosted API. A service-role key in a browser build would
be a catastrophic vulnerability; the absence of one is enforced by review and by
the secret scanner.

## Conflict handling

Sync is eventually consistent. Rules:

- per-record last-writer-wins with a logical clock, plus tombstones for deletes
  (so a delete on one device is not resurrected by another);
- structural data (bookmarks, workspaces) merges by record id, not by index, so
  two devices editing different folders cannot clobber each other;
- passwords: see the password threat model (a conflict is a decision the user
  must see, never a silent overwrite).

## Account lifecycle

| Flow                 | Behaviour                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign up              | email/password initially; Google and Apple providers later, subject to credentials actually existing; passkeys where the provider permits                     |
| Sign in              | unwraps device key, or asks for the master password on a new device                                                                                           |
| Sign out             | removes device keys and cached ciphertext locally; cloud data remains until deleted                                                                           |
| Password change      | re-wraps the master key; data blobs are not re-encrypted                                                                                                      |
| Account deletion     | deletes cloud blobs, then the account; local data is untouched unless the user asks for that too; deletion is verified by the client and reported to the user |
| Lost master password | recovery key flow; without either, data is unrecoverable _by design_                                                                                          |

## What must be tested before sync ships

- cryptographic boundary tests: ciphertext leaves the device; plaintext never
  does (including error paths and logs);
- wrong-key and tampered-ciphertext rejection;
- recovery-key round trip;
- account deletion actually removes server-side blobs;
- sync-off performs zero network requests;
- a malicious server cannot cause a client to execute or render unsanitised
  content from a sync payload (payloads are decoded with a schema, not `eval`).
