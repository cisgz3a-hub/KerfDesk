/** One window owns the desktop; OS file opens can arrive before startup or during quit. */
export function createDesktopWindowReopener(options: {
  readonly isReady: () => boolean;
  readonly isQuitting: () => boolean;
  readonly hasWindow: () => boolean;
  readonly createWindow: () => Promise<void>;
  readonly onError: (error: unknown) => void;
}): () => void {
  let pending = false;
  return () => {
    if (!options.isReady() || options.isQuitting() || options.hasWindow() || pending) return;
    pending = true;
    void Promise.resolve()
      .then(() => {
        // Quit or another window can win between the OS event and this microtask.
        if (!options.isReady() || options.isQuitting() || options.hasWindow()) return;
        return options.createWindow();
      })
      .catch(options.onError)
      .finally(() => {
        pending = false;
      });
  };
}
