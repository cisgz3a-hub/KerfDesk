import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { IslandFillRecoveryAction } from './IslandFillRecoveryAction';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useStore.getState().newProject();
  useToastStore.setState({ toasts: [] });
});

describe('IslandFillRecoveryAction', () => {
  it('offers one-click Scanline recovery for fine-detail 4040 Island Fill', async () => {
    installNeotronicsIslandFillProject({ fillOverscanMm: 0 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<IslandFillRecoveryAction streaming={false} />);
      });
      const recoveryButton = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Switch Island Fill to Scanline',
      );
      expect(recoveryButton).not.toBeUndefined();

      await act(async () => {
        recoveryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useStore.getState().project.scene.layers[0]?.fillStyle).toBe('scanline');
      expect(host.textContent).not.toContain('Switch Island Fill to Scanline');
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        message: 'Switched Island Fill layers to Scanline.',
        variant: 'success',
      });
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('respects Cut Selected scope before showing the recovery action', async () => {
    installNeotronicsIslandFillProject();
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            ...state.project.scene.layers,
            createLayer({ id: 'L-line', color: '#0000ff', mode: 'line' }),
          ],
          objects: [
            ...state.project.scene.objects,
            {
              kind: 'imported-svg',
              id: 'safe-line',
              source: 'safe-line.svg',
              bounds: { minX: 40, minY: 40, maxX: 80, maxY: 40 },
              transform: IDENTITY_TRANSFORM,
              paths: [
                {
                  color: '#0000ff',
                  polylines: [
                    {
                      closed: false,
                      points: [
                        { x: 40, y: 40 },
                        { x: 80, y: 40 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      outputScopeSettings: {
        ...state.outputScopeSettings,
        cutSelectedGraphics: true,
      },
      selectedObjectId: 'safe-line',
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<IslandFillRecoveryAction streaming={false} />);
      });

      expect(host.textContent).not.toContain('Switch Island Fill to Scanline');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('offers Scanline recovery for custom profiles using the 4040-safe dialect', async () => {
    installNeotronicsIslandFillProject({
      device: {
        ...DEFAULT_DEVICE_PROFILE,
        profileId: 'custom-safe-dialect',
        machineFamily: 'custom-grbl',
        gcodeDialect: { dialectId: 'neotronics-4040-safe' },
      },
      fillOverscanMm: 0,
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<IslandFillRecoveryAction streaming={false} />);
      });

      expect(host.textContent).toContain('Switch Island Fill to Scanline');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });

  it('offers Scanline recovery for fine-detail 4040 Island Fill even when overscan is enabled', async () => {
    installNeotronicsIslandFillProject({ fillOverscanMm: 5 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<IslandFillRecoveryAction streaming={false} />);
      });

      expect(host.textContent).toContain('Switch Island Fill to Scanline');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

function installNeotronicsIslandFillProject(
  options: {
    readonly device?: typeof NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;
    readonly fillOverscanMm?: number;
  } = {},
): void {
  const device = options.device ?? NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;
  useStore.setState({
    project: {
      ...createProject(device),
      scene: {
        ...EMPTY_SCENE,
        layers: [
          {
            ...createLayer({ id: 'L-fill', color: '#ff0000', mode: 'fill' }),
            fillStyle: 'island',
            fillOverscanMm: options.fillOverscanMm ?? 5,
            hatchSpacingMm: 1,
            power: 10,
          },
        ],
        objects: [
          {
            kind: 'imported-svg',
            id: 'tiny-island',
            source: 'tiny-island.svg',
            bounds: { minX: 20, minY: 20, maxX: 23, maxY: 23 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: '#ff0000',
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 20, y: 20 },
                      { x: 23, y: 20 },
                      { x: 23, y: 23 },
                      { x: 20, y: 23 },
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
