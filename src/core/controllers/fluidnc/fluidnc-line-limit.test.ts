import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  findFluidncNonExecutableLines,
  FLUIDNC_GCODE_MAX_PAYLOAD_BYTES,
  FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS,
  fluidncLineBoundary,
} from './fluidnc-line-limit';
import { FLUIDNC_V403_LINEEDIT_FIXTURES } from '../../../__fixtures__/controllers/fluidnc-v403-lineedit-fixtures';

const RECONSTRUCTED_JOG_PREFIXES = [
  '$J=',
  '[J]',
  '$j=',
  '$Jog=',
  '[Jog]',
  '$ J =',
  '[ J ]',
] as const;
const PROPERTY_VALUE_MAX_LENGTH = 512;
const PROPERTY_RUNS = 200;

function lineOf(length: number): string {
  return 'G1 X'.padEnd(length, '0');
}

describe('fluidncLineBoundary', () => {
  it('matches the independent v4.0.3 ASCII Lineedit fixture baseline', () => {
    expect(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES).toBe(127);
    expect(FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS).toBe(254);
    expect(
      FLUIDNC_V403_LINEEDIT_FIXTURES.map(({ payloadBytes }) =>
        fluidncLineBoundary(1, payloadBytes),
      ),
    ).toEqual(
      FLUIDNC_V403_LINEEDIT_FIXTURES.map(({ payloadBytes, retainedBytes, parserResult }) => ({
        lineNumber: 1,
        length: payloadBytes,
        retainedLength: retainedBytes,
        parserResult,
      })),
    );
  });

  it('reports only ordinary G-code that FluidNC rejects at the parser boundary', () => {
    expect(findFluidncNonExecutableLines('')).toEqual([]);
    expect(findFluidncNonExecutableLines(`${lineOf(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES)}\n`)).toEqual(
      [],
    );
    expect(
      findFluidncNonExecutableLines(`${lineOf(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1)}\n`),
    ).toEqual([
      {
        lineNumber: 1,
        length: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        retainedLength: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        parserResult: 'error:14',
      },
    ]);
  });

  it('keeps CRLF terminators outside the current payload accounting', () => {
    expect(findFluidncNonExecutableLines(`${lineOf(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES)}\r\n`)).toEqual(
      [],
    );
  });

  it('measures the normalized payload that the shared streamer transmits', () => {
    expect(
      findFluidncNonExecutableLines(`  ${lineOf(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1)}  \n`),
    ).toEqual([
      {
        lineNumber: 1,
        length: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        retainedLength: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        parserResult: 'error:14',
      },
    ]);
  });

  it('uses the same sendable-line predicate as streaming while preserving raw source numbers', () => {
    const comment = `;${'comment'.repeat(60)}`;
    expect(findFluidncNonExecutableLines(`${comment}\n${lineOf(128)}\n`)).toEqual([
      { lineNumber: 2, length: 128, retainedLength: 128, parserResult: 'error:14' },
    ]);
  });

  it.each(RECONSTRUCTED_JOG_PREFIXES)('uses the reconstructed $J= length for %s', (prefix) => {
    const acceptedJogValue = lineOf(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES - '$J='.length);
    const rejectedJogValue = lineOf(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES - '$J='.length + 1);

    expect(findFluidncNonExecutableLines(`${prefix}${acceptedJogValue}\n`)).toEqual([]);
    expect(findFluidncNonExecutableLines(`${prefix}${rejectedJogValue}\n`)).toEqual([
      {
        lineNumber: 1,
        length: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        retainedLength: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        parserResult: 'error:14',
      },
    ]);
  });

  it('preserves the reconstructed jog boundary across supported forms and payload lengths', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RECONSTRUCTED_JOG_PREFIXES),
        fc.integer({ min: 1, max: PROPERTY_VALUE_MAX_LENGTH }),
        (prefix, valueLength) => {
          const reconstructedLength = '$J='.length + valueLength;
          const expected =
            reconstructedLength <= FLUIDNC_GCODE_MAX_PAYLOAD_BYTES
              ? []
              : [
                  {
                    lineNumber: 1,
                    length: reconstructedLength,
                    retainedLength: Math.min(
                      reconstructedLength,
                      FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS,
                    ),
                    parserResult: 'error:14' as const,
                  },
                ];

          expect(findFluidncNonExecutableLines(`${prefix}${'X'.repeat(valueLength)}\n`)).toEqual(
            expected,
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('excludes non-jog settings from the G-code parser boundary', () => {
    const longSetting = `$Config/${'x'.repeat(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES)}=1`;
    const longBracketSetting = `[ESP${'x'.repeat(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES)}]1`;
    const ordinaryLine = lineOf(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1);

    expect(
      findFluidncNonExecutableLines([longSetting, longBracketSetting, ordinaryLine].join('\n')),
    ).toEqual([
      {
        lineNumber: 3,
        length: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        retainedLength: FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1,
        parserResult: 'error:14',
      },
    ]);
  });
});
