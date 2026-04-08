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
