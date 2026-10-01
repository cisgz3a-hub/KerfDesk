export type WindowsDesktopDownload =
  | {
      readonly status: 'ready';
      readonly version: string;
      readonly url: string;
      readonly fileName: string;
      readonly sha256: string;
      readonly bytes: number;
      readonly publishedAt: string;
      readonly codeSigning: 'signed' | 'unsigned';
      readonly updates: 'automatic' | 'manual';
    }
  | { readonly status: 'unavailable'; readonly reason: 'not-released' }
  | {
      readonly status: 'error';
      readonly reason: 'network' | 'timeout' | 'invalid-release' | 'aborted';
    };

export function resolveWindowsDesktopDownload(options?: {
  readonly signal?: AbortSignal;
  readonly fetchRequest?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<WindowsDesktopDownload>;
