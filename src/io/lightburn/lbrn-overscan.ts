type LightBurnOverscan = {
  readonly distanceMm: number | null;
  readonly warnings: ReadonlyArray<string>;
};

const PERCENT_SCALE = 100;

/** LightBurn persists the enable switch separately from the percentage. */
export function resolveLightBurnOverscan(
  enabled: boolean | null,
  percent: number | null,
  speedMmSec: number | null,
  layerName: string,
  fallbackDistanceMm = 5,
): LightBurnOverscan {
  if (enabled === false) return { distanceMm: 0, warnings: [] };
  if (enabled === null && percent === null) return { distanceMm: null, warnings: [] };
  if (enabled === null) {
    return unresolved(layerName, 'an explicit overscan enable value', fallbackDistanceMm);
  }
  if (percent === null || percent < 0) {
    return unresolved(layerName, 'a nonnegative imported percentage', fallbackDistanceMm);
  }
  if (percent === 0) return { distanceMm: 0, warnings: [] };
  if (speedMmSec === null || speedMmSec <= 0) {
    return unresolved(layerName, 'a positive imported speed', fallbackDistanceMm);
  }
  const distanceMm = speedMmSec * (percent / PERCENT_SCALE);
  if (!Number.isFinite(distanceMm)) {
    return unresolved(layerName, 'a finite converted distance', fallbackDistanceMm);
  }
  return {
    distanceMm,
    warnings: [
      `${layerName}: LightBurn Scan overscan ${percent}% was converted to ${distanceMm} mm at ${speedMmSec} mm/s; review it after changing speed because LaserForge stores a fixed physical runway.`,
    ],
  };
}

function unresolved(
  layerName: string,
  missing: string,
  fallbackDistanceMm: number,
): LightBurnOverscan {
  return {
    distanceMm: null,
    warnings: [
      `${layerName}: LightBurn Scan overscan could not be converted without ${missing}; review the default ${fallbackDistanceMm} mm runway.`,
    ],
  };
}
