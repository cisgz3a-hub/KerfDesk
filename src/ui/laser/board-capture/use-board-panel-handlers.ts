import type { DeviceProfile } from '../../../core/devices';
import type { Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import type { BoardCapture } from './use-board-capture';
import { useBoardCaptureHandlers, type BoardCaptureHandlers } from './use-board-capture-handlers';

export function useBoardPanelHandlers(
  capture: BoardCapture,
  livePosition: Vec2 | null,
  device: DeviceProfile,
): BoardCaptureHandlers {
  const setOriginHere = useLaserStore((state) => state.setOriginHere);
  const setOriginAtMachinePoint = useLaserStore((state) => state.setOriginAtMachinePoint);
  const addCapturedBoard = useStore((state) => state.addCapturedBoard);
  const registerCapturedBoardOutline = useStore((state) => state.registerCapturedBoardOutline);
  const updateCapturedBoard = useStore((state) => state.updateCapturedBoard);
  return useBoardCaptureHandlers({
    capture,
    livePosition,
    device,
    setOriginHere,
    setOriginAtMachinePoint,
    addCapturedBoard,
    registerCapturedBoardOutline,
    updateCapturedBoard,
  });
}
