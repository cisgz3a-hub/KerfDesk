import { describe, expect, it } from 'vitest';
import { effectiveStartStreamOptions } from './laser-job-effective-stream-options';

describe('effectiveStartStreamOptions', () => {
  const current = {
    controllerSessionEpoch: 7,
    controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 1 },
    controllerBuildInfo: {
      protocolVersion: '1.1h',
      buildRevision: '20190830',
      userInfo: 'test',
      optionCodes: [] as const,
      plannerBufferBlocks: 15,
      rxBufferBytes: 30,
    },
  };

  it('narrows the requested receive window to current-session controller evidence', () => {
    expect(
      effectiveStartStreamOptions(
        { streamingMode: 'char-counted', rxBufferBytes: 96 },
        current,
        'grbl-v1.1',
      ),
    ).toMatchObject({ streamingMode: 'char-counted', rxBufferBytes: 30 });
  });

  it('never raises the requested receive window and treats stale evidence as absent', () => {
    expect(
      effectiveStartStreamOptions(
        { streamingMode: 'char-counted', rxBufferBytes: 20 },
        current,
        'grbl-v1.1',
      ).rxBufferBytes,
    ).toBe(20);
    expect(
      effectiveStartStreamOptions(
        { streamingMode: 'char-counted', rxBufferBytes: 512 },
        {
          ...current,
          controllerBuildInfoObservation: { sessionEpoch: 6, observedAt: 1 },
        },
        'grbl-v1.1',
      ).rxBufferBytes,
    ).toBe(120);
  });

  it('uses the conservative stock-GRBL window when live buffer evidence is absent', () => {
    expect(
      effectiveStartStreamOptions(
        { streamingMode: 'char-counted', rxBufferBytes: 4096 },
        { ...current, controllerBuildInfo: null, controllerBuildInfoObservation: null },
        'grbl-v1.1',
      ).rxBufferBytes,
    ).toBe(120);
  });

  it('uses the active controller streaming protocol at the final boundary', () => {
    expect(
      effectiveStartStreamOptions(
        { streamingMode: 'char-counted', rxBufferBytes: 96 },
        { ...current, controllerBuildInfo: null, controllerBuildInfoObservation: null },
        'marlin',
      ),
    ).toMatchObject({ streamingMode: 'ping-pong', rxBufferBytes: 96 });
  });
});
