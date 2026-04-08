import React, { useCallback } from 'react';
import { type Scene, getActiveLayer } from '../../core/scene/Scene';
import { type Layer, type LayerMode, createLayer } from '../../core/scene/Layer';
import { MATERIAL_PRESETS, getPresetById } from '../../data/MaterialPresets';

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
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#aaa',
    display: 'flex',
    flexDirection: 'column' as const,
  };

  const listStyle = {
    padding: 8,
    borderBottom: '1px solid #1a1a30',
  };

  const settingsStyle = {
    padding: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  };

  const fieldStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  };

  const inputStyle = {
    background: '#111122',
    color: '#ccc',
    border: '1px solid #2a2a40',
    borderRadius: 3,
    padding: '4px 6px',
    fontFamily: 'monospace',
    fontSize: 11,
  };

  const labelStyle = {
    color: '#666688',
    fontSize: 10,
    marginBottom: 4,
  };

  return React.createElement('div', { style: panelStyle },
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #1a1a30' },
    },
      React.createElement('span', { style: { fontSize: 10, color: '#666688', textTransform: 'uppercase' as const, letterSpacing: 1 } }, 'Layers'),
      React.createElement('div', { style: { display: 'flex', gap: 4 } },
        React.createElement('button', {
          onClick: handleAddLayer,
          style: { background: 'none', border: '1px solid #333355', borderRadius: 3, color: '#3b8beb', cursor: 'pointer', fontSize: 12, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, '+'),
        React.createElement('button', {
          onClick: handleRemoveLayer,
          disabled: scene.layers.length <= 1,
          style: { background: 'none', border: '1px solid #333355', borderRadius: 3, color: scene.layers.length <= 1 ? '#333' : '#e63e6d', cursor: scene.layers.length <= 1 ? 'default' : 'pointer', fontSize: 12, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' },
        }, '−'),
      ),
    ),
    React.createElement('div', { style: listStyle },
      scene.layers.map(layer => {
        const objectCount = scene.objects.filter(o => o.layerId === layer.id).length;
        const isActive = scene.activeLayerId === layer.id;
        const isSelectedLayer = scene.objects.some(o => selectedIds.has(o.id) && o.layerId === layer.id);
        const rowStyle = {
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          marginBottom: 4,
          borderRadius: 4,
          cursor: 'pointer',
          background: isActive ? '#1a1a2e' : isSelectedLayer ? '#141426' : 'transparent',
          border: '1px solid #23233a',
        };
        const iconButtonStyle = {
          background: 'none',
          border: '1px solid #2a2a40',
          borderRadius: 3,
          color: '#aaa',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: 11,
          width: 20,
          height: 20,
          lineHeight: '16px',
          padding: 0,
        };

        return React.createElement('div', {
          key: layer.id,
          style: rowStyle,
          onClick: () => setActiveLayer(layer.id),
        },
          React.createElement('div', {
            style: {
              width: 12,
              height: 12,
              borderRadius: 2,
              background: layer.color,
              border: '1px solid #000',
              flexShrink: 0,
            },
          }),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', {
              style: {
                color: '#ddd',
                whiteSpace: 'nowrap' as const,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }, layer.name),
            React.createElement('div', { style: { color: '#6f6f90', fontSize: 10 } },
              `${layer.settings.mode} • ${objectCount}`
            ),
          ),
          React.createElement('button', {
            style: iconButtonStyle,
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              toggleVisible(layer.id);
            },
            title: layer.visible ? 'Hide layer' : 'Show layer',
          }, layer.visible ? '👁' : '·'),
          React.createElement('button', {
            style: iconButtonStyle,
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
      React.createElement('div', { style: { color: '#7b7ba4' } }, 'Layer Settings'),
      React.createElement('div', { style: labelStyle }, 'Material Preset'),
      React.createElement('select', {
        style: inputStyle,
        value: '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          const preset = getPresetById(e.target.value);
          if (!preset || !activeLayer) return;
          const mode = activeLayer.settings.mode as 'cut' | 'engrave' | 'score';
          const modeSettings = preset.settings[mode] || preset.settings.cut;
          const newScene = {
            ...scene,
            layers: scene.layers.map(l =>
              l.id === activeLayer.id
                ? {
                    ...l,
                    settings: {
                      ...l.settings,
                      power: { ...l.settings.power, max: modeSettings.power },
                      speed: modeSettings.speed,
                      passes: modeSettings.passes,
                    },
                  }
                : l
            ),
          };
          onSceneCommit(newScene);
        },
      },
        React.createElement('option', { value: '' }, '— Select material —'),
        ...MATERIAL_PRESETS.map(p =>
          React.createElement('option', { key: p.id, value: p.id },
            p.name + (p.notes ? ' ⚠' : '')
          )
        ),
      ),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', null, 'Power %'),
        React.createElement('input', {
          type: 'number',
          min: 0,
          max: 100,
          value: activeLayer.settings.power.max,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => updatePower(Number(e.target.value)),
          style: inputStyle,
        }),
      ),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', null, 'Speed mm/min'),
        React.createElement('input', {
          type: 'number',
          value: activeLayer.settings.speed,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateSpeed(Number(e.target.value)),
          style: inputStyle,
        }),
      ),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', null, 'Mode'),
        React.createElement('select', {
          value: activeLayer.settings.mode,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => updateMode(e.target.value as LayerMode),
          style: inputStyle,
        },
          React.createElement('option', { value: 'cut' }, 'cut'),
          React.createElement('option', { value: 'engrave' }, 'engrave'),
          React.createElement('option', { value: 'score' }, 'score'),
          React.createElement('option', { value: 'image' }, 'image'),
        ),
      ),
    ),
  );
}
