import { resolveGrblDialect, type DeviceProfile } from '../devices';

export type IslandFillMotionPolicy = 'adaptive' | 'sensitive';

export function islandFillMotionPolicyForDevice(device: DeviceProfile): IslandFillMotionPolicy {
  return resolveGrblDialect(device).id === 'neotronics-4040-safe' ? 'sensitive' : 'adaptive';
}

export function isSensitiveIslandFillPolicy(
  policy: IslandFillMotionPolicy | undefined,
): boolean {
  return policy === 'sensitive';
}
