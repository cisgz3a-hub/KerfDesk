import { expect } from 'vitest';
import type { GrblSimulator, SmoothieSimulator } from '../../__fixtures__/controllers';
import type { Project } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { framedRunStartHandoffIssue } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
/** Status formatting oracle from Smoothieware Kernel::get_query_string:
 * both MPos and WPos call Robot::from_millimeters, hence G20 divides each
 * reported XYZ by 25.4. Robot::push_state/pop_state saves/restores inch_mode.
 * The repository simulator omits both rules. All actual moves in these tests
 * occur under G21, so its millimetre motion model remains applicable.
 * https://github.com/Smoothieware/Smoothieware/blob/edge/src/libs/Kernel.cpp
 * https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/robot/Robot.cpp
 */
export function withSmoothieInchReports(sim: SmoothieSimulator): PlatformAdapter {
  let inches = false;
  const savedUnits: boolean[] = [];
  const decorate = (inner: SerialConnection): SerialConnection => ({
    ...inner,
    write: async (data) => {
      for (const raw of data.split('\n')) {
        const line = raw.trim();
        if (/^M120\b/.test(line)) savedUnits.push(inches);
        else if (/^M121\b/.test(line)) inches = savedUnits.pop() ?? inches;
        if (/\bG20\b/.test(line)) inches = true;
        if (/\bG21\b/.test(line)) inches = false;
      }
      await inner.write(data);
    },
    onLine: (handler) =>
      inner.onLine((line) => {
        if (!inches || !line.startsWith('<')) {
          handler(line);
          return;
        }
        handler(
          line.replace(/\|(MPos|WPos):([^|>]+)/g, (_field, label: string, raw: string) => {
            const values = raw.split(',').map((value) => (Number(value) / 25.4).toFixed(4));
            return `|${label}:${values.join(',')}`;
          }),
        );
      }),
  });
  return {
    ...sim.adapter,
    serial: {
      ...sim.adapter.serial,
      requestPort: async () => {
        const port = await sim.adapter.serial.requestPort();
        return port === null
          ? null
          : { ...port, open: async (options) => decorate(await port.open(options)) };
      },
    },
  };
}

type LaserSnapshot = ReturnType<typeof useLaserStore.getState>;

export function expectG92DatumPreserved(before: LaserSnapshot, after: LaserSnapshot): void {
  expect(after.wcoCache).toEqual({ x: 127, y: 50.8, z: 0 });
  expect(after.workOriginActive).toBe(true);
  expect(after.workOriginSource).toBe(before.workOriginSource);
  expect(after.workOriginVersion).toBe(before.workOriginVersion);
  expect(after.trustedPositionEpoch).toBe(before.trustedPositionEpoch);
  expect(after.workZReferenceEpoch).toBe(before.workZReferenceEpoch);
  expect(after.workZZeroEvidence).toBe(before.workZZeroEvidence);
  expect(after.framedRun?.candidate.returnToWorkPosition).toEqual({ x: 127, y: 76.2 });
}

export function expectCompletedCncStartPermit(
  project: Project,
  safeZ: number,
  completed: LaserSnapshot,
): void {
  const permit = completed.framedRun;
  expect(permit?.candidate.project).toBe(project);
  expect(permit?.candidate.controllerBeforeFrame.statusReport?.mPos?.z).toBe(-1);
  expect(permit?.controller.statusReport?.mPos?.z).toBe(safeZ);
  expect(permit).not.toBeNull();
  if (permit === null) throw new Error('Missing completed CNC Frame permit');
  expect(framedRunStartHandoffIssue(permit, completed)).toBeNull();
  // The authorized lift is confined to Frame completion. Even a small later
  // XYZ movement is independently rejected at Start against the actual permit.
  for (const axis of ['x', 'y', 'z'] as const) {
    const statusReport = completed.statusReport;
    if (statusReport?.mPos == null) throw new Error('Expected simulator MPos');
    expect(
      framedRunStartHandoffIssue(permit, {
        ...completed,
        statusReport: {
          ...statusReport,
          mPos: { ...statusReport.mPos, [axis]: statusReport.mPos[axis] + 0.2 },
        },
      }),
    ).not.toBeNull();
  }
}

export function withCncCompletionZDrift(sim: GrblSimulator): PlatformAdapter {
  const decorate = (inner: SerialConnection): SerialConnection => ({
    ...inner,
    onLine: (handler) =>
      inner.onLine((line) => {
        const operation = useLaserStore.getState().motionOperation;
        if (
          line.startsWith('<Idle') &&
          operation?.kind === 'frame' &&
          operation.settlementAckStatusSequence !== undefined &&
          operation.pendingLines.length === 0
        ) {
          line = line.replace(/\|MPos:([^|>]+)/, (_field, raw: string) => {
            const xyz = raw.split(',').map(Number);
            return `|MPos:${xyz[0]},${xyz[1]},${(Number(xyz[2]) + 0.2).toFixed(3)}`;
          });
        }
        handler(line);
      }),
  });
  return {
    ...sim.adapter,
    serial: {
      ...sim.adapter.serial,
      requestPort: async () => {
        const port = await sim.adapter.serial.requestPort();
        return port === null
          ? null
          : { ...port, open: async (options) => decorate(await port.open(options)) };
      },
    },
  };
}
