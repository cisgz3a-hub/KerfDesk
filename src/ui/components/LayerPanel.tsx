import React, { useCallback } from 'react';
import { type Scene, getActiveLayer } from '../../core/scene/Scene';
import { type Layer, type LayerMode, type FillMode, createLayer } from '../../core/scene/Layer';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_PRESETS,
  canCutMaterial,
  getPresetSettings,
} from '../../core/materials/MaterialPresets';
import { getSuggestion } from '../../core/materials/MaterialFeedback';
import { theme } from '../styles/theme';
import { NumberInput } from './NumberInput';

interface LayerPanelProps {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  onSceneCommit: (scene: Scene) => void;
  productionMode: boolean;
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

export function LayerPanel({ scene, selectedIds, onSceneCommit, productionMode }: LayerPanelProps) {
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
          borderLeft: layer.id === scene.activeLayerId ? `3px solid ${layer.color}` : '3px solid transparent',
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
            // Layer name — dimmed when output is off
            React.createElement('span', {
              style: {
                color: layer.output ? '#e0e0ec' : '#555570',
                textDecoration: layer.output ? 'none' : 'line-through',
                fontSize: 12,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap' as const,
                fontWeight: 500,
                display: 'block',
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
          // Output toggle — controls whether this layer is included in G-code
          React.createElement('button', {
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              const newLayers = scene.layers.map(l =>
                l.id === layer.id ? { ...l, output: !l.output } : l
              );
              onSceneCommit({ ...scene, layers: newLayers });
            },
            title: layer.output ? 'Layer included in output — click to exclude' : 'Layer excluded from output — click to include',
            style: {
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, padding: '0 2px',
              color: layer.output ? '#2dd4a0' : '#333355',
              opacity: layer.output ? 0.8 : 0.4,
            },
          }, layer.output ? '⚡' : '○'),
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
      // Output disabled notice
      !activeLayer.output && React.createElement('div', {
        style: {
          padding: '8px 12px', margin: '4px 0',
          background: 'rgba(255,170,50,0.06)',
          border: '1px solid rgba(255,170,50,0.15)',
          borderRadius: 6, fontSize: 10, color: '#ffaa32',
          textAlign: 'center' as const,
        },
      }, 'This layer is visible but excluded from output'),
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
      React.createElement('div', { style: { marginTop: 6 } },
        React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Material Preset'),
        React.createElement('select', {
          value: '',
          style: selectStyle,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
            const presetName = e.target.value;
            if (!presetName || !activeLayer) return;

            const machineType = scene.machine?.type || 'diode';
            const settings = getPresetSettings(presetName, machineType, scene.machine?.watts || '10');
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

            const preset = MATERIAL_PRESETS.find(p => p.name === presetName);
            const categoryToSceneMaterialType = (category: string): NonNullable<typeof scene.material>['type'] => {
              if (category === 'Acrylic') return 'acrylic';
              if (category === 'Leather') return 'leather';
              if (category === 'Paper & Card') return 'paper';
              if (category === 'Fabric') return 'fabric';
              if (category === 'Wood' || category === 'Plywood' || category === 'MDF') return 'wood';
              return 'custom';
            };
            const matType = preset ? categoryToSceneMaterialType(preset.category) : 'custom';

            const updatedMaterial = scene.material
              ? {
                  ...scene.material,
                  name: presetName,
                  type: matType,
                  thickness: preset?.thickness ?? scene.material.thickness,
                }
              : {
                  type: matType,
                  name: presetName,
                  width: scene.canvas.width * 0.6,
                  height: scene.canvas.height * 0.5,
                  x: scene.canvas.width * 0.1,
                  y: scene.canvas.height * 0.1,
                  thickness: preset?.thickness ?? 3,
                  color: '#c4956a',
                  enabled: true,
                };

            onSceneCommit({ ...scene, layers: newLayers, material: updatedMaterial });
          },
        },
          React.createElement('option', { value: '' }, '— Select material —'),
          ...MATERIAL_CATEGORIES.map(cat => {
            const presets = MATERIAL_PRESETS.filter(p => p.category === cat);
            if (presets.length === 0) return null;
            return React.createElement('optgroup', { key: cat, label: cat },
              ...presets.map(p =>
                React.createElement('option', { key: p.name, value: p.name }, p.name),
              ),
            );
          }).filter(Boolean),
        ),
        (() => {
          const selectedPresetName = scene.material?.name || '';
          return selectedPresetName &&
            !canCutMaterial(selectedPresetName, scene.machine?.type || 'diode', scene.machine?.watts || '10') &&
            activeLayer.settings.mode === 'cut'
            ? React.createElement('div', {
              style: {
                fontSize: 9,
                color: '#ff4466',
                marginTop: 3,
                padding: '3px 6px',
                background: 'rgba(255,68,102,0.06)',
                borderRadius: 4,
              },
            }, '⚠ This material cannot be cut with your laser type. Use CO2 laser or switch to engrave mode.')
            : null;
        })(),
        React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 3 } },
          `Settings for ${scene.machine?.type || 'diode'} laser. Run a material test to fine-tune.`,
        ),
      ),
      (() => {
        const machineType = scene.machine?.type || 'diode';
        const materialName = scene.material?.name || '';
        if (!materialName) return null;

        const suggestion = getSuggestion(materialName, machineType, activeLayer.settings.mode);
        if (!suggestion || suggestion.sampleCount === 0) return null;

        return React.createElement('div', {
          style: {
            margin: '6px 0', padding: '6px 10px',
            background: suggestion.confidence > 0 ? 'rgba(45,212,160,0.06)' : 'rgba(255,212,68,0.06)',
            border: `1px solid ${suggestion.confidence > 0 ? 'rgba(45,212,160,0.15)' : 'rgba(255,212,68,0.15)'}`,
            borderRadius: 6, fontSize: 10,
          },
        },
          React.createElement('div', {
            style: { fontWeight: 600, marginBottom: 3, color: suggestion.confidence > 0 ? '#2dd4a0' : '#ffd444' },
          }, suggestion.confidence > 0
            ? `✓ Learned: ${suggestion.confidence}% confidence (${suggestion.sampleCount} jobs)`
            : `⚡ Suggested adjustment (${suggestion.sampleCount} jobs tried)`),
          React.createElement('div', { style: { color: '#8888aa', marginBottom: 4 } },
            `Power ${suggestion.power}% · Speed ${suggestion.speed} · ${suggestion.passes} pass${suggestion.passes > 1 ? 'es' : ''}`),
          React.createElement('button', {
            onClick: () => {
              const newLayers = scene.layers.map(l =>
                l.id === activeLayer.id
                  ? {
                      ...l,
                      settings: {
                        ...l.settings,
                        power: { ...l.settings.power, max: suggestion.power },
                        speed: suggestion.speed,
                        passes: suggestion.passes,
                      },
                    }
                  : l
              );
              onSceneCommit({ ...scene, layers: newLayers });
            },
            style: {
              padding: '3px 10px', fontSize: 10, cursor: 'pointer',
              background: 'rgba(255,255,255,0.03)', border: '1px solid #252540',
              borderRadius: 4, color: '#e0e0ec', fontFamily: "'DM Sans', system-ui, sans-serif",
            },
          }, 'Apply suggestion'),
        );
      })(),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', { style: settingsLabelStyle }, 'Power %'),
        React.createElement(NumberInput, {
          value: activeLayer.settings.power.max,
          min: 0,
          max: 100,
          defaultValue: activeLayer.settings.power.max,
          style: numberInputStyle,
          onCommit: updatePower,
        }),
      ),
      React.createElement('label', { style: fieldStyle },
        React.createElement('span', { style: settingsLabelStyle }, 'Speed mm/min'),
        React.createElement(NumberInput, {
          value: activeLayer.settings.speed,
          min: 1,
          max: 250000,
          defaultValue: activeLayer.settings.speed,
          style: numberInputStyle,
          onCommit: updateSpeed,
        }),
      ),
      React.createElement('div', { style: { marginTop: 6 } },
        React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Passes'),
        React.createElement(NumberInput, {
          value: activeLayer.settings.passes ?? 1,
          min: 1,
          max: 20,
          integer: true,
          inputMode: 'numeric',
          defaultValue: activeLayer.settings.passes ?? 1,
          style: numberInputStyle,
          onCommit: (n: number) => {
            onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
              ...l,
              settings: { ...l.settings, passes: n },
            })));
          },
        }),
      ),
      productionMode && React.createElement('div', {
        style: { marginTop: 8, padding: '8px 0', borderTop: '1px solid #1a1a2e' },
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
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
      productionMode && React.createElement('label', { style: { ...fieldStyle, marginTop: 8 } },
        React.createElement('span', { style: settingsLabelStyle }, 'Power min %'),
        React.createElement(NumberInput, {
          value: activeLayer.settings.power.min,
          min: 0,
          max: 100,
          defaultValue: activeLayer.settings.power.min,
          style: numberInputStyle,
          onCommit: (n: number) => {
            onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
              ...l,
              settings: { ...l.settings, power: { ...l.settings.power, min: n } },
            })));
          },
        }),
      ),
      productionMode && React.createElement('label', { style: { ...fieldStyle, marginTop: 6 } },
        React.createElement('span', { style: settingsLabelStyle }, 'Z step per pass (mm)'),
        React.createElement(NumberInput, {
          value: activeLayer.settings.zStepPerPass,
          min: -500,
          max: 500,
          defaultValue: activeLayer.settings.zStepPerPass,
          style: numberInputStyle,
          onCommit: (n: number) => {
            onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
              ...l,
              settings: { ...l.settings, zStepPerPass: n },
            })));
          },
        }),
      ),
      productionMode && activeLayer.settings.mode === 'engrave' && React.createElement('div', {
        style: { marginTop: 8, padding: '8px 0', borderTop: '1px solid #1a1a2e' },
      },
        React.createElement('div', {
          style: { fontSize: 9, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 1 },
        }, 'Fill Settings'),
        React.createElement('label', { style: { ...fieldStyle, marginTop: 4 } },
          React.createElement('span', { style: settingsLabelStyle }, 'Fill mode'),
          React.createElement('select', {
            value: activeLayer.settings.fill.mode || 'line',
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const v = e.target.value as FillMode;
              if (v !== 'line') return;
              onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                ...l,
                settings: { ...l.settings, fill: { ...l.settings.fill, mode: v } },
              })));
            },
            style: selectStyle,
          },
            React.createElement('option', { value: 'line' }, 'Lines (scanline fill)'),
            React.createElement('option', { value: 'offset', disabled: true }, 'Offset fill (coming soon)'),
            React.createElement('option', { value: 'cross-hatch', disabled: true }, 'Cross-hatch (coming soon)'),
          ),
        ),
        React.createElement('label', { style: { ...fieldStyle, marginTop: 4 } },
            React.createElement('span', { style: settingsLabelStyle }, 'Interval (mm)'),
            React.createElement(NumberInput, {
              value: activeLayer.settings.fill.interval,
              min: 0.01,
              max: 100,
              defaultValue: activeLayer.settings.fill.interval,
              style: numberInputStyle,
              onCommit: (n: number) => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, fill: { ...l.settings.fill, interval: n } },
                })));
              },
            }),
          ),
          React.createElement('label', { style: { ...fieldStyle, marginTop: 6 } },
            React.createElement('span', { style: settingsLabelStyle }, 'Angle (°)'),
            React.createElement(NumberInput, {
              value: activeLayer.settings.fill.angle,
              min: -360,
              max: 360,
              defaultValue: activeLayer.settings.fill.angle,
              style: numberInputStyle,
              onCommit: (n: number) => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, fill: { ...l.settings.fill, angle: n } },
                })));
              },
            }),
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 } },
            React.createElement('div', { style: { fontSize: 11, color: '#8888aa' } }, 'Bidirectional'),
            React.createElement('button', {
              onClick: () => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, fill: { ...l.settings.fill, biDirectional: !l.settings.fill.biDirectional } },
                })));
              },
              style: {
                padding: '3px 12px',
                background: activeLayer.settings.fill.biDirectional ? 'rgba(45, 212, 160, 0.1)' : 'rgba(255,255,255,0.03)',
                border: activeLayer.settings.fill.biDirectional ? '1px solid #2dd4a0' : '1px solid #252540',
                borderRadius: 4,
                color: activeLayer.settings.fill.biDirectional ? '#2dd4a0' : '#555570',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: "'DM Sans', system-ui, sans-serif",
              },
            }, activeLayer.settings.fill.biDirectional ? 'ON' : 'OFF'),
          ),
          React.createElement('label', { style: { ...fieldStyle, marginTop: 6 } },
            React.createElement('span', { style: settingsLabelStyle }, 'Overscanning (mm)'),
            React.createElement(NumberInput, {
              value: activeLayer.settings.fill.overscanning,
              min: 0,
              max: 500,
              defaultValue: activeLayer.settings.fill.overscanning,
              style: numberInputStyle,
              onCommit: (n: number) => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, fill: { ...l.settings.fill, overscanning: n } },
                })));
              },
            }),
          ),
      ),
      productionMode && (activeLayer.settings.mode === 'cut' || activeLayer.settings.mode === 'score') && React.createElement('div', {
        style: { marginTop: 8, padding: '8px 0', borderTop: '1px solid #1a1a2e' },
      },
        React.createElement('div', {
          style: { fontSize: 9, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 1 },
        }, 'Advanced Cut'),
        React.createElement('div', { style: { marginTop: 6 } },
            React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Overcut (mm)'),
            React.createElement(NumberInput, {
              value: activeLayer.settings.cut.overcut,
              min: 0,
              max: 100,
              defaultValue: activeLayer.settings.cut.overcut,
              style: numberInputStyle,
              onCommit: (n: number) => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, cut: { ...l.settings.cut, overcut: n } },
                })));
              },
            }),
          ),
          React.createElement('div', { style: { marginTop: 6 } },
            React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Lead-in (mm)'),
            React.createElement(NumberInput, {
              value: activeLayer.settings.cut.leadIn,
              min: 0,
              max: 100,
              defaultValue: activeLayer.settings.cut.leadIn,
              style: numberInputStyle,
              onCommit: (n: number) => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, cut: { ...l.settings.cut, leadIn: n } },
                })));
              },
            }),
          ),
          React.createElement('div', { style: { marginTop: 6 } },
            React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Tab count'),
            React.createElement(NumberInput, {
              value: activeLayer.settings.cut.tabCount,
              min: 0,
              max: 100,
              integer: true,
              inputMode: 'numeric',
              defaultValue: activeLayer.settings.cut.tabCount,
              style: numberInputStyle,
              onCommit: (n: number) => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, cut: { ...l.settings.cut, tabCount: n } },
                })));
              },
            }),
          ),
          React.createElement('div', { style: { marginTop: 6 } },
            React.createElement('div', { style: { fontSize: 11, color: '#8888aa', marginBottom: 2 } }, 'Tab width (mm)'),
            React.createElement(NumberInput, {
              value: activeLayer.settings.cut.tabWidth,
              min: 0,
              max: 100,
              defaultValue: activeLayer.settings.cut.tabWidth,
              style: numberInputStyle,
              onCommit: (n: number) => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, cut: { ...l.settings.cut, tabWidth: n } },
                })));
              },
            }),
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 } },
            React.createElement('div', { style: { fontSize: 11, color: '#8888aa' } }, 'Inside first'),
            React.createElement('button', {
              onClick: () => {
                onSceneCommit(updateLayer(scene, activeLayer.id, l => ({
                  ...l,
                  settings: { ...l.settings, cut: { ...l.settings.cut, insideFirst: !l.settings.cut.insideFirst } },
                })));
              },
              style: {
                padding: '3px 12px',
                background: activeLayer.settings.cut.insideFirst ? 'rgba(45, 212, 160, 0.1)' : 'rgba(255,255,255,0.03)',
                border: activeLayer.settings.cut.insideFirst ? '1px solid #2dd4a0' : '1px solid #252540',
                borderRadius: 4,
                color: activeLayer.settings.cut.insideFirst ? '#2dd4a0' : '#555570',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: "'DM Sans', system-ui, sans-serif",
              },
            }, activeLayer.settings.cut.insideFirst ? 'ON' : 'OFF'),
          ),
      ),
      productionMode && React.createElement('label', { style: { ...fieldStyle, marginTop: 8, opacity: 0.7 } },
        React.createElement('span', { style: settingsLabelStyle }, 'Cut order (coming soon)'),
        React.createElement('select', {
          value: activeLayer.settings.cutOrder,
          disabled: true,
          title: 'Stored for future use — planner uses fixed ordering today.',
          style: { ...selectStyle, cursor: 'not-allowed', opacity: 0.85 },
        },
          React.createElement('option', { value: 'layer-priority' }, 'layer-priority'),
          React.createElement('option', { value: 'object-order' }, 'object-order'),
          React.createElement('option', { value: 'optimized' }, 'optimized'),
        ),
      ),
    ),
  );
}
