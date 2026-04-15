import { MockSerialPort, type SerialPortLike } from './SerialPort';
import { WebSerialPort } from './WebSerialPort';
import { WebSocketSerialPort } from './WebSocketSerialPort';

export type SerialPortKind = 'web' | 'simulator' | 'websocket';

export interface SerialPortFactoryOptions {
  bedWidth?: number;
  bedHeight?: number;
}

export function createSerialPort(
  kind: SerialPortKind,
  options: SerialPortFactoryOptions = {},
): SerialPortLike {
  if (kind === 'simulator') {
    return new MockSerialPort(undefined, {
      width: options.bedWidth ?? 400,
      height: options.bedHeight ?? 300,
    });
  }
  if (kind === 'websocket') {
    return new WebSocketSerialPort();
  }
  return new WebSerialPort();
}
