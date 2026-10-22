// ADR-398 Amendment 3: a lost link keeps its planner backlog aside until the
// first reconnect shows whether the controller restarted. The program is the
// rolling audit's repro (18-P2-1): sixty 20 mm cuts on stock GRBL, 40 lines
// acknowledged and 45 sent when the cable went, no `Bf` in the reports.

import { describe, expect, it } from 'vitest';
import { automaticRestart } from './automatic-restart-line';
import { parseOptionalJobInterruption, type JobInterruption } from './job-interruption';
import { awaitsLinkLossVerdict, settleLinkLossRestart } from './link-loss-restart';

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

describe('settleLinkLossRestart', () => {
  it.each(['boot-banner', 'alarm'] as const)(
    'steps back a whole planner when the reconnect shows a %s',
    (evidence) => {
      const settled = settleLinkLossRestart(LOST_LINK, evidence);
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
    const settled = settleLinkLossRestart(LOST_LINK, 'kept-running');
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
      'boot-banner',
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
    expect(settleLinkLossRestart(settled, 'boot-banner')).toBeNull();
    const reboot: JobInterruption = {
      kind: 'controller-reboot',
      message: 'Rebooted.',
      plannerBacklog: PLANNER_SIZE,
    };
    expect(settleLinkLossRestart(reboot, 'kept-running')).toBeNull();
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
});
