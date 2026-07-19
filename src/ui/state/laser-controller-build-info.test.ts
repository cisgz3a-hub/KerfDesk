import { describe, expect, it } from 'vitest';
import {
  emptyControllerBuildInfoState,
  observedControllerBuildInfoState,
} from './laser-controller-build-info';

describe('controller build-info evidence', () => {
  it('stores strict parsed stock-GRBL evidence with its session observation', () => {
    const evidence = observedControllerBuildInfoState(
      ['[VER:1.1h.20190830:4040]', '[OPT:VM,15,128]'],
      7,
      100,
    );
    expect(evidence.controllerBuildInfo).toMatchObject({
      userInfo: '4040',
      optionCodes: ['V', 'M'],
      rxBufferBytes: 128,
    });
    expect(evidence.controllerBuildInfoObservation).toEqual({ sessionEpoch: 7, observedAt: 100 });
  });

  it('retains bounded raw diagnostics when a completed response is malformed', () => {
    const evidence = observedControllerBuildInfoState(
      Array.from({ length: 12 }, (_, index) => `${index}:${'x'.repeat(700)}`),
      9,
      200,
    );
    expect(evidence.controllerBuildInfo).toBeNull();
    expect(evidence.controllerBuildInfoRawLines).toHaveLength(8);
    expect(evidence.controllerBuildInfoRawLines.every((line) => line.length <= 512)).toBe(true);
    expect(evidence.controllerBuildInfoObservation).toEqual({ sessionEpoch: 9, observedAt: 200 });
  });

  it('clears parsed, raw, and observation evidence together', () => {
    expect(emptyControllerBuildInfoState()).toEqual({
      controllerBuildInfo: null,
      controllerBuildInfoRawLines: [],
      controllerBuildInfoObservation: null,
    });
  });
});
