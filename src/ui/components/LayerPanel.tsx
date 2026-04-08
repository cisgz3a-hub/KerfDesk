import React, { useCallback } from 'react';
import { type Scene, getActiveLayer } from '../../core/scene/Scene';
import { type Layer, type LayerMode, createLayer } from '../../core/scene/Layer';
import { MATERIAL_PRESETS, getPresetSettings } from '../../core/materials/MaterialPresets';
import { theme } from '../styles/theme';

interface LayerPanelProps {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  onSceneCommit: (scene: Scene) => void;
}

function updateLayer(
  scene: Scene,
  layerId: string,
  updater: (layer: Layer) => Layer
): Scene {
  return {
    ...scene,
    layers: scene.layers.map(layer => (layer.id === layerId ? updater(layer) : layer)),
  };
}

export function LayerPanel({ scene, selectedIds, onSceneCommit }: LayerPanelProps) {
  const activeLayer = getActiveLayer(scene) ?? scene.layers[0];

  const setActiveLayer = (layerId: string) => {
    if (scene.activeLayerId === layerId) return;
    onSceneCommit({ ...scene, activeLayerId: layerId });
  };

  const toggleVisible = (layerId: string) => {
    onSceneCommit(updateLayer(scene, layerId, layer => ({ ...layer, visible: !layer.visible })));
  };

  const toggleLocked = (layerId: string) => {
    onSceneCommit(updateLayer(scene, layerId, layer => ({ ...layer, locked: !layer.locked })));
  };

  const updatePower = (value: number) => {
    if (!activeLayer) return;
    const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    onSceneCommit(updateLayer(scene, activeLayer.id, layer => ({
      ...layer,
      settings: {
        ...layer.settings,
        power: {
          ...layer.settings.power,
          max: clamped,
        },
      },
    })));
  };

  const updateSpeed = (value: number) => {
    if (!activeLayer) return;
    const speed = Number.isFinite(value) ? value : 0;
    onSceneCommit(updateLayer(scene, activeLayer.id, layer => ({
      ...layer,
      settings: {
        ...layer.settings,
        speed,
      },
    })));
  };

  const updateMode = (mode: LayerMode) => {
    if (!activeLayer) return;
    onSceneCommit(updateLayer(scene, activeLayer.id, layer => ({
      ...layer,
      settings: {
        ...layer.settings,
        mode,
      },
    })));
  };

  const handleAddLayer = useCallback(() => {
    const nextIndex = scene.layers.length;
    const modes: LayerMode[] = ['cut', 'engrave', 'score', 'image'];
    const mode = modes[nextIndex % modes.length];
    const names = ['Cut', 'Engrave', 'Score', 'Image'];
    const name = names[nextIndex % names.length] + (nextIndex >= 4 ? ' ' + Math.floor(nextIndex / 4 + 1) : '');
    const newLayer = createLayer(nextIndex, mode, name);
    const newScene = {
      ...scene,
      layers: [...scene.layers, newLayer],
      activeLayerId: newLayer.id,
    };
    onSceneCommit(newScene);
  }, [scene, onSceneCommit]);

  const handleRemoveLayer = useCallback(() => {
    if (scene.layers.length <= 1) return;
    const activeId = scene.activeLayerId;
    const newLayers = scene.layers.filter(l => l.id !== activeId);
    const newObjects = scene.objects.filter(o => o.layerId !== activeId);
    const newScene = {
      ...scene,
      layers: newLayers,
      objects: newObjects,
      activeLayerId: newLayers[0].id,
    };
    onSceneCommit(newScene);
  }, [scene, onSceneCommit]);

  const panelStyle = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: theme.font.ui,
    borderBottom: `1px solid ${theme.border.subtle}`,
  };

  const listStyle = {
    padding: '4px 0',
    borderBottom: `1px solid ${theme.border.subtle}`,
  };

  const settingsStyle = {
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  };

  const fieldStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  };

  const settingsLabelStyle = {
    fontSize: theme.font.size.xs,
    color: theme.text.secondary,
    fontFamily: theme.font.ui,
    marginBottom: 2,
  };

  const numberInputStyle = {
    width: '100%',
    padding: '4px 8px',
    background: theme.bg.base,
    border: `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.sm,
    color: theme.text.primary,
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.mono,
    outline: 'none',
  };

  const selectStyle = {
    width: '100%',
    padding: '4px 8px',
    background: theme.bg.base,
    border: `1px solid ${theme.border.default}`,
    borderRadius: theme.radius.sm,
    color: theme.text.primary,
    fontSize: theme.font.size.sm,
    fontFamily: theme.font.ui,
    outline: 'none',
    cursor: 'pointer',
  };

  const layerSettingsHeaderStyle = {
    fontSize: theme.font.size.sm,
    fontWeight: 600,
    color: theme.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 4,
  };

  const iconToggleStyle = (layer: Layer) => ({
    background: 'none',
    border: 'none',
    color: layer.visible ? theme.text.secondary : theme.text.tertiary,
    cursor: 'pointer',
    fontSize: 12,
    padding: 2,
    opacity: layer.visible ? 1 : 0.4,
  });

  return React.createElement('div', { style: panelStyle },
    // Header
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: `1px solid ${theme.border.subtle}`,
      },
    },
      React.createElement('span', {
        style: {
          fontSize: theme.font.size.sm,
          fontWeight: 600,
          color: theme.text.secondary,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
        },
      }, 'Layers'),
      React.createElement('div', { style: { display: 'flex', gap: 4 } },
        React.createElement('button', {
          onClick: handleAddLayer,
          title: 'Add layer',
          style: {
            width: 24,
            height: 24,
            background: 'transparent',
            border: `1px solid ${theme.border.default}`,
            borderRadius: theme.radius.sm,
            color: theme.text.secondary,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: `all ${theme.transition.fast}`,
          },
        }, '+'),
        React.createElement('button', {
          onClick: handleRemoveLayer,
          title: 'Remove layer',
          disabled: scene.layers.length <= 1,
          style: {
            width: 24,
            height: 24,
            background: 'transparent',
            border: `1px solid ${theme.border.default}`,
            borderRadius: theme.radius.sm,
            color: scene.layers.length <= 1 ? theme.text.tertiary : theme.text.secondary,
            cursor: scene.layers.length <= 1 ? 'default' : 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: `all ${theme.transition.fast}`,
            opacity: scene.layers.length <= 1 ? 0.45 : 1,
          },
        }, '−'),
      ),
    ),
    React.createElement('div', { style: listStyle },
      scene.layers.map(layer => {
        const objectCount = scene.objects.filter(o => o.layerId === layer.id).length;
        const isActive = scene.activeLayerId === layer.id;
        const rowStyle = {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: isActive ? 'rgba(0, 212, 255, 0.06)' : 'transparent',
          borderLeft: isActive ? `2px solid ${theme.accent.cyan}` : '2px solid transparent',
          cursor: 'pointer',
          transition: `all ${theme.transition.fast}`,
        };

        return React.createElement('div', {
          key: layer.id,
          style: rowStyle,
          onClick: () => setActiveLayer(layer.id),
        },
          React.createElement('div', {
            style: {
              width: 10,
              height: 10,
              borderRadius: 2,
              background: layer.color,
              flexShrink: 0,
            },
          }),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', {
              style: {
                fontSize: theme.font.size.sm,
                color: theme.text.primary,
                fontWeight: 500,
                whiteSpace: 'nowrap' as const,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }, layer.name),
            React.createElement('div', {
              style: { fontSize: theme.font.size.xs, color: theme.text.tertiary },
            }, `${layer.settings.mode} • ${objectCount}`),
          ),
          React.createElement('button', {
            style: iconToggleStyle(layer),
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              toggleVisible(layer.id);
            },
            title: layer.visible ? 'Hide layer' : 'Show layer',
          }, layer.visible ? '👁' : '·'),
          React.createElement('button', {
            style: {
              background: 'none',
              border: 'none',
              color: !layer.locked ? theme.text.secondary : theme.text.tertiary,
              cursor: 'pointer',
              fontSize: 12,
              padding: 2,
              opacity: !layer.locked ? 1 : 0.4,
            },
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              toggleLocked(layer.id);
            },
            title: layer.locked ? 'Unlock layer' : 'Lock layer',
          }, layer.locked ? '🔒' : '·'),
        );
      }),
    ),
    activeLayer && React.createElement('div', { style: settingsStyle },
      React.createElement('div', { style: layerSettingsHeaderStyle }, 'Layer Settings'),
      React.createElement('div', { style: { marginTop: 6 } },
        React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Material Preset'),
        React.createElement('select', {
          value: '',
          style: selectStyle,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            const presetName = e.target.value;
            if (!presetName || !activeLayer) return;

            const machineType = scene.machine?.type || 'diode';
            const settings = getPresetSettings(presetName, machineType);
            if (!settings) return;

            const mode = activeLayer.settings.mode;
            const s = mode === 'cut' ? settings.cut : settings.engrave;

            const newLayers = scene.layers.map(l =>
              l.id === activeLayer.id
                ? {
                    ...l,
                    settings: {
                      ...l.settings,
                      power: { ...l.settings.power, max: s.power },
                      speed: s.speed,
                      passes: 'passes' in s ? s.passes : l.settings.passes,
                    },
                  }
                : l
            );
            onSceneCommit({ ...scene, layers: newLayers });
          },
        },
          React.createElement('option', { value: '' }, '— Select material —'),
          React.createElement('optgroup', { label: 'Wood' },
            ...MATERIAL_PRESETS.filter(p => p.type === 'wood').map(p =>
              React.createElement('option', { key: p.name, value: p.name }, p.name)
            ),
          ),
          React.createElement('optgroup', { label: 'Acrylic' },
            ...MATERIAL_PRESETS.filter(p => p.type === 'acrylic').map(p =>
              React.createElement('option', { key: p.name, value: p.name }, p.name)
            ),
          ),
          React.createElement('optgroup', { label: 'Leather' },
            ...MATERIAL_PRESETS.filter(p => p.type === 'leather').map(p =>
              React.createElement('option', { key: p.name, value: p.name }, p.name)
            ),
          ),
          React.createElement('optgroup', { label: 'Paper' },
            ...MATERIAL_PRESETS.filter(p => p.type === 'paper').map(p =>
              React.createElement('option', { key: p.name, value: p.name }, p.name)
            ),
          ),
          React.createElement('optgroup', { label: 'Fabric' },
            ...MATERIAL_PRESETS.filter(p => p.type === 'fabric').map(p =>
              React.createElement('option', { key: p.name, value: p.name }, p.name)
            ),
          ),
        ),
        React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 3 } },
          `Settings for ${scene.machine?.type || 'diode'} laser. Run a material test to fine-tune.`,
        ),
      ),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', { style: settingsLabelStyle }, 'Power %'),
        React.createElement('input', {
          type: 'number',
          min: 0,
          max: 100,
          value: activeLayer.settings.power.max,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => updatePower(Number(e.target.value)),
          style: numberInputStyle,
        }),
      ),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', { style: settingsLabelStyle }, 'Speed mm/min'),
        React.createElement('input', {
          type: 'number',
          value: activeLayer.settings.speed,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateSpeed(Number(e.target.value)),
          style: numberInputStyle,
        }),
      ),
      React.createElement('div', { style: { marginTop: 6 } },
        React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Passes'),
        React.createElement('input', {
          type: 'number',
          value: activeLayer.settings.passes ?? 1,
          min: 1,
          max: 20,
          style: numberInputStyle,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            const val = parseInt(e.target.value, 10) || 0;
            onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
              ...l,
              settings: { ...l.settings, passes: val },
            })));
          },
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
            const val = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
            onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
              ...l,
              settings: { ...l.settings, passes: val },
            })));
          },
        }),
      ),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', { style: settingsLabelStyle }, 'Mode'),
        React.createElement('select', {
          value: activeLayer.settings.mode,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => updateMode(e.target.value as LayerMode),
          style: selectStyle,
        },
          React.createElement('option', { value: 'cut' }, 'cut'),
          React.createElement('option', { value: 'engrave' }, 'engrave'),
          React.createElement('option', { value: 'score' }, 'score'),
          React.createElement('option', { value: 'image' }, 'image'),
        ),
      ),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 } },
        React.createElement('div', { style: { fontSize: 11, color: '#8888aa' } }, 'Air Assist'),
        React.createElement('button', {
          onClick: () => {
            const newLayers = scene.layers.map(l =>
              l.id === activeLayer.id
                ? { ...l, settings: { ...l.settings, airAssist: !l.settings.airAssist } }
                : l
            );
            onSceneCommit({ ...scene, layers: newLayers });
          },
          style: {
            padding: '3px 12px',
            background: activeLayer.settings.airAssist ? 'rgba(45, 212, 160, 0.1)' : 'rgba(255,255,255,0.03)',
            border: activeLayer.settings.airAssist ? '1px solid #2dd4a0' : '1px solid #252540',
            borderRadius: 4,
            color: activeLayer.settings.airAssist ? '#2dd4a0' : '#555570',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            transition: 'all 0.15s ease',
          },
        }, activeLayer.settings.airAssist ? 'ON' : 'OFF'),
      ),
    ),
  );
}
