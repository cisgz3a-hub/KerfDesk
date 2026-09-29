// Asks the browser to keep KerfDesk's local storage. Autosave snapshots, the
// page-backed sources of large PNGs (ADR-283) and Recent Projects live in
// IndexedDB, and material libraries in localStorage. Left "best-effort", the
// browser may evict all of it under storage pressure; persist() asks it not to
// (https://storage.spec.whatwg.org/#dom-storagemanager-persist).
//
// Firefox answers persist() with a permission prompt, so it is never asked at
// launch (WORKFLOW.md F-A1). It is asked once per page session, after the first
// project save the operator makes themselves: the moment their work shows it is
// worth keeping. Chromium decides silently from its own heuristics, and the
// desktop build's permission policy denies it, so there the call is harmless.
// A denial or an error leaves things exactly as they were, so both are ignored,
// and the save never waits for the answer.

// Older browsers lack the StorageManager, and the spec exposes it only to
// secure contexts, so neither member can be relied on.
type MaybeStorageManager = Partial<Pick<StorageManager, 'persist' | 'persisted'>>;

let asked = false;

/** Fire and forget after a save; it returns at once and never throws. */
export function requestPersistentStorageOnce(): void {
  if (asked) return;
  // Claimed before the browser answers, so a second save meanwhile cannot ask twice.
  asked = true;
  void askToPersist().catch(() => undefined);
}

async function askToPersist(): Promise<void> {
  const storage = navigator.storage as MaybeStorageManager | undefined;
  if (storage?.persist === undefined || storage.persisted === undefined) return;
  if (await storage.persisted()) return;
  await storage.persist();
}
