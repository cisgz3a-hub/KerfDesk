import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ReliefHeightfieldMapping } from '../../core/scene/relief';
import { resolveReliefHeightfieldWidth } from './relief-heightfield-width-resolution';

const ORDINARY_WIDTH_MM = 100;
const ORDINARY_HEIGHT_MM = 50;
const ORDINARY_EDITED_WIDTH_MM = 200;
const ORDINARY_EDITED_HEIGHT_MM = 100;
const BINARY_RADIX = 2;
const FLOAT64_SIGNIFICAND_BITS = 53;
const TIE_DENOMINATOR = BINARY_RADIX ** FLOAT64_SIGNIFICAND_BITS;
const LOWER_TIE_WIDTH_FACTOR = 3;
const LOWER_TIE_HEIGHT_FACTOR = 3_002_399_751_580_331;
const UPPER_TIE_WIDTH_FACTOR = 5;
const UPPER_TIE_HEIGHT_FACTOR = 1_801_439_850_948_199;
const UPPER_TIE_ULPS = 2;
const POSITIVE_FINITE_DOUBLE = fc.double({
  min: Number.MIN_VALUE,
  max: Number.MAX_VALUE,
  noNaN: true,
  noDefaultInfinity: true,
});

type ResolutionCase = {
  readonly label: string;
  readonly input: {
    readonly currentWidthMm: number;
    readonly currentHeightMm: number;
    readonly currentAspect: ReliefHeightfieldMapping['aspect'];
    readonly requestedWidthMm: number;
  };
  readonly expected: {
    readonly physicalHeightMm: number;
    readonly aspect: ReliefHeightfieldMapping['aspect'];
  };
};

const RESOLUTION_CASES: ReadonlyArray<ResolutionCase> = [
  {
    label: 'ordinary Preserve',
    input: {
      currentWidthMm: ORDINARY_WIDTH_MM,
      currentHeightMm: ORDINARY_HEIGHT_MM,
      currentAspect: 'preserve',
      requestedWidthMm: ORDINARY_EDITED_WIDTH_MM,
    },
    expected: { physicalHeightMm: ORDINARY_EDITED_HEIGHT_MM, aspect: 'preserve' },
  },
  {
    label: 'ordinary Stretch',
    input: {
      currentWidthMm: ORDINARY_WIDTH_MM,
      currentHeightMm: ORDINARY_HEIGHT_MM,
      currentAspect: 'stretch',
      requestedWidthMm: ORDINARY_EDITED_WIDTH_MM,
    },
    expected: { physicalHeightMm: ORDINARY_HEIGHT_MM, aspect: 'stretch' },
  },
  {
    label: 'underflow fallback',
    input: {
      currentWidthMm: 1,
      currentHeightMm: Number.MIN_VALUE,
      currentAspect: 'preserve',
      requestedWidthMm: Number.MIN_VALUE,
    },
    expected: { physicalHeightMm: Number.MIN_VALUE, aspect: 'stretch' },
  },
  {
    label: 'overflow fallback',
    input: {
      currentWidthMm: Number.MIN_VALUE,
      currentHeightMm: 1,
      currentAspect: 'preserve',
      requestedWidthMm: 1,
    },
    expected: { physicalHeightMm: 1, aspect: 'stretch' },
  },
  {
    label: 'false underflow',
    input: {
      currentWidthMm: Number.MAX_VALUE,
      currentHeightMm: Number.MIN_VALUE,
      currentAspect: 'preserve',
      requestedWidthMm: Number.MAX_VALUE,
    },
    expected: { physicalHeightMm: Number.MIN_VALUE, aspect: 'preserve' },
  },
  {
    label: 'false overflow',
    input: {
      currentWidthMm: Number.MIN_VALUE,
      currentHeightMm: Number.MAX_VALUE,
      currentAspect: 'preserve',
      requestedWidthMm: Number.MIN_VALUE,
    },
    expected: { physicalHeightMm: Number.MAX_VALUE, aspect: 'preserve' },
  },
  {
    label: 'lower nearest-even tie',
    input: {
      currentWidthMm: TIE_DENOMINATOR,
      currentHeightMm: LOWER_TIE_HEIGHT_FACTOR,
      currentAspect: 'preserve',
      requestedWidthMm: LOWER_TIE_WIDTH_FACTOR,
    },
    expected: { physicalHeightMm: 1, aspect: 'preserve' },
  },
  {
    label: 'upper nearest-even tie',
    input: {
      currentWidthMm: TIE_DENOMINATOR,
      currentHeightMm: UPPER_TIE_HEIGHT_FACTOR,
      currentAspect: 'preserve',
      requestedWidthMm: UPPER_TIE_WIDTH_FACTOR,
    },
    expected: {
      physicalHeightMm: 1 + Number.EPSILON * UPPER_TIE_ULPS,
      aspect: 'preserve',
    },
  },
];

describe('canonical heightfield Width resolution', () => {
  it.each(RESOLUTION_CASES)(
    'resolves $label with correctly rounded binary64 geometry',
    (testCase) => {
      expect(resolveReliefHeightfieldWidth(testCase.input)).toEqual({
        physicalWidthMm: testCase.input.requestedWidthMm,
        ...testCase.expected,
      });
    },
  );

  it('preserves every positive finite canonical height when Width is unchanged', () => {
    fc.assert(
      fc.property(POSITIVE_FINITE_DOUBLE, POSITIVE_FINITE_DOUBLE, (width, height) => {
        expect(
          resolveReliefHeightfieldWidth({
            currentWidthMm: width,
            currentHeightMm: height,
            currentAspect: 'preserve',
            requestedWidthMm: width,
          }),
        ).toEqual({ physicalWidthMm: width, physicalHeightMm: height, aspect: 'preserve' });
      }),
    );
  });

  it('retains every positive finite canonical height under Stretch', () => {
    fc.assert(
      fc.property(
        POSITIVE_FINITE_DOUBLE,
        POSITIVE_FINITE_DOUBLE,
        POSITIVE_FINITE_DOUBLE,
        (width, height, editedWidth) => {
          expect(
            resolveReliefHeightfieldWidth({
              currentWidthMm: width,
              currentHeightMm: height,
              currentAspect: 'stretch',
              requestedWidthMm: editedWidth,
            }),
          ).toEqual({ physicalWidthMm: editedWidth, physicalHeightMm: height, aspect: 'stretch' });
        },
      ),
    );
  });
});
