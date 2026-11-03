import { describe, expect, it } from 'vitest';
import { controllerRejectionText } from './controller-rejection-text';
import { controllerErrorMessage, controllerErrorNotice } from './laser-safety-notice';

// UX audit U2-P2-2: a beginner saw a bare "error:5" with advice to home again,
// in a notice that pointed at a "Laser Log" nothing in the app is called.
describe('controller rejection text', () => {
  it('explains a refused Home with homing off, with the switch caveat (U2-P3-9)', () => {
    const notice = controllerErrorNotice(5, 'command', undefined, '$H', 'grbl-v1.1');
    expect(notice).toMatchObject({ kind: 'controller-error', code: 5, homingOff: true });
    expect(notice.message).toContain('Home was refused: Homing cycle disabled (error:5).');
    expect(notice.message).toContain('Homing is turned off in the controller');
    expect(notice.message).toContain('the machine did not move');
    expect(notice.message).toContain('no homing switches, untick Enable Home in Machine Setup');
    expect(notice.message).toContain('$22=1; never turn it on for a machine without switches');
    expect(notice.message).not.toMatch(/home before continuing|Laser Log/);
  });

  it('decodes error:5 the same way on grblHAL, and FluidNC error:18 without $22', () => {
    expect(controllerErrorMessage(5, 'command', 'error:5', undefined, 'grblhal')).toContain(
      'Homing is turned off in the controller',
    );
    const fluidnc = controllerErrorMessage(18, 'command', 'error:18', undefined, 'fluidnc');
    expect(fluidnc).toContain('No Homing/Cycle defined in settings (error:18)');
    expect(fluidnc).toContain('in its configuration');
    expect(fluidnc).not.toContain('$22');
    // FluidNC's own error 5 is "Setting disabled", not homing.
    expect(controllerErrorNotice(5, 'command', 'error:5', undefined, 'fluidnc')).not.toHaveProperty(
      'homingOff',
    );
  });

  it('says what a refused jog means (error:15)', () => {
    const message = controllerErrorMessage(15, 'jog', 'error:15', '$J=G91 X100 F3000', 'grbl-v1.1');
    expect(message).toContain(
      'The controller rejected a jog command: Jog target exceeds travel (error:15).',
    );
    expect(message).toContain('nothing moved. Jog a shorter distance.');
    expect(message).toContain('Rejected line: $J=G91 X100 F3000');
  });

  // UX audit U5: the same notice met a refused Unlock and a refused setting
  // write, and told the operator to home, which did not apply to either.
  it('shows the reset advice for grblHAL error:79 and no homing advice for a $ command', () => {
    const unlock = controllerErrorMessage(79, 'command', 'error:79', '$X', 'grblhal');
    expect(unlock).toContain('Not allowed while critical event is active (error:79).');
    expect(unlock).toContain('Press Reset (Ctrl-X), then unlock or home.');
    expect(unlock).not.toContain('If the position is uncertain');
    const pwm = controllerErrorMessage(17, 'command', 'error:17', '$32=1', 'grbl-v1.1');
    expect(pwm).toContain('Laser mode needs PWM (error:17).');
    expect(pwm).not.toContain('home');
    expect(controllerErrorMessage(20, 'command', 'error:20', 'G38.2 Z-10')).toContain(
      'If the position is uncertain, home before continuing.',
    );
  });

  it('decodes an alarm in the reply as an alarm, not as an error code', () => {
    const message = controllerErrorMessage(
      2,
      'command',
      'Set origin failed: ALARM:2',
      'G10 L20 P1 X0 Y0',
      'grbl-v1.1',
    );
    expect(message).toContain(
      'The controller raised an alarm: G-code target exceeds machine travel (ALARM:2).',
    );
    expect(message).not.toContain('error:2');
  });

  it('decodes a code found only in the raw reply, and names the Console', () => {
    const message = controllerErrorMessage(null, 'command', 'Probe failed: error:9', undefined);
    expect(message).toContain('G-code lock (error:9)');
    expect(message).toContain('The Console shows every reply from the controller.');
  });

  it('keeps the job wording for a mid-job rejection and quotes a reply with no code', () => {
    expect(controllerErrorMessage(22, 'job')).toContain(
      'so the job was stopped: Undefined feed rate (error:22). G1/G2/G3 requires F to be set.',
    );
    expect(
      controllerRejectionText('marlin', null, 'Error:Line Number is not Last Line').reason,
    ).toBe('the reply “Error:Line Number is not Last Line”');
  });
});
