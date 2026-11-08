## ADR-688 Amendment 1 - Recover unsaved work lists each session once, with its newest copy, and a restore never clears a newer copy (2026-11-08)

**Status:** Accepted; unit evidence with the real autosave service, fake IndexedDB and a shared
Web Locks manager, and a Chrome e2e run against the dev server. | **Date:** 2026-11-08

Follows rolling audit v10 finding V7-P1-1 (P1, lost work), confirmed by an independent refuter
(`docs/audits/2026-11-07-rolling-v10/V7-fix-design-burn-safety.md`). Amends Decision 3.

### Context

- A tab that closes with unsaved work leaves two copies under one storage key: the 30-second
  interval copy in IndexedDB and a newer copy that `beforeunload` writes to localStorage
  (`use-autosave.ts`). The desktop app closes through the same renderer `beforeunload` after its
  own close question (ADR-549), and Electron keeps localStorage, so it leaves the same pair.
- Decision 3's `readRecent()` returned copies, not slots. File > Recover unsaved work showed the
  pair as two rows that read as two sessions.
- Restoring the older row cleared the source by key. `clearAutosave` removed the localStorage key
  with no check of what it held, so the newer copy went for good: every edit after the last
  interval write. The interval does not write while a job streams, so that can be a whole burn's
  worth of edits. Startup recovery offered only the newest copy, so 1.0.29 never reached this.

### Decision

1. **One row per session.** The durable read keeps one snapshot per storage key, the newest by
   `savedAt` among the readable copies. Startup recovery and File > Recover unsaved work both use
   that read, so they offer the same copy. An unreadable copy is still reported and retired as
   before, so a readable older copy stays reachable when the newer one is damaged.
2. **A restore or discard clears only what it supersedes.** A kept localStorage copy carries the
   epoch of the IndexedDB slot the read saw, so that slot is cleared only if it is still the
   older copy (the existing compare-on-epoch clear). The localStorage copy at the key is removed
   only when its `savedAt` is not newer than the snapshot being restored or discarded. A newer
   copy stays in place and is listed again.
3. **Older copies of a session go with it.** Restoring or discarding a session's newest copy
   clears its older copy, as startup recovery already did. The older copy is an earlier state of
   the same document, and the restored work is re-homed into this window's slot before anything
   is cleared (ADR-305 decision 5, M15).

### Consequences

- A closed session's work is one row, and no Restore in the list can delete newer work.
- Decision 3's "slots are removed only by Restore, Don't Save or unreadable retirement" now holds
  per slot, not only per key.
- The dialog's rows are keyed by storage key alone.
- No change to the autosave format, the interval, the unload write, burns, G-code or licensing.
