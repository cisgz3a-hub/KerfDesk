// Auto-connect (ADR-420): when KerfDesk starts, and whenever a port the operator
// picked before is plugged in, connect to the machine's remembered port by
// itself. It opens only a port chooseGrantedPort would open without asking,
// never shows a picker, and does nothing while any connection, job or
// controller operation exists. Connecting reads the controller's settings and
// moves nothing. The Connect menu's "Connect automatically" turns it off.

import { useEffect } from 'react';
import type { PlatformAdapter } from '../../platform/types';
import { connectOptionsForDevice, hasFileOnlyTransport } from '../commands/connect-options';
import { usePlatformOptional } from './platform-context';
import { useStore } from '../state';
import { browserLocalStorage } from '../state/browser-local-storage';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import {
  chooseGrantedPort,
  loadAutoConnectPreference,
  loadRememberedSerialPort,
} from '../state/serial-port-memory';

export function useAutoConnectController(): void {
  const platform = usePlatformOptional();
  useEffect(() => {
    if (platform === null) return undefined;
    return installAutoConnect(platform);
  }, [platform]);
}

export function installAutoConnect(platform: PlatformAdapter): () => void {
  const serial = platform.serial;
  if (!serial.isSupported() || serial.grantedPorts === undefined) return () => undefined;
  let disposed = false;
  let running = false;
  const attempt = async (): Promise<void> => {
    if (disposed || running || !autoConnectAllowed()) return;
    running = true;
    try {
      const granted = (await serial.grantedPorts?.()) ?? [];
      const remembered = loadRememberedSerialPort(browserLocalStorage());
      if (disposed || chooseGrantedPort(granted, remembered).kind !== 'use') return;
      if (!autoConnectAllowed()) return;
      const device = useStore.getState().project.device;
      await useLaserStore
        .getState()
        .connect(platform, { ...connectOptionsForDevice(device), portSelection: 'automatic' });
    } catch {
      // A port another program holds, or one unplugged mid-open, leaves the
      // failed state for the operator's own Connect; nothing else to do here.
    } finally {
      running = false;
    }
  };
  void attempt();
  const unsubscribe = serial.onGrantedPortsChange?.(() => void attempt());
  return () => {
    disposed = true;
    unsubscribe?.();
  };
}

function autoConnectAllowed(): boolean {
  if (!loadAutoConnectPreference(browserLocalStorage())) return false;
  const laser = useLaserStore.getState();
  if (laser.connection.kind === 'connecting' || laser.connection.kind === 'connected') return false;
  if (laser.motionOperation !== null || laser.controllerOperation !== null) return false;
  if (isActiveJob(laser.streamer)) return false;
  return !hasFileOnlyTransport(useStore.getState().project.device);
}
