// Audit HF-3 repro: grblHAL's critical alarms need a soft reset before any
// `$` recovery command, but KerfDesk's alarm guidance for ALARM:1 and ALARM:2
// points at `$H` / re-import and error:79 has no description.
//
// Upstream grblHAL core (d7aaee3d84b1e7010f075d395206afff038d7379):
// - alarms.h:73-80 alarm_is_critical(): HardLimit (1), SoftLimit (2), EStop (10),
//   MotorFault (17), ExpanderException (20).
// - protocol.c:467-514: on a critical alarm grblHAL prints
//   `[MSG:Reset to continue]` (Message_CriticalEvent, messages.c:28) and loops
//   until reset, still executing `$` lines through protocol_poll_cmd().
// - system.c:1179-1181: `if(sys.blocking_event && !cmd->commands[idx].flags.allow_blocking)
//   retval = Status_NotAllowedCriticalEvent;` — `$X`, `$H`, `$HX`… carry no
//   allow_blocking (system.c:990-1012), so they answer error:79
//   ("Not allowed while critical event is active.", errors.c).
//   https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L1179-L1181
//
// Correct behaviour: on grblHAL the ALARM:1/ALARM:2 recovery text says a
// soft reset comes first, and error:79 is described, so a refused Home or
// Unlock explains itself. Current code: alarm-codes.ts actions for 1 and 2 say
// "Re-home the machine ($H)…" / "Check the design fits the bed…", and
// error-codes.ts stops at 38.
import { describe, expect, it } from 'vitest';
import {
  presentAlarm,
  presentError,
} from '../../core/controllers/grbl/response-presentation';

describe('HF-3 grblHAL critical alarm guidance', () => {
  it.each([1, 2])('ALARM:%i recovery on grblHAL says a reset comes first', (code) => {
    const alarm = presentAlarm('grblhal', code);
    expect(alarm?.action ?? '').toMatch(/reset/i);
  });

  it('describes grblHAL error:79, the refusal $X and $H get during a critical event', () => {
    expect(presentError('grblhal', 79)).not.toBeNull();
  });
});
