import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function installRunnableProject(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        layers: [createLayer({ id: 'L1', color: '#ff0000' })],
        objects: [
          {
            kind: 'imported-svg',
            id: 'O1',
            source: 'qualification.svg',
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 0, y: 0 },
                      { x: 10, y: 0 },
                      { x: 10, y: 10 },
                      { x: 0, y: 10 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    streamer: null,
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
  });
});

describe('JobControls Start-only disabled reason', () => {
  it('disables only Start when the parent supplies a qualification blocker', async () => {
    installRunnableProject();
    useLaserStore.setState({
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <JobControls
            disabled={false}
            startDisabledReason="Reading controller settings…"
            onStartJob={() => undefined}
          />,
        );
      });
      const buttons = [...host.querySelectorAll('button')];
      const start = buttons.find((button) => button.textContent === 'Set up & Frame');
      const frame = buttons.find((button) => button.textContent === 'Frame job');
      expect(start).toMatchObject({ disabled: true, title: 'Reading controller settings…' });
      expect(frame?.disabled).toBe(false);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
