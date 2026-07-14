import { describe, expect, it } from 'vitest';
import { localCameraBridgeAvailable } from './camera-platform-capability';

describe('localCameraBridgeAvailable', () => {
  it('allows Desktop and local web development', () => {
    expect(localCameraBridgeAvailable('electron', 'laserforge-2fj.pages.dev')).toBe(true);
    expect(localCameraBridgeAvailable('mock', 'example.test')).toBe(true);
    expect(localCameraBridgeAvailable('web', 'localhost')).toBe(true);
    expect(localCameraBridgeAvailable('web', '127.0.0.1')).toBe(true);
    expect(localCameraBridgeAvailable('web', '[::1]')).toBe(true);
  });

  it('does not expose a dead local-bridge action on hosted web', () => {
    expect(localCameraBridgeAvailable('web', 'laserforge-2fj.pages.dev')).toBe(false);
    expect(localCameraBridgeAvailable('web', 'app.kerfdesk.com')).toBe(false);
  });
});
