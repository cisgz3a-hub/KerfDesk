import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';

// eslint-disable-next-line no-restricted-syntax -- Scene artwork fixture color, not UI chrome.
const ARTWORK_COLOR = '#ff0000';

export function coordinateEntryProject(): Project {
  const base = createProject({
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    origin: 'front-left',
    homing: { enabled: true, direction: 'front-left' },
  });
  return {
    ...base,
    optimization: { ...base.optimization, travelPolicy: 'source-order', pathDirection: 'preserve' },
    scene: {
      layers: [{ ...createLayer({ id: 'edge', color: ARTWORK_COLOR }), fillOverscanMm: 5 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'edge',
          source: 'edge.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 10, minY: 20, maxX: 20, maxY: 20 },
          paths: [
            {
              color: ARTWORK_COLOR,
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 10, y: 20 },
                    { x: 20, y: 20 },
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

export function coordinateEntryMachine(project: Project, absolute = false): MachineStartSnapshot {
  const wco = absolute ? { x: 0, y: 0, z: 0 } : { x: -300, y: -300, z: 0 };
  return {
    ...stockNativeEvidence(project.device),
    connected: true,
    statusReport: {
      state: 'Idle',
      subState: null,
      feed: 0,
      spindle: 0,
      mPos: { x: -250, y: -250, z: 0 },
      wPos: absolute ? { x: -250, y: -250, z: 0 } : { x: 50, y: 50, z: 0 },
      wco,
    },
    alarmCode: null,
    hasActiveStreamer: false,
    settingsCapability: 'none',
    workOriginActive: !absolute,
    wcoCache: wco,
  };
}
