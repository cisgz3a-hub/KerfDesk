import React from 'react';
import type { Scene } from '../../../core/scene/Scene';
import type { LayerMode } from '../../../core/scene/Layer';
import { createLayer } from '../../../core/scene/Layer';
import { theme } from '../../styles/theme';

interface LayerTabsProps {
  scene: Scene;
  onLayerSelect: (layerId: string) => void;
  onSceneCommit: (scene: Scene) => void;
}

function modeIcon(mode: LayerMode): string {
  if (mode === 'cut') return '✂';
  if (mode === 'engrave') return '▤';
  if (mode === 'score') return '╌';
  return '🖼';
}

function modeColor(mode: LayerMode): string {
  if (mode === 'cut') return '#e63e6d';
  if (mode === 'engrave') return '#3b8beb';
  if (mode === 'score') return '#f5a623';
  return '#2dd4a0';
}

export const LAYER_TABS_WIDTH = 56;

export function LayerTabs({ scene, onLayerSelect, onSceneCommit }: LayerTabsProps) {
  const activeId = scene.activeLayerId;
  const layers = [...scene.layers].sort((a, b) => a.order - b.order);

  const handleAdd = () => {
    const maxOrder = scene.layers.length > 0 ? Math.max(...scene.layers.map(l => l.order)) : -1;
    const nextOrder = maxOrder + 1;
    const newLayer = createLayer(nextOrder, 'cut', `Layer ${nextOrder + 1}`);
    const newScene = {
      ...scene,
      layers: [...scene.layers, newLayer],
      activeLayerId: newLayer.id,
    };
    onSceneCommit(newScene);
  };

  return React.createElement('div', {
    style: {
      width: LAYER_TABS_WIDTH,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      background: '#08080f',
      paddingTop: 4,
      gap: 2,
      userSelect: 'none' as const,
    },
  },
  ...layers.map(layer => {
    const isActive = layer.id === activeId;
    const color = modeColor(layer.settings.mode);

    return React.createElement('button', {
      key: layer.id,
      type: 'button',
      onClick: () => onLayerSelect(layer.id),
      title: `${layer.name} — ${layer.settings.mode} (${layer.settings.power.max}% @ ${layer.settings.speed}mm/min)`,
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: '8px 4px',
        border: 'none',
        borderRight: isActive ? `2px solid ${color}` : '2px solid transparent',
        background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        width: '100%',
      },
    },
      React.createElement('div', {
        style: {
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          opacity: isActive ? 1 : 0.4,
          transition: 'opacity 0.15s ease',
        },
      }),
      React.createElement('span', {
        style: {
          fontSize: 14,
          lineHeight: 1,
          opacity: isActive ? 1 : 0.4,
        },
      }, modeIcon(layer.settings.mode)),
      React.createElement('span', {
        style: {
          fontSize: 8,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          color: isActive ? color : '#444466',
          fontWeight: isActive ? 600 : 400,
          letterSpacing: '0.03em',
          textTransform: 'uppercase' as const,
          whiteSpace: 'nowrap' as const,
        },
      }, layer.settings.mode),
      React.createElement('span', {
        style: {
          fontSize: 7,
          fontFamily: theme.font.mono,
          color: isActive ? '#888' : '#333',
        },
      }, `${layer.settings.power.max}%`),
    );
  }),
  React.createElement('button', {
    type: 'button',
    onClick: handleAdd,
    title: 'Add new layer',
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px 4px',
      marginTop: 4,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: '#333355',
      fontSize: 16,
      transition: 'color 0.15s ease',
    },
  }, '+'),
  );
}
