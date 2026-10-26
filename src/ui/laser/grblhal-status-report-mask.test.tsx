// Controller audit v2 C8-P2-2, ADR-375 Amendment 2. grblHAL at its default
// COMPATIBILITY_LEVEL 0 stores `$10` whole, and its reports carry WCO: only
// with bit 5 and Ov: only with bit 6 (core report.c#L1471-L1507). A stock-GRBL
// `$10=0` (LightBurn's advice for GRBL CNC lasers) or `$10=1` turns both off,
// and `$10=0` reports WPos only, so the machine position cannot be known.
// KerfDesk said "not reported yet / wait for a status report" for good. These
// run the real `$$` collector, status parser and line handler, then the store
// and the status panel.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, grblHalDriver, type ControllerDriver } from '../../core/controllers';
import { startCollecting } from '../../core/controllers/grbl';
import { cncOverrideStartIssue } from '../state/cnc-accessory-readiness';
import { handleLine } from '../state/laser-line-handler';
import { makeLineHandlerHarness } from '../state/laser-line-handler.test-support';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { laserStatusReportFieldsOff } from '../state/status-report-fields';
import {
  absoluteFrameOffsetRefusal,
  waitForAbsoluteFrameOffset,
  waitForUnreportedFrameWorkOffset,
} from './frame-position-readiness';
import { currentHeadPosition, headPositionUnknownMessage } from './head-move-dispatch';
import { StatusDisplay } from './StatusDisplay';
import {
  controllerReportsWorkOffset,
  workOffsetAssumptionWarnings,
} from './work-offset-assumption';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ABSOLUTE = { startFrom: 'absolute', anchor: 'front-left' } as const;
const originalState = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root;

/** `$$` with a grblHAL setting beside the stock ones, then 40 status reports,
 * through the line handler a live session uses. */
function session(driver: ControllerDriver, mask: number, report: (index: number) => string) {
  const harness = makeLineHandlerHarness();
  harness.set({ capabilities: driver.capabilities, activeControllerKind: driver.kind });
  const refs = { ...harness.refs, driver, settingsCollector: startCollecting() };
  const write = async (): Promise<void> => undefined;
  const dump = [`$10=${mask}`, '$13=0', '$22=1', '$130=400.000', '$131=300.000', '$384=0', 'ok'];
  for (const line of dump) handleLine(harness.set, harness.get, refs, write, line);
  for (let index = 0; index < 40; index += 1) {
    handleLine(harness.set, harness.get, refs, write, report(index));
  }
  const state = harness.get();
  useLaserStore.setState({
    capabilities: state.capabilities,
    activeControllerKind: state.activeControllerKind,
    controllerSettings: state.controllerSettings,
    statusReport: state.statusReport,
    wcoCache: state.wcoCache,
    ovCache: state.ovCache,
  });
  return useLaserStore.getState();
}

const wposOnly = () => '<Idle|WPos:10.000,20.000,-1.000>';
const mposOnly = () => '<Idle|MPos:-390.000,-280.000,-1.000>';
// grblHAL's default 511: WCO and Ov take turns on the refresh counts.
const grblHalDefault = (index: number) =>
  '<Idle|MPos:-390.000,-280.000,-1.000|Bf:35,1023|FS:0,0' +
  (index % 10 === 0 ? '|WCO:-400.000,-300.000,0.000' : '') +
  (index % 10 === 5 ? '|Ov:100,100,100' : '') +
  '>';

function panelText(): string {
  act(() => root.render(<StatusDisplay />));
  return host.textContent ?? '';
}

function jobReviewWorkOffset(state: LaserState): ReadonlyArray<string> {
  return workOffsetAssumptionWarnings(
    { ok: true },
    {
      statusReport: state.statusReport,
      wcoCache: state.wcoCache,
      workOriginActive: state.workOriginActive,
      reportsWorkOffset: controllerReportsWorkOffset(state.capabilities),
      statusReportFieldsOff: laserStatusReportFieldsOff(state),
    },
  );
}

beforeEach(() => {
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    requestControllerStatus: vi.fn(async () => undefined),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(originalState, true);
});

