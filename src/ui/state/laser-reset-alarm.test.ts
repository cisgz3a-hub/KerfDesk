// Controller audit streaming-4: GRBL prints `ALARM:3` for an Abort during
// motion BEFORE its reboot banner, and the banner handler used to erase it.
// The code now survives a banner only when the reset itself raised it, and a
// non-Alarm status clears a code whatever unlocked the controller.

import { describe, expect, it } from 'vitest';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { teardownConnectionRefs } from './laser-connection-teardown';
import type { LiveRefs } from './laser-store';

const BANNER = "Grbl 1.1f ['$' for help]";
const ALARM_STATUS = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';
const IDLE_STATUS = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';

function feed(lines: ReadonlyArray<string>) {
  const harness = makeLineHandlerHarness();
  for (const line of lines) {
    handleLine(harness.set, harness.get, harness.refs, async () => undefined, line);
  }
  return harness;
}

describe('alarm code across a controller reset', () => {
  it('keeps the ALARM:3 an Abort during motion raised, in firmware order', () => {
    const { get } = feed(['ALARM:3', BANNER, "[MSG:'$H'|'$X' to unlock]", ALARM_STATUS]);
    expect(get().alarmCode).toBe(3);
  });

  it('keeps it when the interrupted line is acknowledged between the alarm and the banner', () => {
    const { get } = feed(['ALARM:3', 'ok', BANNER]);
    expect(get().alarmCode).toBe(3);
  });

  it('starts clean after a banner that follows a status report', () => {
    // Hard limit, status polls, then the reset that clears the critical lock:
    // the reboot is not what raised ALARM:1.
    const { get } = feed(['ALARM:1', ALARM_STATUS, BANNER]);
    expect(get().alarmCode).toBeNull();
  });

  it('keeps the code for one banner only', () => {
    const { get } = feed(['ALARM:3', BANNER, BANNER]);
    expect(get().alarmCode).toBeNull();
  });

  it('starts clean on an ordinary reboot', () => {
    const { get } = feed([BANNER]);
    expect(get().alarmCode).toBeNull();
  });

  it('clears a code once the controller reports a non-Alarm state', () => {
    // An unlock from a pendant or another sender never passes through $X here.
    const harness = feed(['ALARM:3', BANNER, ALARM_STATUS]);
    expect(harness.get().alarmCode).toBe(3);
    handleLine(harness.set, harness.get, harness.refs, async () => undefined, IDLE_STATUS);
    expect(harness.get().alarmCode).toBeNull();
  });

  it('forgets an alarm when the connection is torn down', () => {
    const harness = feed(['ALARM:3']);
    teardownConnectionRefs(harness.refs as unknown as LiveRefs);
    handleLine(harness.set, harness.get, harness.refs, async () => undefined, BANNER);
    expect(harness.get().alarmCode).toBeNull();
  });
});
