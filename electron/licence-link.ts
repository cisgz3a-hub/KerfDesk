// kerfdesk://licence opens Help > Licence (ADR-578). The purchase page's
// "Copy key & open KerfDesk" copies the key, then follows this link, so a buyer
// lands on the licence panel with the key already filled in.
//
// The link never carries a key or any other data: a key in a URL would reach
// browser history and operating-system logs (ADR-523). Exactly one form is
// accepted; anything else, including any query, is ignored. When the link opens
// the panel the main process reads the clipboard once and hands the renderer only
// a KerfDesk key it finds there, which still needs the owner's Activate click.

import { findLicenceKey } from '../public/licence-key-text.mjs';
import { revealPrimaryWindow, type PrimaryWindowTarget } from './single-instance-policy.js';

// Structural slices of Electron's App and BrowserWindow. Importing 'electron' here
// would pull its global DOM augmentations into the renderer type check, which
// reaches this file through licensing-routes.ts.
type LinkApp = {
  setAsDefaultProtocolClient(protocol: string): boolean;
  on(event: 'second-instance', listener: (event: unknown, argv: string[]) => void): unknown;
};
type LinkWindow = PrimaryWindowTarget & {
  isDestroyed(): boolean;
  readonly webContents: {
    getURL(): string;
    executeJavaScript(code: string): Promise<unknown>;
  };
};

export const LICENCE_LINK_SCHEME = 'kerfdesk';
/** Fixed, data-free signal; the renderer then asks the licence-link route itself. */
export const LICENCE_LINK_SIGNAL =
  "window.dispatchEvent(new CustomEvent('kerfdesk:licence-link')); undefined";

export type LicenceLinkAnswer = { readonly open: boolean; readonly licenseKey: string | null };
export type LicenceLink = { readonly consume: () => Promise<LicenceLinkAnswer> };

export function isLicenceLink(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 64) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === `${LICENCE_LINK_SCHEME}:` &&
      url.hostname === 'licence' &&
      ['', '/'].includes(url.pathname) &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '' &&
      url.port === ''
    );
  } catch {
    return false;
  }
}

export function licenceLinkInArgv(argv: ReadonlyArray<string>): boolean {
  return argv.some(isLicenceLink);
}

type Options = {
  /** Registration and handling only for a packaged, non-sandbox commercial Windows build. */
  readonly enabled: boolean;
  readonly argv: ReadonlyArray<string>;
  readonly readClipboard: () => string | Promise<string>;
  readonly primaryWindow: () => LinkWindow | undefined;
  readonly isTrustedRenderer: (url: string) => boolean;
};

/**
 * Registers kerfdesk:// for this user and remembers a link this launch, or a later
 * second launch, was given. `consume` answers once per link, so a reload never
 * reopens the panel.
 */
export function installLicenceLink(app: LinkApp, options: Options): LicenceLink | null {
  if (!options.enabled) return null;
  try {
    app.setAsDefaultProtocolClient(LICENCE_LINK_SCHEME);
  } catch (error) {
    console.warn('Could not register the kerfdesk:// link:', error);
  }
  let pending = licenceLinkInArgv(options.argv);
  app.on('second-instance', (_event, argv) => {
    if (!licenceLinkInArgv(argv)) return;
    pending = true;
    const primary = options.primaryWindow();
    if (primary === undefined || primary.isDestroyed()) return;
    revealPrimaryWindow(primary);
    const contents = primary.webContents;
    if (!options.isTrustedRenderer(contents.getURL())) return;
    contents.executeJavaScript(LICENCE_LINK_SIGNAL).catch(() => undefined);
  });
  return {
    consume: async () => {
      if (!pending) return { open: false, licenseKey: null };
      pending = false;
      let text = '';
      try {
        text = await options.readClipboard();
      } catch {
        text = '';
      }
      return { open: true, licenseKey: findLicenceKey(text) };
    },
  };
}
