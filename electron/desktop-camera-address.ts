import { safeStorage } from 'electron';
import { createCameraAddressStore } from './camera-address-store.js';
import { withCameraAddressRoutes } from './camera-address-routes.js';
import type { ProtocolHandler } from './licensing-routes.js';

/** The app route that keeps the remembered RTSP address under OS encryption (ADR-692). */
export function withDesktopCameraAddress(
  fallback: ProtocolHandler,
  userDataPath: string,
): ProtocolHandler {
  return withCameraAddressRoutes(
    fallback,
    createCameraAddressStore({
      userDataPath,
      platform: process.platform,
      secureStorage: safeStorage,
    }),
  );
}
