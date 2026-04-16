/**
 * Serial port helpers for Electron main process (GRBL).
 */
import { SerialPort } from 'serialport';

let port: SerialPort | null = null;

export async function listSerialPorts(): Promise<{ path: string; manufacturer?: string }[]> {
  const ports = await SerialPort.list();
  return ports.map(p => ({
    path: p.path,
    manufacturer: p.manufacturer ?? undefined,
  }));
}

export async function openSerial(pathStr: string, baudRate: number): Promise<boolean> {
  await closeSerial();
  return new Promise((resolve) => {
    try {
      const p = new SerialPort({
        path: pathStr,
        baudRate,
        autoOpen: false,
      });
      p.open((err) => {
        if (err) {
          console.error('Serial open failed:', err);
          resolve(false);
          return;
        }
        port = p;
        resolve(true);
      });
    } catch (e) {
      console.error(e);
      resolve(false);
    }
  });
}

export async function closeSerial(): Promise<void> {
  const p = port;
  if (!p) return;
  return new Promise((resolve) => {
    if (!p.isOpen) {
      port = null;
      resolve();
      return;
    }
    p.close((err) => {
      if (err) console.error(err);
      port = null;
      resolve();
    });
  });
}

/**
 * Safety shutdown: feed hold + laser off, wait for bytes to transmit,
 * then close the port. Used from Electron before-quit so the laser does
 * not stay on when the app exits. Avoids soft reset (0x18) so position is not lost.
 */
export async function safeCloseSerial(): Promise<void> {
  const p = port;
  if (!p?.isOpen) {
    port = null;
    return;
  }
  try {
    p.write(Buffer.from([0x21])); // feed hold — clean pause, preserves position
    await new Promise<void>(r => setTimeout(r, 50));
    p.write('M5 S0\n');
    await new Promise<void>((resolve) => {
      p.drain((err) => {
        if (err) console.error('[safeCloseSerial] drain error:', err);
        resolve();
      });
    });
  } catch (err) {
    console.error('[safeCloseSerial] write error:', err);
  }
  await new Promise(r => setTimeout(r, 100));
  return closeSerial();
}

export async function writeSerialLine(line: string): Promise<void> {
  const p = port;
  if (!p?.isOpen) throw new Error('Serial port not open');
  const data = line.endsWith('\n') ? line : `${line}\n`;
  return new Promise((resolve, reject) => {
    p.write(data, (err) => {
      if (err) {
        reject(err);
        return;
      }
      p.drain((drainErr) => {
        if (drainErr) reject(drainErr);
        else resolve();
      });
    });
  });
}
