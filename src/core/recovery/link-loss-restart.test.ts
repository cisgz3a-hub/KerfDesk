// ADR-398 Amendment 3: a lost link keeps its planner backlog aside until the
// first reconnect shows whether the controller restarted. The program is the
// rolling audit's repro (18-P2-1): sixty 20 mm cuts on stock GRBL, 40 lines
// acknowledged and 45 sent when the cable went, no `Bf` in the reports.

import { describe, expect, it } from 'vitest';
import { automaticRestart } from './automatic-restart-line';
import { parseOptionalJobInterruption, type JobInterruption } from './job-interruption';
import {
  awaitsLinkLossVerdict,
  recordControllerRestart,
  settleLinkLossRestart,
  type LinkLossRestartEvidence,
  type LinkLossRestartSign,
} from './link-loss-restart';

const GCODE = Array.from({ length: 60 }, (_, i) => `G1 X${i % 2 === 0 ? 0 : 20} Y${i} S800`).join(
  '\n',
);
const ACKED = 40;
const PLANNER_SIZE = { ackedAtStatus: ACKED, queuedBlocks: 15, bound: 'planner-size' } as const;
const LOST_LINK: JobInterruption = {
  kind: 'disconnect',
  message: 'USB connection was lost during an active job.',
  sentLines: 45,
  plannerBacklogIfRestarted: PLANNER_SIZE,
};

describe('a lost link before the reconnect', () => {
  it('restarts at the first unacknowledged line, as a controller that kept running needs', () => {
    expect(awaitsLinkLossVerdict(LOST_LINK)).toBe(true);
    expect(automaticRestart(GCODE, ACKED, LOST_LINK)).toEqual({
      line: 41,
      replaysRejectedLine: false,
    });
  });
});

const usb = (sign: LinkLossRestartSign): LinkLossRestartEvidence => ({ sign, link: 'usb' });
const network = (sign: LinkLossRestartSign): LinkLossRestartEvidence => ({
  sign,
  link: 'network',
});

describe('settleLinkLossRestart', () => {
  it.each(['boot-banner', 'alarm'] as const)(
    'steps back a whole planner when the reconnect shows a %s',
    (sign) => {
      const settled = settleLinkLossRestart(LOST_LINK, usb(sign));
      expect(settled).toMatchObject({
        kind: 'disconnect',
        sentLines: 45,
        plannerBacklog: PLANNER_SIZE,
      });
      expect(settled).not.toHaveProperty('plannerBacklogIfRestarted');
      expect(settled?.message).toContain('steps back');
      if (settled === null) throw new Error('Expected a settled interruption.');
      expect(awaitsLinkLossVerdict(settled)).toBe(false);
      // The 15 cuts the reset threw away, about 300 mm, are recut, not skipped.
      expect(automaticRestart(GCODE, ACKED, settled)).toEqual({
        line: 26,
        replaysRejectedLine: false,
        plannerBacklogBlocks: 15,
        plannerBacklogBasis: 'planner-size',
      });
    },
  );

  it('keeps the restart and the message when the controller kept running', () => {
    const settled = settleLinkLossRestart(LOST_LINK, usb('kept-running'));
    expect(settled).toEqual({
      kind: 'disconnect',
      message: LOST_LINK.message,
      sentLines: 45,
    });
    if (settled === null) throw new Error('Expected a settled interruption.');
    expect(automaticRestart(GCODE, ACKED, settled).line).toBe(41);
  });

  it('keeps a status backlog the run reported, rather than a whole planner', () => {
    const reported = { ackedAtStatus: 38, queuedBlocks: 6 };
    const settled = settleLinkLossRestart(
      { ...LOST_LINK, plannerBacklogIfRestarted: reported },
      usb('boot-banner'),
    );
    expect(settled?.plannerBacklog).toEqual(reported);
    if (settled === null) throw new Error('Expected a settled interruption.');
    expect(automaticRestart(GCODE, ACKED, settled)).toMatchObject({
      line: 33,
      plannerBacklogBasis: 'status-backlog',
    });
  });

  it('leaves records that wait for no verdict alone', () => {
    const { plannerBacklogIfRestarted: _backlog, ...settled } = LOST_LINK;
    expect(settleLinkLossRestart(settled, usb('boot-banner'))).toBeNull();
    const reboot: JobInterruption = {
      kind: 'controller-reboot',
      message: 'Rebooted.',
      plannerBacklog: PLANNER_SIZE,
    };
    expect(settleLinkLossRestart(reboot, usb('kept-running'))).toBeNull();
  });

  it('names the link the reconnect came over', () => {
    expect(settleLinkLossRestart(LOST_LINK, usb('boot-banner'))?.message).toMatch(
      /^The USB connection was lost/,
    );
    const alarmed = settleLinkLossRestart(LOST_LINK, network('alarm'))?.message;
    expect(alarmed).toMatch(/^The network connection was lost/);
    expect(alarmed).not.toMatch(/USB|Arduino/);
  });
});

