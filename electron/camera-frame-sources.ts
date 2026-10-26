// The camera frame sources KerfDesk's window registered with the bridge
// (rolling audit v2 04-P2-1, ADR-141 Amendment 2). A camera address can hold
// its login, so it reaches the bridge once, in a POST body, and the window's
// <img> and fetch requests for frames name it by a random id instead. An id
// means nothing outside this run of the bridge.

import { randomUUID } from 'node:crypto';

// A session registers a handful (machine camera, phone, RTSP stills); the
// oldest goes first beyond this, as a camera not used for that long would.
const MAX_FRAME_SOURCES = 32;

export class CameraFrameSources {
  // Oldest first: a registration moves its entry to the end.
  private readonly urls = new Map<string, string>();

  constructor(private readonly createId: () => string = randomUUID) {}

  /** The id for `cameraUrl`: the one it was given before, or a new one. */
  register(cameraUrl: string): string {
    for (const [id, url] of this.urls) {
      if (url !== cameraUrl) continue;
      this.urls.delete(id);
      this.urls.set(id, url);
      return id;
    }
    if (this.urls.size >= MAX_FRAME_SOURCES) {
      const oldest = this.urls.keys().next();
      if (oldest.done !== true) this.urls.delete(oldest.value);
    }
    const id = this.createId();
    this.urls.set(id, cameraUrl);
    return id;
  }

  /** The camera address registered as `id`, if it is still known. */
  cameraUrl(id: string): string | undefined {
    return this.urls.get(id);
  }
}
