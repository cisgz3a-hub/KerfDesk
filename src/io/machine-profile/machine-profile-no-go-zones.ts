import type { NoGoZone } from '../../core/devices';

export function parseNoGoZones(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly noGoZones: ReadonlyArray<NoGoZone> }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (value === undefined) return { kind: 'ok', noGoZones: [] };
  if (!Array.isArray(value)) return { kind: 'invalid', reason: 'profile.noGoZones is invalid' };
  const zones: NoGoZone[] = [];
  for (const [index, zone] of value.entries()) {
    if (!isRecord(zone)) return invalidNoGoZone(index);
    if (
      !isNonEmptyString(zone['id']) ||
      !isNonEmptyString(zone['name']) ||
      typeof zone['enabled'] !== 'boolean' ||
      !isNonNegativeFinite(zone['x']) ||
      !isNonNegativeFinite(zone['y']) ||
      !isPositiveFinite(zone['width']) ||
      !isPositiveFinite(zone['height'])
    ) {
      return invalidNoGoZone(index);
    }
    zones.push({
      id: zone['id'],
      name: zone['name'],
      enabled: zone['enabled'],
      x: zone['x'],
      y: zone['y'],
      width: zone['width'],
      height: zone['height'],
    });
  }
  return { kind: 'ok', noGoZones: zones };
}

function invalidNoGoZone(index: number): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason: `profile.noGoZones[${index}] is invalid` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