describe('grblHAL $10 status-report mask (C8-P2-2)', () => {
  it('$10=0: says the machine position cannot be known and which $10 sends WCO and Ov', () => {
    const state = session(grblHalDriver, 0, wposOnly);
    expect(state.controllerSettings).toMatchObject({
      statusReportMask: 0,
      statusReportMaskIsFull: true,
    });
    expect([state.wcoCache, state.ovCache]).toEqual([null, null]);
    const text = panelText();
    expect(text).toContain('MPos: cannot be known (WPos only, no WCO)');
    expect(text).toContain('Origin: not reported (WCO off in $10; send $10=96)');
    expect(text).not.toContain('not reported yet');
    expect(currentHeadPosition('bed')).toBeNull();
    expect(headPositionUnknownMessage(state)).toMatch(
      /machine position cannot be known.*\$10=0.*bit 0 off.*bit 5 off.*\$10=96/,
    );
    const override = cncOverrideStartIssue('cnc', state.ovCache, laserStatusReportFieldsOff(state));
    expect(override).toMatch(/bit 6 \(Overrides\) off.*Send \$10=96/);
    expect(override).not.toMatch(/Wait for an Ov/);
    expect(jobReviewWorkOffset(state)).toEqual([expect.stringMatching(/bit 5.*\$10=96/)]);
  });

  it('$10=1: keeps the machine position and names bit 5 for the origin', () => {
    const state = session(grblHalDriver, 1, mposOnly);
    expect([state.wcoCache, state.ovCache]).toEqual([null, null]);
    const text = panelText();
    expect(text).toContain('MPos: X -390.000 Y -280.000 Z -1.000');
    expect(text).toContain('Origin: not reported (WCO off in $10; send $10=97)');
    expect(currentHeadPosition('bed')).not.toBeNull();
    expect(currentHeadPosition('origin')).toBeNull();
    expect(headPositionUnknownMessage(state)).toMatch(
      /bit 5 \(Work coordinate offset\) off.*\$10=97/,
    );
  });

  it('the grblHAL default (511) sends both fields, so nothing is named', () => {
    const state = session(grblHalDriver, 511, grblHalDefault);
    expect(state.controllerSettings?.statusReportMask).toBe(511);
    expect(state.wcoCache).not.toBeNull();
    expect(state.ovCache).toEqual({ feed: 100, rapid: 100, spindle: 100 });
    expect(laserStatusReportFieldsOff(state)).toBeNull();
    const text = panelText();
    expect(text).toContain('MPos: X -390.000 Y -280.000 Z -1.000');
    expect(text).toContain('Origin: X -400.000 Y -300.000');
    expect(text).not.toContain('$10');
    expect(
      cncOverrideStartIssue('cnc', state.ovCache, laserStatusReportFieldsOff(state)),
    ).toBeNull();
  });

  it('stock GRBL with $10=1 still waits for the WCO its reports will carry', async () => {
    const state = session(grblDriver, 1, mposOnly);
    expect(laserStatusReportFieldsOff(state)).toBeNull();
    expect(panelText()).toContain('Origin: not reported yet');
    const waiting = waitForUnreportedFrameWorkOffset(ABSOLUTE);
    expect(useLaserStore.getState().requestControllerStatus).toHaveBeenCalled();
    useLaserStore.setState({ connection: { kind: 'disconnected' } });
    await waiting;
  });

  it('Frame skips the WCO burst when $10 turns WCO off, homed or not', async () => {
    session(grblHalDriver, 1, mposOnly);
    await waitForUnreportedFrameWorkOffset(ABSOLUTE);
    useLaserStore.setState({ homingState: 'confirmed' });
    await expect(waitForAbsoluteFrameOffset(ABSOLUTE)).resolves.toBe(true);
    expect(useLaserStore.getState().requestControllerStatus).not.toHaveBeenCalled();
  });

  it('an Absolute Frame over a set origin names $10 instead of a wait', async () => {
    session(grblHalDriver, 1, mposOnly);
    useLaserStore.setState({ homingState: 'confirmed', workOriginActive: true });
    await expect(waitForAbsoluteFrameOffset(ABSOLUTE)).resolves.toBe(false);
    expect(useLaserStore.getState().requestControllerStatus).not.toHaveBeenCalled();
    expect(absoluteFrameOffsetRefusal(ABSOLUTE)).toEqual([
      expect.stringMatching(/needs the work offset, because a work origin is set.*\$10=97/),
    ]);
  });
});