// ADR-398 Amendment 4, controller audit D7-P2-1: grblHAL greets every new
// Telnet client with its startup banner, so a Wi-Fi reconnect to a board that
// kept burning cannot show a restart. Nothing steps back on its own; the
// restart hint names the line that would.
describe('a reconnect that cannot show whether the controller restarted', () => {
  it('keeps the automatic line and names the step back a restart would need', () => {
    const settled = settleLinkLossRestart(LOST_LINK, network('unknown'));
    expect(settled).toMatchObject({
      kind: 'disconnect',
      sentLines: 45,
      unconfirmedPlannerBacklog: PLANNER_SIZE,
    });
    expect(settled).not.toHaveProperty('plannerBacklog');
    expect(settled).not.toHaveProperty('plannerBacklogIfRestarted');
    if (settled === null) throw new Error('Expected a settled interruption.');
    expect(awaitsLinkLossVerdict(settled)).toBe(false);
    expect(settled.message).toMatch(/^The network connection was lost/);
    expect(settled.message).toContain('does not show whether the controller restarted');
    expect(settled.message).not.toMatch(/USB|Arduino|had restarted/);
    expect(automaticRestart(GCODE, ACKED, settled)).toEqual({
      line: 41,
      replaysRejectedLine: false,
      ifRestarted: { line: 26, blocks: 15, basis: 'planner-size' },
    });
  });

  it('explains a grblHAL USB greeting in USB terms', () => {
    const message = settleLinkLossRestart(LOST_LINK, usb('unknown'))?.message;
    expect(message).toMatch(/^The USB connection was lost/);
    expect(message).toContain('each time its USB port opens');
    expect(message).not.toContain('It sent its startup banner');
    expect(message).toContain('before the port reopened');
  });
});

describe('the stored record', () => {
  it('reads the held-back backlog and rejects a corrupt one', () => {
    expect(parseOptionalJobInterruption(LOST_LINK)).toEqual({ interruption: LOST_LINK });
    expect(
      parseOptionalJobInterruption({
        ...LOST_LINK,
        plannerBacklogIfRestarted: { ackedAtStatus: -1 },
      }),
    ).toBeNull();
  });

  it('reads an unconfirmed backlog and rejects a corrupt one', () => {
    const unconfirmed = settleLinkLossRestart(LOST_LINK, network('unknown'));
    expect(parseOptionalJobInterruption(unconfirmed)).toEqual({ interruption: unconfirmed });
    expect(
      parseOptionalJobInterruption({
        ...unconfirmed,
        unconfirmedPlannerBacklog: { ackedAtStatus: 1, queuedBlocks: 2, bound: 'other' },
      }),
    ).toBeNull();
  });
});

// CNC audit v3 N5r-P1-1: a CNC record keeps what each reconnect showed, for
// pass recovery's "Position retained" check.
describe('recordControllerRestart', () => {
  const CANCELLED: JobInterruption = {
    kind: 'cancelled',
    message: 'Stopped by the operator (Abort).',
  };

  it('records the sign without touching the backlog or the message', () => {
    const recorded = recordControllerRestart(LOST_LINK, 'boot-banner');
    expect(recorded).toEqual({ ...LOST_LINK, controllerRestart: 'boot-banner' });
    expect(recordControllerRestart(CANCELLED, 'unknown')).toEqual({
      ...CANCELLED,
      controllerRestart: 'unknown',
    });
  });

  it('never lets a later reconnect give back what a possible restart took', () => {
    const restarted = { ...CANCELLED, controllerRestart: 'alarm' as const };
    expect(recordControllerRestart(restarted, 'kept-running')).toBeNull();
    expect(recordControllerRestart(restarted, 'boot-banner')).toBeNull();
    const kept = { ...CANCELLED, controllerRestart: 'kept-running' as const };
    expect(recordControllerRestart(kept, 'kept-running')).toBeNull();
    expect(recordControllerRestart(kept, 'unknown')?.controllerRestart).toBe('unknown');
  });

  it('round-trips the sign and the held tool change through the saved record', () => {
    const saved = { ...CANCELLED, controllerRestart: 'boot-banner', heldAtToolChange: true };
    expect(parseOptionalJobInterruption(saved)).toEqual({ interruption: saved });
    expect(
      parseOptionalJobInterruption({ ...CANCELLED, controllerRestart: 'rebooted' }),
    ).toBeNull();
    expect(parseOptionalJobInterruption({ ...CANCELLED, heldAtToolChange: false })).toBeNull();
  });
});
