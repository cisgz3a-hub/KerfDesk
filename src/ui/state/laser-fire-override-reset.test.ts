// Fire against a controller left at a raised power override, on the real
// store. The controller scales Fire's S by that override (GRBL
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c#L195,
// grblHAL
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/spindle_control.c#L867-L868),
// so a 200% left by a job doubled the capped power (controller audit P-2).
// The Ov: field of a status report must reach the press, and the reset byte
// must go out on its own, ahead of Fire-on, owing no acknowledgement.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';
import { useStore } from './store';

// 2% of S1000, at the profile's 1000 mm/min framing feed.
const FIRE_ON = 'G1 F1000 M3 S20\n';

let writes: string[];
let connection: FakeConnection;

beforeEach(async () => {
  writes = [];
  connection = makeConnection(async (data) => {
    writes.push(data);
  });
  useStore.setState({ project: createProject() });
  useStore.getState().updateDeviceProfile({
    capabilities: ['low-power-fire'],
    fireControl: { enabled: true, maxPowerPercent: 2 },
    maxPowerS: 1000,
    framingFeedMmPerMin: 1000,
  });
  useExperimentalLaserFeatures.getState().resetFeatures();
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
  await connectWith(connection);
  writes.length = 0;
});

afterEach(async () => {
  useLaserStore.setState({ fireActive: false });
  await useLaserStore.getState().disconnect();
  useExperimentalLaserFeatures.getState().resetFeatures();
  useStore.setState({ project: createProject() });
});

describe('Fire after a job left the power override raised (real store)', () => {
  it('resets a reported 200% power override before Fire-on, owing no ack for it', async () => {
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,200>');
    expect(useLaserStore.getState().ovCache).toEqual({ feed: 100, rapid: 100, spindle: 200 });

    await useLaserStore.getState().setFireActive(true);

    expect(writes).toEqual(['\x99', FIRE_ON]);
    // Only Fire-on is a line; the realtime byte is answered by nothing.
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().fireActive).toBe(true);
  });

  it('sends Fire-on alone to a controller reporting 100% power', async () => {
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');

    await useLaserStore.getState().setFireActive(true);

    expect(writes).toEqual([FIRE_ON]);
  });
});
