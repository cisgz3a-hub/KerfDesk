/* eslint-disable no-restricted-syntax -- Fixture colours identify scene artwork layers, not UI chrome. */
// A GRBL-family simulator whose status stream a test can shape, for the Frame
// that follows an origin write (rolling audit v9 R8-P1-1). The simulator prints
// MPos and WCO on every report; real firmware does not:
//   - stock GRBL and grblHAL print WCO on one idle report in ten, and on the
//     first report after a G92 or G10 (`REPORT_WCO_REFRESH_IDLE_COUNT 10`,
//     `system_flag_wco_change`);
//   - `$10=0` prints WPos instead of MPos, and `$10=2` adds the buffer field.
// The filter rewrites the simulator's own reports into those shapes, and can
// hold every report back, which is the window between an origin write and the
// next poll. Firmware state, motion and every reply other than `<...>` stay as
// the simulator produced them.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L603-L607
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L280-L285

import { expect, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import {
  FALCON_A1_PRO_BANNER,
  FALCON_A1_PRO_DUMP,
} from '../../__fixtures__/controllers/falcon-a1-pro-dump';
import type { JobPlacementSettings } from '../../core/job';
import type { DeviceProfile } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';

export type ReportShape = 'every-report' | 'stock-cadence' | 'wpos' | 'wpos-buffer';

type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

const WCO_REFRESH_IDLE_COUNT = 10;

/** Where the head stands, in machine coordinates, before the origin write. */
export const HEAD = { x: 100, y: 80 };

export function shapedReports(adapter: PlatformAdapter, shape: ReportShape) {
  let held = false;
  let wcoCountdown = 0;
  let wcoChanged = false;
  const reshape = (line: string): string | null => {
    if (!line.startsWith('<')) return line;
    if (held) return null;
    if (shape === 'every-report') return line;
    const fields = line.slice(1, -1).split('|');
    const mPos = vectorField(fields, 'MPos');
    const wco = vectorField(fields, 'WCO');
    if (mPos === null || wco === null) return line;
    const sendWco = wcoChanged || wcoCountdown === 0;
    wcoChanged = false;
    wcoCountdown = sendWco ? WCO_REFRESH_IDLE_COUNT - 1 : wcoCountdown - 1;
    const kept = fields.filter((field) => !field.startsWith('WCO:'));
    const position =
      shape === 'stock-cadence'
        ? kept
        : kept.map((field) =>
            field.startsWith('MPos:')
              ? `WPos:${formatVector({ x: mPos.x - wco.x, y: mPos.y - wco.y, z: mPos.z - wco.z })}`
              : field,
          );
    const buffer = shape === 'wpos-buffer' ? ['Bf:15,128'] : [];
    const offset = sendWco ? [`WCO:${formatVector(wco)}`] : [];
    return `<${[...position, ...buffer, ...offset].join('|')}>`;
  };
  const decorate = (connection: SerialConnection): SerialConnection => ({
    ...connection,
    write: async (data) => {
      if (/G92|G10/i.test(data)) wcoChanged = true;
      await connection.write(data);
    },
    onLine: (handler) =>
      connection.onLine((line) => {
        const shaped = reshape(line);
        if (shaped !== null) handler(shaped);
      }),
  });
  return {
    adapter: {
      ...adapter,
      serial: {
        ...adapter.serial,
        requestPort: async () => {
          const port = await adapter.serial.requestPort();
          return port === null
            ? null
            : { ...port, open: async (options) => decorate(await port.open(options)) };
        },
      },
    } satisfies PlatformAdapter,
    /** Drop every status report until `release`. */
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
    },
  };
}

function vectorField(fields: ReadonlyArray<string>, name: string): Vec3 | null {
  const field = fields.find((candidate) => candidate.startsWith(`${name}:`));
  if (field === undefined) return null;
  const [x = NaN, y = NaN, z = NaN] = field
    .slice(name.length + 1)
    .split(',')
    .map(Number);
  return { x, y, z };
}

function formatVector(vector: Vec3): string {
  return [vector.x, vector.y, vector.z].map((value) => value.toFixed(3)).join(',');
}

export type Machine = 'grbl' | 'falcon-a1-pro';

export function lineProject(device: DeviceProfile): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...device, homing: { ...device.homing, enabled: false } },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'line', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'artwork',
          source: 'line.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 10 },
                    { x: 20, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function statusMask(shape: ReportShape): string {
  if (shape === 'wpos') return '0';
  if (shape === 'wpos-buffer') return '2';
  return '1';
}

export async function connectAtHead(
  machine: Machine,
  shape: ReportShape,
  placement: JobPlacementSettings,
) {
  const a1Pro = machine === 'falcon-a1-pro';
  const project = lineProject(a1Pro ? FALCON_A1_PRO_GRBLHAL_PROFILE : createProject().device);
  useStore.setState({ project, jobPlacement: placement });
  const dump = a1Pro
    ? FALCON_A1_PRO_DUMP.map((row) => {
        const [key = '', value = ''] = row.slice(1).split('=');
        return [Number(key), value] as const;
      }).filter(([key]) => key !== 22)
    : [];
  const sim = createGrblSimulator({
    motionMs: 25,
    settings: [...dump, [10, statusMask(shape)], [22, '0'], [32, '1']],
    ...(a1Pro ? { firmware: 'grblhal' as const, firmwareBanner: FALCON_A1_PRO_BANNER } : {}),
  });
  const reports = shapedReports(sim.adapter, shape);
  await useLaserStore.getState().connect(reports.adapter, connectOptionsForDevice(project.device));
  await vi.advanceTimersByTimeAsync(2_000);
  const jogging = useLaserStore.getState().jog({ dx: HEAD.x, dy: HEAD.y, feed: 1000 });
  await vi.advanceTimersByTimeAsync(2_000);
  await jogging;
  // Let an idle report carrying WCO land, as it does at stock cadence.
  await vi.advanceTimersByTimeAsync(12_000);
  expect(sim.state().mpos).toMatchObject(HEAD);
  return { sim, reports };
}
