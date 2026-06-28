import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
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
  it('offers one-click overscan recovery for 4040 Island Fill without runway', async () => {
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
        (button) => button.textContent === 'Set Island Fill overscan to 5 mm',
      );
      expect(recoveryButton).not.toBeUndefined();

      await act(async () => {
        recoveryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(useStore.getState().project.scene.layers[0]?.fillStyle).toBe('island');
      expect(useStore.getState().project.scene.layers[0]?.fillOverscanMm).toBe(5);
      expect(host.textContent).not.toContain('Set Island Fill overscan to 5 mm');
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        message: 'Set Island Fill overscan to 5 mm.',
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

      expect(host.textContent).not.toContain('Set Island Fill overscan to 5 mm');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});

function installNeotronicsIslandFillProject(
  options: { readonly fillOverscanMm?: number } = {},
): void {
  useStore.setState({
    project: {
      ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
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
