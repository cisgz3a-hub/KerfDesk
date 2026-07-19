import { useLaserStore } from './laser-store';

type EmitControllerLine = (line: string) => void;

/** Complete only the stock-GRBL queries owned by the connect handshake.
 * Runtime query behavior remains under each test harness's explicit control. */
export function respondToStockGrblHandshakeQuery(
  data: string,
  emitLine: EmitControllerLine,
): boolean {
  if (useLaserStore.getState().controllerOperation?.kind !== 'connection-handshake') return false;
  if (data === '$I\n') {
    emitLine('[VER:1.1h.20190830:test]');
    emitLine('[OPT:VM,15,128]');
    emitLine('ok');
    return true;
  }
  if (data === '$G\n') {
    emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    emitLine('ok');
    return true;
  }
  return false;
}
