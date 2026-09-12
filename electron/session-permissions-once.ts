/** Session hooks outlive a BrowserWindow (notably macOS close and reopen). */
export function sessionPermissionsOnce<T extends object>(install: (session: T) => void) {
  const installed = new WeakSet<T>();
  return (session: T): void => {
    if (installed.has(session)) return;
    install(session);
    installed.add(session);
  };
}
