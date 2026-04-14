/**
 * Shared layer mode transition (power, speed, fill, air assist) for LayerPanel and Connection panel.
 */

import { type Layer, type LayerMode } from './Layer';

export function applyLayerModeChange(layer: Layer, newMode: LayerMode): Layer {
  if (layer.settings.mode === newMode) return layer;

  const oldMode = layer.settings.mode;
  const s = layer.settings;
  let powerMax = s.power.max;
  let speed = s.speed;
  let fill = { ...s.fill, enabled: newMode === 'engrave' || newMode === 'image' };

  if (newMode === 'engrave' && oldMode === 'cut') {
    if (powerMax >= 60) powerMax = Math.round(powerMax * 0.4);
    if (speed <= 1000) {
      speed = Math.min(3000, Math.max(1200, Math.round(speed * 3)));
    }
  } else if (newMode === 'cut' && oldMode === 'engrave') {
    if (powerMax <= 50) powerMax = Math.min(100, Math.round(powerMax * 2.5));
    if (speed >= 2000) speed = Math.max(200, Math.round(speed / 3));
    else if (speed >= 800) speed = Math.max(150, Math.min(500, Math.round(speed * 0.35)));
  } else if (newMode === 'score') {
    if (powerMax >= 60) powerMax = Math.round(powerMax * 0.2);
    speed = Math.max(speed, 2000);
  } else if (newMode === 'cut' && oldMode === 'score') {
    if (powerMax <= 30) powerMax = Math.min(100, Math.round(powerMax * 2.5));
    if (speed >= 2000) speed = Math.max(200, Math.round(speed / 3));
  } else if (newMode === 'engrave' && oldMode === 'score') {
    if (powerMax <= 25) powerMax = Math.min(60, Math.round(powerMax * 2));
    if (speed >= 2500) speed = Math.max(800, Math.round(speed * 0.65));
  } else if (newMode === 'image' && oldMode === 'cut') {
    if (powerMax >= 60) powerMax = Math.round(powerMax * 0.45);
    if (speed <= 1000) speed = Math.min(2500, Math.round(speed * 3));
  } else if (newMode === 'cut' && oldMode === 'image') {
    if (powerMax <= 45) powerMax = Math.min(100, Math.round(powerMax * 1.8));
    if (speed >= 2000) speed = Math.max(200, Math.round(speed / 3));
  }

  powerMax = Math.max(0, Math.min(100, powerMax));
  speed = Math.max(1, speed);

  if (newMode === 'engrave') {
    const rawIv = Number(s.fill.interval);
    const interval = Number.isFinite(rawIv) && rawIv > 0 ? rawIv : 0.1;
    const modeFill = s.fill.mode === 'offset' || s.fill.mode === 'cross-hatch' ? s.fill.mode : 'line';
    fill = {
      enabled: true,
      interval,
      angle: Number.isFinite(s.fill.angle) ? s.fill.angle % 360 : 0,
      mode: modeFill,
      biDirectional: s.fill.biDirectional,
      overscanning: Math.max(0, Number.isFinite(s.fill.overscanning) ? s.fill.overscanning : 2.5),
    };
  }

  return {
    ...layer,
    settings: {
      ...s,
      mode: newMode,
      power: { ...s.power, max: powerMax },
      speed,
      fill,
      airAssist: newMode === 'cut',
    },
  };
}
