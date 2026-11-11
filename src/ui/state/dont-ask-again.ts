// "Don't ask again" answers for in-app confirms (ADR-707). A caller opts in
// with a stable key; ticking the box and answering yes stores it here, and the
// same question is then answered yes without being shown.
//
// Storage can be missing, full or blocked (a private window, a locked-down
// profile), so every read and write is guarded: a failure means the question
// is simply asked again.

const KEY_PREFIX = 'kerfdesk.dont-ask-again.v1.';

export function dontAskAgainIsSet(key: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

export function rememberDontAskAgain(key: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + key, '1');
  } catch {
    // Not remembered: the question comes back next time.
  }
}

/** Brings the question for `key` back, or every remembered question. */
export function forgetDontAskAgain(key?: string): void {
  try {
    if (key !== undefined) {
      localStorage.removeItem(KEY_PREFIX + key);
      return;
    }
    const stored: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const name = localStorage.key(index);
      if (name !== null && name.startsWith(KEY_PREFIX)) stored.push(name);
    }
    for (const name of stored) localStorage.removeItem(name);
  } catch {
    // Nothing was readable, so nothing is remembered.
  }
}
