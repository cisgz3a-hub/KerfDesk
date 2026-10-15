import { RT_SOFT_RESET } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import {
  captureTestLaserStartFenceAck,
  respondToTestGrblHandshake,
} from './laser-test-start-helpers';

export type DisconnectTestConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

export function makeDisconnectTestConnection(
  label: string,
  events: string[],
  onWrite?: (data: string, emitLine: (line: string) => void) => void | Promise<void>,
  onCloseRequest?: () => void | Promise<void>,
): DisconnectTestConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      events.push(`${label}:write:${JSON.stringify(data)}`);
      const acknowledgeFence = captureTestLaserStartFenceAck(data, emitLine);
      await onWrite?.(data, emitLine);
      acknowledgeFence();
      respondToTestGrblHandshake(data, emitLine, 'G0 G54');
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => {
      events.push(`${label}:close`);
      await onCloseRequest?.();
    },
    forget: async () => {
      events.push(`${label}:forget`);
    },
    emitLine,
  };
}

export function disconnectTestAdapter(
  connection: SerialConnection,
  events?: string[],
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => {
        events?.push('picker');
        return {
          open: async () => {
            events?.push('open');
            return connection;
          },
        };
      },
    },
  };
}

export function disconnectSafetyEvents(
  events: ReadonlyArray<string>,
  label: string,
): ReadonlyArray<string> {
  const expectedWrites = new Set([
    `${label}:write:${JSON.stringify(RT_SOFT_RESET)}`,
    `${label}:write:${JSON.stringify('M5\n')}`,
    `${label}:write:${JSON.stringify('M9\n')}`,
    `${label}:close`,
  ]);
  return events.filter((event) => expectedWrites.has(event));
}
