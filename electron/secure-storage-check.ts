export type CheckedStorage = {
  readonly isAsyncEncryptionAvailable: () => Promise<boolean>;
  readonly encryptStringAsync: (value: string) => Promise<Buffer>;
};

/**
 * Linux keeps a credential only under a keyring's key, never the fallback key
 * that is the same on every computer. Electron's async safeStorage picks its key
 * once per process (Chromium os_crypt_async) and prefixes each ciphertext with
 * that provider's tag: v11 is a Secret Service or KWallet, v12 the desktop
 * portal, v10 the fallback. Neither the selected backend name, which reflects
 * only the desktop or --password-store, nor async availability, which the
 * fallback always satisfies, says which key is in use, so a probe's tag decides.
 * Without a keyring, nothing can be saved until one runs and KerfDesk restarts.
 */
const LINUX_KEYRING_TAGS = new Set(['v11', 'v12']);
const LINUX_KEYRING_PROBE = 'kerfdesk-keyring-probe';

/** Whether OS encryption is available and, on Linux, sealed under a keyring's key. */
export function createSecureStorageCheck(
  storage: CheckedStorage,
  platform: string,
): () => Promise<boolean> {
  // The key is fixed for the process, so one answer holds until a restart; a
  // probe that fails outright is asked again next time.
  let keyring: Promise<boolean> | null = null;
  const linuxKeyring = (): Promise<boolean> =>
    (keyring ??= storage.encryptStringAsync(LINUX_KEYRING_PROBE).then(
      (sealed) => LINUX_KEYRING_TAGS.has(sealed.subarray(0, 3).toString('latin1')),
      () => {
        keyring = null;
        return false;
      },
    ));
  return async () =>
    (await storage.isAsyncEncryptionAvailable()) &&
    (platform !== 'linux' || (await linuxKeyring()));
}
