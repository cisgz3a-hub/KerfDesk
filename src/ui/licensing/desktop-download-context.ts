import { createContext } from 'react';

/** The view only needs a verified destination; the root supplies the resolver. */
export type DesktopDownloadResult =
  | {
      readonly status: 'ready';
      readonly version: string;
      readonly url: string;
      readonly fileName: string;
      readonly codeSigning: 'signed' | 'unsigned';
      readonly updates: 'automatic' | 'manual';
    }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' };

export const DesktopDownloadContext = createContext<
  (options: { readonly signal: AbortSignal }) => Promise<DesktopDownloadResult>
>(async () => ({ status: 'error' }));
