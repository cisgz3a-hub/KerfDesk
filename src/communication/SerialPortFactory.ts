import { MockSerialPort, type SerialPortLike } from './SerialPort';
import { WebSerialPort } from './WebSerialPort';

export type SerialPortKind = 'web' | 'simulator';

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
  return new WebSerialPort();
}
