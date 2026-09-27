// A phone as the overhead camera (ADR-448). A phone browser cannot stream to
// KerfDesk without a server in between, and a page on the local network is
// not a secure context, so the phone runs a camera app that serves pictures
// on the local network instead, and KerfDesk Desktop reads them through its
// camera bridge like a laser's built-in camera. This turns what the app shows
// on the phone's screen into the address KerfDesk fetches. A stream (rtsp)
// address belongs in the RTSP camera section, which already reads those.

import { cameraSourceIdWithoutCredentials } from '../../core/camera/camera-capture-binding';

export type PhoneCameraApp = 'ip-webcam' | 'other';

// IP Webcam (Android) serves a full-size still at /shot.jpg on port 8080.
const IP_WEBCAM_PORT = 8080;
const IP_WEBCAM_STILL_PATH = '/shot.jpg';

export type PhoneCameraAddress =
  | { readonly kind: 'snapshot'; readonly url: string }
  | { readonly kind: 'invalid'; readonly message: string };

/**
 * The camera address for `typed`: for IP Webcam the phone's address as the
 * app shows it (`192.168.1.50`, `192.168.1.50:8080` or `http://…`); for any
 * other app the full address of its still picture (http).
 */
export function phoneCameraAddress(app: PhoneCameraApp, typed: string): PhoneCameraAddress {
  const text = typed.trim();
  if (text === '') return { kind: 'invalid', message: 'Enter the address the app shows.' };
  return app === 'ip-webcam' ? ipWebcamAddress(text) : otherAppAddress(text);
}

function ipWebcamAddress(text: string): PhoneCameraAddress {
  const input = /^[a-z]+:\/\//i.test(text) ? text : `http://${text}`;
  const url = parsed(input);
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return {
      kind: 'invalid',
      message: 'Enter the address IP Webcam shows, like 192.168.1.50:8080.',
    };
  }
  // Keeps a login typed as user:password@ (IP Webcam can ask for one).
  // URL normalizes explicit :80/:443 away; only a genuinely omitted port
  // should select IP Webcam's default.
  const authority = input.match(/^[a-z]+:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (url.port === '' && !/:\d+$/.test(authority)) url.port = String(IP_WEBCAM_PORT);
  url.pathname = IP_WEBCAM_STILL_PATH;
  url.search = '';
  url.hash = '';
  return { kind: 'snapshot', url: url.toString() };
}

function otherAppAddress(text: string): PhoneCameraAddress {
  const url = parsed(text);
  if (url?.protocol === 'http:' || url?.protocol === 'https:')
    return { kind: 'snapshot', url: text };
  if (url?.protocol === 'rtsp:') {
    return {
      kind: 'invalid',
      message: 'That is a video stream address. Paste it under RTSP camera… instead.',
    };
  }
  return {
    kind: 'invalid',
    message: 'Enter the full picture address from the app, starting with http://.',
  };
}

/** The picture address for `typed`, or null when it cannot be used. */
export function phoneSnapshotUrl(app: PhoneCameraApp, typed: string): string | null {
  const address = phoneCameraAddress(app, typed);
  return address.kind === 'snapshot' ? address.url : null;
}

/** Remember only the public address, as for RTSP; query/fragment can hold secrets. */
export function phoneCameraAddressWithoutLogin(typed: string): string {
  const text = typed.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const input = hasScheme ? text : `http://${text}`;
  let safe = cameraSourceIdWithoutCredentials(input);
  // Retain an explicitly selected standard port across reconnects. Otherwise
  // URL normalization would turn :80 into an omitted port, selecting 8080.
  const defaultPort = /^http:\/\/[^/?#]*:80(?=[/?#]|$)/i.test(input)
    ? '80'
    : /^https:\/\/[^/?#]*:443(?=[/?#]|$)/i.test(input)
      ? '443'
      : undefined;
  if (defaultPort !== undefined && parsed(input) !== null) {
    safe = safe.replace(/^(https?:\/\/[^/?#]+)/, `$1:${defaultPort}`);
  }
  if (hasScheme) return safe;
  const bare = safe.replace(/^http:\/\//, '');
  return text.includes('/') ? bare : bare.replace(/\/$/, '');
}

function parsed(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
