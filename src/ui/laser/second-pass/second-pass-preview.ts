import { toSceneCoords, type DeviceProfile } from '../../../core/devices';
import { visitLaserSecondPassSource } from '../../../core/laser-second-pass/source';
import type { ExecutionArtifactV1 } from '../../state/recovery';

export type PreviewBounds = { minX: number; minY: number; maxX: number; maxY: number };
export const SECOND_PASS_SEGMENTS_PER_CHUNK = 256;
/** Scene-space XY endpoints and original normalised S, five numbers per segment. */
export type SecondPassDrawing = {
  segments: Float64Array;
  bounds: PreviewBounds;
  /** Four scene-space bounds values per consecutive 256-segment chunk. */
  chunkBounds: Float64Array;
};

function emptyBounds(): PreviewBounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function include(bounds: PreviewBounds, ax: number, ay: number, bx: number, by: number): void {
  bounds.minX = Math.min(bounds.minX, ax, bx);
  bounds.minY = Math.min(bounds.minY, ay, by);
  bounds.maxX = Math.max(bounds.maxX, ax, bx);
  bounds.maxY = Math.max(bounds.maxY, ay, by);
}

export function secondPassDrawing(
  gcode: string,
  device: DeviceProfile,
  initialPosition?: { x: number; y: number },
): SecondPassDrawing {
  const chunks: Float64Array[] = [];
  const boxes: PreviewBounds[] = [];
  const bounds = emptyBounds();
  let count = 0;
  visitLaserSecondPassSource(gcode, initialPosition, (segment) => {
    const strength = segment.power / device.maxPowerS;
    if (!(strength > 0)) return;
    const a = toSceneCoords(segment.from, device);
    const b = toSceneCoords(segment.to, device);
    const offset = (count % SECOND_PASS_SEGMENTS_PER_CHUNK) * 5;
    if (offset === 0) {
      chunks.push(new Float64Array(SECOND_PASS_SEGMENTS_PER_CHUNK * 5));
      boxes.push(emptyBounds());
    }
    const chunk = chunks[chunks.length - 1];
    const box = boxes[boxes.length - 1];
    if (chunk === undefined || box === undefined) return;
    chunk[offset] = a.x;
    chunk[offset + 1] = a.y;
    chunk[offset + 2] = b.x;
    chunk[offset + 3] = b.y;
    chunk[offset + 4] = strength;
    include(box, a.x, a.y, b.x, b.y);
    include(bounds, a.x, a.y, b.x, b.y);
    count += 1;
  });
  if (count === 0) throw new Error('This saved job has no laser engraving to select.');
  return packDrawing(chunks, boxes, count, bounds);
}

function packDrawing(
  chunks: ReadonlyArray<Float64Array>,
  boxes: ReadonlyArray<PreviewBounds>,
  count: number,
  bounds: PreviewBounds,
): SecondPassDrawing {
  const segments = new Float64Array(count * 5);
  const chunkBounds = new Float64Array(boxes.length * 4);
  chunks.forEach((chunk, index) => {
    const offset = index * SECOND_PASS_SEGMENTS_PER_CHUNK * 5;
    segments.set(chunk.subarray(0, Math.min(chunk.length, segments.length - offset)), offset);
  });
  boxes.forEach((box, index) => {
    chunkBounds.set([box.minX, box.minY, box.maxX, box.maxY], index * 4);
  });
  return { segments, chunkBounds, bounds };
}

export function sourceInitialPosition(
  source: ExecutionArtifactV1,
): { x: number; y: number; z: number } | undefined {
  const observation = source.archivedControllerObservation;
  const report = observation.statusReport;
  const scale = observation.settings?.reportInches === true ? 25.4 : 1;
  const wco = observation.wco ?? report?.wco;
  const p =
    report?.wPos ??
    (report?.mPos && wco
      ? {
          x: report.mPos.x - wco.x,
          y: report.mPos.y - wco.y,
          z: report.mPos.z - wco.z,
        }
      : undefined);
  return p ? { x: p.x * scale, y: p.y * scale, z: p.z * scale } : undefined;
}
