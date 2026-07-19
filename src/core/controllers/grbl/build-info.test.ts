import { describe, expect, it } from 'vitest';
import { parseBuildInfoResponses, validateProbeBuildCompatibility } from './build-info';

describe('parseBuildInfoResponses', () => {
  it('parses the exact owned stock-GRBL build-info response', () => {
    const result = parseBuildInfoResponses([
      '[VER:1.1h.20190830:ACME:Router:v2]',
      '[OPT:VZTE,15,128]',
    ]);

    expect(result).toEqual({
      ok: true,
      value: {
        protocolVersion: '1.1h',
        buildRevision: '20190830',
        userInfo: 'ACME:Router:v2',
        optionCodes: ['V', 'Z', 'T', 'E'],
        plannerBufferBlocks: 15,
        rxBufferBytes: 128,
      },
    });
  });

  it('retains the stock M option used as compiled mist-coolant proof', () => {
    const result = parseBuildInfoResponses(['[VER:1.1h.20190830:]', '[OPT:VM,15,128]']);
    expect(result).toMatchObject({ ok: true, value: { optionCodes: ['V', 'M'] } });
  });

  it.each([
    ['missing VER', ['[OPT:V,15,128]']],
    ['missing OPT', ['[VER:1.1h.20190830:]']],
    ['duplicate option', ['[VER:1.1h.20190830:]', '[OPT:VV,15,128]']],
    ['reordered options', ['[VER:1.1h.20190830:]', '[OPT:ZV,15,128]']],
    ['unknown option', ['[VER:1.1h.20190830:]', '[OPT:VQ,15,128]']],
    ['zero buffer', ['[VER:1.1h.20190830:]', '[OPT:V,0,128]']],
    ['non-integer buffer', ['[VER:1.1h.20190830:]', '[OPT:V,15.5,128]']],
    ['extra response', ['[VER:1.1h.20190830:]', '[OPT:V,15,128]', '[MSG:extra]']],
  ])('rejects %s', (_label, lines) => {
    expect(parseBuildInfoResponses(lines)).toMatchObject({ ok: false });
  });
});

describe('validateProbeBuildCompatibility', () => {
  it('accepts the one audited stock GRBL build without unsafe options', () => {
    const parsed = parseBuildInfoResponses(['[VER:1.1h.20190830:]', '[OPT:VZ,15,128]']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(validateProbeBuildCompatibility(parsed.value)).toEqual({ ok: true });
  });

  it.each(['A', 'C', 'E', 'W', 'L', '2'])('rejects unsupported option %s', (option) => {
    const parsed = parseBuildInfoResponses(['[VER:1.1h.20190830:]', `[OPT:${option},15,128]`]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(validateProbeBuildCompatibility(parsed.value)).toMatchObject({ ok: false });
  });

  it('rejects a syntactically valid but unaudited GRBL build', () => {
    const parsed = parseBuildInfoResponses(['[VER:1.1h.20190825:]', '[OPT:V,15,128]']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(validateProbeBuildCompatibility(parsed.value)).toMatchObject({ ok: false });
  });

  it('rejects the officially incompatible parking plus forced-origin build', () => {
    const parsed = parseBuildInfoResponses(['[VER:1.1h.20190830:]', '[OPT:VPZ,15,128]']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(validateProbeBuildCompatibility(parsed.value)).toMatchObject({ ok: false });
  });

  it.each(['[OPT:,15,128]', '[OPT:+*$#I,15,128]'])('parses official option form %s', (line) => {
    expect(parseBuildInfoResponses(['[VER:1.1h.20190830:]', line])).toMatchObject({
      ok: true,
    });
  });
});
