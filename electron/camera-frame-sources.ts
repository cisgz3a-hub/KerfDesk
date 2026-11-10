// The camera frame sources KerfDesk's window registered with the bridge
// (rolling audit v2 04-P2-1, ADR-141 Amendment 2). A camera address can hold
// its login, so it reaches the bridge once, in a POST body, and the window's
// <img> and fetch requests for frames name it by a random id instead. An id
// means nothing outside this run of the bridge.

import { randomUUID } from 'node:crypto';

/** Why a camera gave no picture; `login` when it asked for a login it did not get. */
export type CameraFrameFailure = {
  readonly reason: string;
  readonly login?: 'needed' | 'refused' | 'unsupported';
};

// After a failed picture the camera is left alone for a while, longer each
// time, so the several views polling it never hammer a camera that is off or
// locked (ADR-692 Amendment 1). A login problem holds until the camera is
// connected again: retrying a refused login only risks locking the camera.
const FIRST_RETRY_MS = 1000;
const LONGEST_RETRY_MS = 16_000;

type Health = CameraFrameFailure & { readonly failures: number; readonly retryAt: number };

// A session registers a handful (machine camera, phone, RTSP stills); the
// oldest goes first beyond this, as a camera not used for that long would.
const MAX_FRAME_SOURCES = 32;

export class CameraFrameSources {
  // Oldest first: a registration moves its entry to the end.
  private readonly urls = new Map<string, string>();
  private readonly health = new Map<string, Health>();

  constructor(
    private readonly createId: () => string = randomUUID,
    private readonly now: () => number = Date.now,
  ) {}

  /** The id for `cameraUrl`: the one it was given before, or a new one. */
  register(cameraUrl: string): string {
    for (const [id, url] of this.urls) {
      if (url !== cameraUrl) continue;
      this.urls.delete(id);
      this.urls.set(id, url);
      // Connecting again is the operator's go-ahead to ask the camera again.
      this.health.delete(id);
      return id;
    }
    if (this.urls.size >= MAX_FRAME_SOURCES) {
      const oldest = this.urls.keys().next();
      if (oldest.done !== true) {
        this.urls.delete(oldest.value);
        this.health.delete(oldest.value);
      }
    }
    const id = this.createId();
    this.urls.set(id, cameraUrl);
    return id;
  }

  /** The camera address registered as `id`, if it is still known. */
  cameraUrl(id: string): string | undefined {
    return this.urls.get(id);
  }

  /** The last failure, while `id`'s camera is left alone; null when it may be asked. */
  heldBack(id: string): CameraFrameFailure | null {
    const health = this.health.get(id);
    if (health === undefined) return null;
    if (health.login !== undefined || this.now() < health.retryAt) {
      return health.login === undefined
        ? { reason: health.reason }
        : { reason: health.reason, login: health.login };
    }
    return null;
  }

  /** Note how asking `id`'s camera went: null for a picture, else why not. */
  noteFrame(id: string, failure: CameraFrameFailure | null): void {
    if (failure === null) {
      this.health.delete(id);
      return;
    }
    const failures = (this.health.get(id)?.failures ?? 0) + 1;
    const wait = Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** (failures - 1));
    this.health.set(id, { ...failure, failures, retryAt: this.now() + wait });
  }
}
