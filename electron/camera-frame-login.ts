// The login side of the bridge's snapshot fetch (ADR-448, ADR-692 Amendment 1).
// The first request to a camera carries no login; only a camera that answers
// 401 gets one, in the strongest form it offers (camera-login-answer.ts). Once
// a camera has asked, later pictures carry the same answer, so a camera that
// polls twice a second is not asked again for each one.

import {
  cameraLogin,
  loginAnswer,
  loginChallenges,
  type LoginAnswer,
} from './camera-login-answer.js';

export type CameraLoginProblem = 'needed' | 'refused' | 'unsupported';

export type CameraLoginFetch =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'login'; readonly problem: CameraLoginProblem };

export const CAMERA_LOGIN_REASONS: Readonly<Record<CameraLoginProblem, string>> = {
  needed:
    'The camera asks for a user name and password. Add them to the address, like http://user:password@192.168.1.50:8080/shot.jpg.',
  refused: 'The camera refused the user name or password in the address.',
  unsupported: 'The camera asks for its login in a form KerfDesk does not send.',
};

// A handful of cameras per run; the oldest answer goes first beyond this.
const MAX_ANSWERS = 32;
const answers = new Map<string, LoginAnswer>();

/** Forget how `cameraUrl` was answered, so the next picture asks again. */
export function forgetCameraFrameLogin(cameraUrl: string): void {
  answers.delete(cameraUrl);
}

/** GET a camera picture, logging in only when the camera asks for it. */
export async function fetchWithCameraLogin(
  cameraUrl: string,
  signal: AbortSignal,
): Promise<CameraLoginFetch> {
  const target = new URL(cameraUrl);
  const login = cameraLogin(target);
  target.username = '';
  target.password = '';
  const uri = `${target.pathname}${target.search}`;
  // redirect: 'error' — a compromised private device must not be able to
  // bounce the proxy to a public URL (SSRF hardening).
  const get = (authorization: string | undefined): Promise<Response> =>
    fetch(target.toString(), {
      signal,
      redirect: 'error',
      ...(authorization === undefined ? {} : { headers: { Authorization: authorization } }),
    });
  const kept = login === null ? undefined : answers.get(cameraUrl);
  const first = await get(kept?.header('GET', uri));
  if (first.status !== 401) return { kind: 'response', response: first };
  await first.body?.cancel().catch(() => undefined);
  if (login === null) return { kind: 'login', problem: 'needed' };
  const challenges = loginChallenges(challengeValues(first.headers));
  const answer = loginAnswer(challenges, login);
  if (answer === null) return { kind: 'login', problem: 'unsupported' };
  const second = await get(answer.header('GET', uri));
  if (second.status === 401) {
    answers.delete(cameraUrl);
    await second.body?.cancel().catch(() => undefined);
    return { kind: 'login', problem: 'refused' };
  }
  keepAnswer(cameraUrl, answer);
  return { kind: 'response', response: second };
}

function challengeValues(headers: Headers): string[] {
  const value = headers.get('www-authenticate');
  return value === null ? [] : [value];
}

function keepAnswer(cameraUrl: string, answer: LoginAnswer): void {
  answers.delete(cameraUrl);
  if (answers.size >= MAX_ANSWERS) {
    const oldest = answers.keys().next();
    if (oldest.done !== true) answers.delete(oldest.value);
  }
  answers.set(cameraUrl, answer);
}
