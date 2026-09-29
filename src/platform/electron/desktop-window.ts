import type { DesktopWindowAdapter } from '../types';

type FetchCommand = (input: string, init: RequestInit) => Promise<Response>;

/**
 * File > Exit and Help > Open Data Folder (ADR-554), through the same-origin
 * routes electron/desktop-window-commands.ts serves. A page's own
 * window.close() would skip the unsaved-changes question and the job Abort
 * handoff, so Exit asks the main process to quit instead.
 */
export function createDesktopWindowCommands(
  fetchCommand: FetchCommand = (input, init) => fetch(input, init),
): DesktopWindowAdapter {
  const post = (path: string) =>
    fetchCommand(path, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'X-KerfDesk-Desktop': '1' },
    });
  return {
    exit: async () => {
      const response = await post('./api/desktop/exit');
      if (!response.ok) throw new Error(`KerfDesk could not be closed (${response.status}).`);
    },
    openDataFolder: async () => {
      const response = await post('./api/desktop/data-folder');
      if (response.ok) return;
      const folder = await response.json().then(
        (body: unknown) => (isFolderReply(body) ? body.folder : null),
        () => null,
      );
      throw new Error(
        folder === null
          ? `The data folder could not be opened (${response.status}).`
          : `The data folder could not be opened. It is ${folder}`,
      );
    },
  };
}

function isFolderReply(body: unknown): body is { readonly folder: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { folder?: unknown }).folder === 'string'
  );
}
