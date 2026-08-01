import { describe, expect, it, vi } from 'vitest';
import { parseStatusReport, type StatusReport } from '../../core/controllers/grbl';
import {
  cancelFreshControllerStatusWait,
  observeFreshControllerStatus,
  waitForFreshControllerStatus,
  type ControllerStatusWaitRefs,
} from './laser-controller-status-wait';

const SESSION_EPOCH = 7;
const STATUS_SEQUENCE = 11;
const TIMEOUT_MESSAGE = 'Status confirmation timed out.';

function status(line: string): StatusReport {
  const report = parseStatusReport(line);
  if (report === null) throw new Error(`Expected a status report: ${line}`);
  return report;
}

describe('fresh controller status observation', () => {
  it('notifies progress only after the sequence floor in the expected session', async () => {
    const refs: ControllerStatusWaitRefs = {};
    const onFreshReport = vi.fn();
    const pending = waitForFreshControllerStatus(refs, {
      after: { sessionEpoch: SESSION_EPOCH, sequence: STATUS_SEQUENCE },
      accept: () => false,
      onFreshReport,
      timeoutMessage: TIMEOUT_MESSAGE,
    });
    const cancelled = expect(pending).rejects.toThrow(/cancelled/i);
    const restoring = status('<Door:3|MPos:0.000,0.000,0.000|FS:0,12000>');

    observeFreshControllerStatus(
      refs,
      { sessionEpoch: SESSION_EPOCH, sequence: STATUS_SEQUENCE },
      restoring,
    );
    expect(onFreshReport).not.toHaveBeenCalled();

    observeFreshControllerStatus(
      refs,
      { sessionEpoch: SESSION_EPOCH, sequence: STATUS_SEQUENCE + 1 },
      restoring,
    );
    expect(onFreshReport).toHaveBeenCalledOnce();

    cancelFreshControllerStatusWait(refs);
    await cancelled;
  });

  it('rejects session replacement before notifying progress', async () => {
    const refs: ControllerStatusWaitRefs = {};
    const onFreshReport = vi.fn();
    const pending = waitForFreshControllerStatus(refs, {
      after: { sessionEpoch: SESSION_EPOCH, sequence: STATUS_SEQUENCE },
      accept: () => false,
      onFreshReport,
      timeoutMessage: TIMEOUT_MESSAGE,
    });
    const rejected = expect(pending).rejects.toThrow(/session changed/i);

    observeFreshControllerStatus(
      refs,
      { sessionEpoch: SESSION_EPOCH + 1, sequence: STATUS_SEQUENCE + 1 },
      status('<Door:3|MPos:0.000,0.000,0.000|FS:0,12000>'),
    );

    await rejected;
    expect(onFreshReport).not.toHaveBeenCalled();
  });

  it('rejects Alarm before notifying progress', async () => {
    const refs: ControllerStatusWaitRefs = {};
    const onFreshReport = vi.fn();
    const pending = waitForFreshControllerStatus(refs, {
      after: { sessionEpoch: SESSION_EPOCH, sequence: STATUS_SEQUENCE },
      accept: () => false,
      onFreshReport,
      timeoutMessage: TIMEOUT_MESSAGE,
    });
    const rejected = expect(pending).rejects.toThrow(/Alarm/i);

    observeFreshControllerStatus(
      refs,
      { sessionEpoch: SESSION_EPOCH, sequence: STATUS_SEQUENCE + 1 },
      status('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>'),
    );

    await rejected;
    expect(onFreshReport).not.toHaveBeenCalled();
  });
});
