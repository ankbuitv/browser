# Threat model: optional cloud sync

Companion to [SYNC-ARCHITECTURE.md](../SYNC-ARCHITECTURE.md). Written **before**
implementation, as required, because the choices here are difficult to change
after data exists on a server.

**Status: design only. No sync code exists and nothing is uploaded anywhere.**

## Assets

| Asset                                     | Sensitivity | Notes                                                       |
| ----------------------------------------- | ----------- | ----------------------------------------------------------- |
| Bookmarks, workspaces, history, open tabs | High        | Reveal interests, relationships, health, politics, location |
| Saved passwords                           | Critical    | Direct account takeover if decrypted                        |
| Autofill data                             | High        | Addresses, payment-adjacent data                            |
| Settings and themes                       | Low         | Mostly cosmetic; still user data                            |
| Master key / master password              | Critical    | Decrypts everything synced                                  |
| Recovery key                              | Critical    | Equivalent to the master key                                |
| Device keys                               | Critical    | Unwrap blobs on one device                                  |
| Sync metadata (timestamps, sizes)         | Medium      | Reveals activity patterns                                   |

## Adversaries and mitigations

### A1. Curious or compromised server operator

_Capability:_ full read access to stored blobs, can modify them, can log
everything the API sees.

_Mitigations:_

- payloads are encrypted client-side with AEAD before upload; the server never
  receives plaintext or keys;
- keys are derived from the master password with a memory-hard KDF and never
  transmitted;
- device keys are wrapped locally (DPAPI/Keychain) and uploaded only as wrapped
  ciphertext;
- the client authenticates payload integrity, so a tampered blob is rejected
  rather than silently accepted;
- **residual risk:** metadata (account existence, blob counts, sizes, timing,
  IP) is visible. Padding and batching reduce but do not eliminate this. This is
  documented rather than denied.

### A2. Malicious client-side modification of stored data

_Capability:_ a server can rewrite stored ciphertext or replay old versions.

_Mitigations:_ AEAD authentication tags; per-record versioning and tombstones
with logical clocks so replay is detected or harmless; clients treat decrypt
failures as errors, never as "use as-is".

### A3. Offline attack after a database breach

_Capability:_ attacker holds ciphertext and tries guesses against the master
password.

_Mitigations:_ memory-hard KDF (Argon2id) with a per-account salt; a strong
master password requirement with an honest strength meter; per-purpose key
separation via HKDF so one leaked data key does not decrypt other classes.

_Residual risk:_ a weak master password plus stolen ciphertext is still
attackable. The UI must not overstate safety here.

### A4. Account takeover (credential stuffing, provider compromise)

_Capability:_ attacker can authenticate as the user to the sync service.

_Mitigations:_ the server holds no plaintext and no unwrapped keys, so an
account takeover yields ciphertext only; a new device requires the master
password (or recovery key), which the attacker does not have; sign-in providers
are optional and never the only factor for decrypting data.

### A5. Malicious extension

_Capability:_ extension APIs, potentially including reading pages and
manipulating downloads.

_Mitigations:_ sync data is not exposed through extension APIs; the master key
is never readable by an extension; extension access to history/bookmarks is
permission-gated and prompts the user; enterprise policy can block extensions.

### A6. Local malware with the user's privileges

_Capability:_ can read files, memory and process data.

_Mitigations:_ OS-backed key protection raises the bar (DPAPI/Keychain), but
**local malware running as the user can eventually read decrypted data.** This
is stated plainly: client-side encryption protects data at rest on a server, not
a compromised client.

### A7. Malicious sync payload attempting code execution

_Capability:_ a hostile server or a crafted payload tries to make the client
execute or render attacker-controlled content.

_Mitigations:_ payloads are parsed with a schema and validated; no `eval`, no
HTML injection, no dynamic import from payload data; strings that end up in the
UI are inserted as text nodes; the browser-UI CSP applies as usual.

### A8. Sign-out and deletion are not really honoured

_Capability:_ user believes data is gone; it is not.

_Mitigations:_ sign-out removes device keys and local ciphertext; account
deletion deletes cloud blobs and the account, and the client _verifies_ the
deletion by attempting to read the namespace afterwards and reporting the
result. Deletion is a tested path, not a promise.

## Trust boundaries

```
[device] plaintext  ──AEAD──>  ciphertext  ──HTTPS──>  [server blob store]
   ^                                                       |
   |                                                       |
 keys (never leave the device unwrapped)              metadata visible
```

The client trusts: the OS CSPRNG, the OS key store, the pinned crypto library,
and its own code. It does **not** trust the server, the network, or any payload
it did not decrypt and validate.

## Explicitly out of scope

- Protecting against a compromised operating system or a hardware attacker with
  physical access to an unlocked device.
- Hiding the _existence_ of a sync account from a network observer.
- Deniability (this is not implemented, and it must not be implied).

## Requirements this imposes on implementation

1. No plaintext password, bookmark, history entry, tab title or setting value may
   appear in a request body, URL, header or log. Enforced by tests.
2. Keys are generated with the OS CSPRNG and never derived from low-entropy
   inputs.
3. Crypto library versions are pinned and reviewed before use; no home-grown
   primitives.
4. Sync-off must produce zero sync-related network requests (tested).
5. Every claim in this document needs a test before sync ships, or the claim
   must be removed from the user-facing documentation.
