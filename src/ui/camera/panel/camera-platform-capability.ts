import type { PlatformAdapter } from '../../../platform/types';

export function localCameraBridgeAvailable(
  platformId: PlatformAdapter['id'],
  hostname: string,
): boolean {
  if (platformId !== 'web') return true;
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
