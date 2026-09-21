// Test stub for the PWA plugin's virtual module.
//
// `virtual:pwa-register/react` only exists while vite-plugin-pwa is in the
// pipeline. Vitest's Windows module runner cannot turn that virtual id into a
// file path, so on a Windows checkout every suite that transitively imports
// PwaUpdateWatcher fails at COLLECTION — no assertion runs, and the failure
// reads like a crash rather than a missing module. It is invisible on the
// Ubuntu CI lane and only bites the windows-latest jobs (the desktop dry run),
// where it failed three camera suites that have nothing to do with the PWA.
//
// vitest.config.ts aliases the virtual id here so the resolution exists for
// every suite. A test that actually cares about update behaviour still calls
// vi.mock on the same id, which takes precedence over this alias.
export function useRegisterSW(): {
  offlineReady: [boolean, (value: boolean) => void];
  needRefresh: [boolean, (value: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  return {
    offlineReady: [false, () => undefined],
    needRefresh: [false, () => undefined],
    updateServiceWorker: async () => undefined,
  };
}
