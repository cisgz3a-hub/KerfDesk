import { railProfileSampler } from './relief-rail-profile';
import type {
  ReliefAuthoringAlgorithm,
  ReliefComponentSource,
} from '../scene/relief/relief-authoring';
import type { ReliefHeightfield } from '../scene/relief/relief-heightfield';
import type { Vec2 } from '../scene/scene-object';
import { canonicalBase64ByteLength, decodeCanonicalBase64 } from './depth-map-base64';
import { heightfieldMetadataError } from './heightfield-metadata-validator';
import { reliefHeightfieldDigest } from './heightfield-digest';
import { reliefBoundaryBounds, reliefBoundaryContains } from './relief-vector-boundary';

export type ComponentSample = { readonly heightMm: number; readonly included: boolean };
export type ReliefComponentSampler = (point: Vec2) => ComponentSample;

export function createComponentSampler(
  source: ReliefComponentSource,
  algorithmRevision: ReliefAuthoringAlgorithm = 'retained-relief-v2',
): ReliefComponentSampler {
  if (source.kind === 'rail-profile-v1')
    return railProfileSampler(source, algorithmRevision === 'retained-relief-v1');
  if (source.kind === 'vector-shape-v1') {
    const bounds = reliefBoundaryBounds(source.boundary);
    const cx = (bounds.minX + bounds.maxX) / 2,
      cy = (bounds.minY + bounds.maxY) / 2;
    const rx = (bounds.maxX - bounds.minX) / 2,
      ry = (bounds.maxY - bounds.minY) / 2;
    const angle = (source.angleDeg * Math.PI) / 180,
      dx = Math.cos(angle),
      dy = Math.sin(angle);
    const projections = source.boundary.rings.flatMap((r) =>
      r.points.map((p) => p.x * dx + p.y * dy),
    );
    const low = Math.min(...projections),
      high = Math.max(...projections);
    return (p) => {
      if (!reliefBoundaryContains(source.boundary, p)) return { heightMm: 0, included: false };
      let height = source.heightMm;
      // A hemisphere/ellipsoid cap in the boundary bounding ellipse, clipped to its rings.
      if (source.profile === 'dome')
        height *= Math.sqrt(Math.max(0, 1 - ((p.x - cx) / rx) ** 2 - ((p.y - cy) / ry) ** 2));
      if (source.profile === 'slope')
        height *=
          high === low ? 0 : Math.max(0, Math.min(1, (p.x * dx + p.y * dy - low) / (high - low)));
      return { heightMm: height, included: true };
    };
  }
  const field = source.field;
  const error = heightfieldMetadataError(field, {
    targetWidthMm: field.physicalWidthMm,
    reliefDepthMm: field.mapping.maxDepthMm,
  });
  if (error !== null) throw new Error(error);
  const samples = exactDecode(field.samplesBase64, field.width * field.height * 2);
  const mask =
    field.inclusionMask === undefined
      ? undefined
      : exactDecode(field.inclusionMask.samplesBase64, field.width * field.height);
  const digest = reliefHeightfieldDigest({
    width: field.width,
    height: field.height,
    samples,
    ...(mask === undefined
      ? {}
      : { inclusionMask: { encoding: 'u8-base64-v1' as const, samples: mask } }),
  });
  if (digest !== field.digest)
    throw new Error('Retained relief source digest does not match its payload.');
  return (p) => sampleField(field, samples, mask, p);
}

function exactDecode(value: string, length: number): Uint8Array {
  if (canonicalBase64ByteLength(value) !== length)
    throw new Error('Retained relief source payload length is invalid.');
  const result = decodeCanonicalBase64(value);
  if (result.kind === 'error') throw new Error('Retained relief source could not be decoded.');
  return result.bytes;
}
function sampleField(
  field: ReliefHeightfield,
  samples: Uint8Array,
  mask: Uint8Array | undefined,
  p: Vec2,
): ComponentSample {
  if (p.x < 0 || p.y < 0 || p.x > field.physicalWidthMm || p.y > field.physicalHeightMm)
    return { included: false, heightMm: 0 };
  const crop = field.mapping.crop;
  const x = Math.min(
    field.width - 1,
    Math.floor((crop.x + (p.x / field.physicalWidthMm) * crop.width) * field.width),
  );
  const y = Math.min(
    field.height - 1,
    Math.floor((crop.y + (p.y / field.physicalHeightMm) * crop.height) * field.height),
  );
  const i = y * field.width + x;
  if ((mask?.[i] ?? 255) < field.mapping.inclusionThreshold) {
    return {
      included: field.mapping.outsideMask !== 'excluded',
      heightMm: field.mapping.outsideMask === 'stock-top' ? field.mapping.maxDepthMm : 0,
    };
  }
  const code = (samples[i * 2] ?? 0) | ((samples[i * 2 + 1] ?? 0) << 8);
  return { included: true, heightMm: mappedHeight(field, code) };
}
function mappedHeight(field: ReliefHeightfield, code: number): number {
  const low = field.mapping.inputLowCode,
    high = field.mapping.inputHighCode;
  const unit =
    (low === high ? 0.5 : Math.max(0, Math.min(1, (code - low) / (high - low)))) **
    field.mapping.curve.gamma;
  return field.mapping.maxDepthMm * (field.mapping.polarity === 'light-is-high' ? unit : 1 - unit);
}
