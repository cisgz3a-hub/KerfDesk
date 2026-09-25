import type { CncTool } from '../../core/scene';

export type CncBitPictureTool = Pick<CncTool, 'kind' | 'family' | 'tipDiameterMm'>;

export type CncBitPictureKey =
  | 'bit-straight'
  | 'bit-upcut'
  | 'bit-downcut'
  | 'bit-compression'
  | 'bit-o-flute-upcut'
  | 'bit-o-flute-downcut'
  | 'bit-o-flute-straight'
  | 'bit-o-flute-double'
  | 'bit-mortise'
  | 'bit-ball-nose'
  | 'bit-core-box'
  | 'bit-o-flute-ball-nose'
  | 'bit-v-groove'
  | 'bit-engraving-point'
  | 'bit-engraving-flat'
  | 'bit-tapered-ball-nose';

export type CncBitPicture = {
  readonly key: CncBitPictureKey;
  readonly label: string;
  readonly description: string;
  readonly geometryOnly?: boolean;
};

// Recognition help only. Family metadata never changes the selected tool's geometry or feeds.
const FLAT_FAMILIES = new Map<string, CncBitPicture>([
  [
    'straight',
    {
      key: 'bit-straight',
      label: 'Straight bit',
      description: 'Straight cutting edges and a flat end make a square-bottom groove.',
    },
  ],
  [
    'upcut',
    {
      key: 'bit-upcut',
      label: 'Upcut spiral',
      description: 'Spiral flutes lift chips toward the shank. The cutting end is flat.',
    },
  ],
  [
    'downcut',
    {
      key: 'bit-downcut',
      label: 'Downcut spiral',
      description: 'The opposite spiral directs chips toward the tip. The cutting end is flat.',
    },
  ],
  [
    'compression',
    {
      key: 'bit-compression',
      label: 'Compression bit',
      description:
        'An upcut section at the tip meets a downcut section above it. Both cutting zones must engage as intended for the material thickness.',
    },
  ],
  [
    'o-flute-upcut',
    {
      key: 'bit-o-flute-upcut',
      label: 'Single O-flute upcut',
      description:
        'One broad, rounded flute spirals upward to carry chips toward the shank; the end is flat.',
    },
  ],
  [
    'o-flute-downcut',
    {
      key: 'bit-o-flute-downcut',
      label: 'Single O-flute downcut',
      description:
        'One broad, rounded flute spirals in the opposite direction to carry chips toward the tip; the end is flat.',
    },
  ],
  [
    'o-flute-straight',
    {
      key: 'bit-o-flute-straight',
      label: 'Single O-flute straight bit',
      description:
        'One broad, rounded flute runs straight along the cutter without a spiral. The end is flat.',
    },
  ],
  [
    'o-flute-double',
    {
      key: 'bit-o-flute-double',
      label: 'Double O-flute bit',
      description:
        'Two broad, rounded flutes cut around a flat-ended body. This straight-flute example illustrates the family; actual flute direction varies by product.',
    },
  ],
  [
    'mortise',
    {
      key: 'bit-mortise',
      label: 'Mortise bit',
      description:
        'A short, broad cutting head makes a flat-bottom recess. This example has short downshear edges and no bearing.',
    },
  ],
]);

const BALL_FAMILIES = new Map<string, CncBitPicture>([
  [
    'ball-nose',
    {
      key: 'bit-ball-nose',
      label: 'Ball-nose end mill',
      description:
        'An untapered cutter ends in a full rounded nose, useful for curved surfaces and rounded grooves.',
    },
  ],
  [
    'core-box',
    {
      key: 'bit-core-box',
      label: 'Core-box / round-nose bit',
      description:
        'A full-radius round nose makes a rounded groove. The illustration has no bearing; the app models the rounded cutting shape.',
    },
  ],
  [
    'o-flute-ball-nose',
    {
      key: 'bit-o-flute-ball-nose',
      label: 'O-flute ball nose',
      description:
        'A broad O-flute upcut spiral meets a full rounded nose. Check the actual flute count on your cutter.',
    },
  ],
]);

export function cncBitPicture(tool: CncBitPictureTool): CncBitPicture {
  // Kind remains authoritative even if a custom family name conflicts with it.
  if (tool.kind === 'end-mill') {
    return (
      FLAT_FAMILIES.get(tool.family ?? '') ?? {
        key: 'bit-straight',
        label: 'Flat-end geometry',
        geometryOnly: true,
        description:
          'An end mill has a flat cutting end. This generic straight-bit example does not identify the flute design of your custom cutter.',
      }
    );
  }
  if (tool.kind === 'ball-nose') {
    return (
      BALL_FAMILIES.get(tool.family ?? '') ?? {
        key: 'bit-ball-nose',
        label: 'Ball-nose geometry',
        geometryOnly: true,
        description:
          'The cutting end is a full rounded nose. This generic example does not identify the flute design of your custom cutter.',
      }
    );
  }
  if (tool.kind === 'tapered-ball-nose') {
    return {
      key: 'bit-tapered-ball-nose',
      label: 'Tapered ball-nose carving bit',
      description:
        'A small rounded tip blends into a long, slender taper for fine 3D relief detail. Enter its ball tip diameter, per-side taper and diameter at the top of the flutes.',
    };
  }
  if (tool.kind === 'v-bit') {
    return {
      key: 'bit-v-groove',
      label: 'Pointed V-bit',
      description:
        'A conical cutting profile ends in a point. A deeper cut becomes wider; use the actual included angle entered for your bit.',
    };
  }
  return Number.isFinite(tool.tipDiameterMm) && (tool.tipDiameterMm ?? 0) > 0
    ? {
        key: 'bit-engraving-flat',
        label: 'Flat-tip engraving cutter',
        description:
          'A tapered cutting profile ends in a small flat land. Enter its measured tip-flat diameter and included angle.',
      }
    : {
        key: 'bit-engraving-point',
        label: 'Pointed engraving cutter',
        description:
          'A tapered cutting profile ends in a point. A blank or zero tip-flat diameter describes the pointed version.',
      };
}
