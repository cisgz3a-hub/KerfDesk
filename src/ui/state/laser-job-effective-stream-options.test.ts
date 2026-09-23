import { describe, expect, it } from 'vitest';
import {
  effectiveStartStreamOptions,
  resolveStartStreamWindow,
} from './laser-job-effective-stream-options';

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
  const noBuildInfo = {
    ...current,
    controllerBuildInfo: null,
    controllerBuildInfoObservation: null,
  };
  // Bf values a maintainer's Falcon A1 Pro reported on 2026-07-19 (ADR-331).
  const falconEvidence = {
    rxBytesFree: 65535,
    plannerBlocksFree: 512,
    sessionEpoch: 7,
    observedAt: 2,
  };

  it('narrows the requested receive window to current-session controller evidence', () => {
    // A 30-byte ring proven by $I keeps the 8-byte safety margin below it.
    expect(
      effectiveStartStreamOptions(
        { streamingMode: 'char-counted', rxBufferBytes: 96 },
        current,
        'grbl-v1.1',
      ),
    ).toMatchObject({ streamingMode: 'char-counted', rxBufferBytes: 22 });
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
        noBuildInfo,
        'grbl-v1.1',
      ).rxBufferBytes,
    ).toBe(120);
  });

  it('uses the active controller streaming protocol at the final boundary', () => {
    expect(
      effectiveStartStreamOptions(
        { streamingMode: 'char-counted', rxBufferBytes: 96 },
        noBuildInfo,
        'marlin',
      ),
    ).toMatchObject({ streamingMode: 'ping-pong', rxBufferBytes: 96 });
  });

  it('lets a grblHAL profile stream its 1024-byte request once a Bf report proves the ring', () => {
    const window = resolveStartStreamWindow(
      { streamingMode: 'char-counted', rxBufferBytes: 1024 },
      { ...noBuildInfo, rxCapacityEvidence: falconEvidence },
      'grblhal',
    );
    expect(window).toEqual({
      streamingMode: 'char-counted',
      bytes: 1024,
      requestedBytes: 1024,
      source: 'controller-reported',
      provenBytes: 4096,
    });
  });

  it('narrows a grblHAL request to a smaller reported ring, margin included', () => {
    const window = resolveStartStreamWindow(
      { streamingMode: 'char-counted', rxBufferBytes: 1024 },
      {
        ...noBuildInfo,
        rxCapacityEvidence: { ...falconEvidence, rxBytesFree: 255, plannerBlocksFree: 35 },
      },
      'grblhal',
    );
    expect(window).toMatchObject({ bytes: 247, source: 'controller-reported', provenBytes: 247 });
  });

  it('falls back to the stock window on grblHAL when the controller never reported its ring', () => {
    const window = resolveStartStreamWindow(
      { streamingMode: 'char-counted', rxBufferBytes: 1024 },
      noBuildInfo,
      'grblhal',
    );
    expect(window).toMatchObject({ bytes: 120, source: 'stock-fallback', provenBytes: null });
    const stale = resolveStartStreamWindow(
      { streamingMode: 'char-counted', rxBufferBytes: 1024 },
      { ...noBuildInfo, rxCapacityEvidence: { ...falconEvidence, sessionEpoch: 6 } },
      'grblhal',
    );
    expect(stale).toMatchObject({ bytes: 120, source: 'stock-fallback' });
  });

  it('bounds a stock GRBL controller by its Bf report exactly like the historical default', () => {
    const window = resolveStartStreamWindow(
      { streamingMode: 'char-counted', rxBufferBytes: 1024 },
      {
        ...noBuildInfo,
        rxCapacityEvidence: { ...falconEvidence, rxBytesFree: 128, plannerBlocksFree: 15 },
      },
      'grbl-v1.1',
    );
    expect(window).toMatchObject({ bytes: 120, source: 'controller-reported', provenBytes: 120 });
  });

  it('takes the smaller of build-info and reported evidence', () => {
    const window = resolveStartStreamWindow(
      { streamingMode: 'char-counted', rxBufferBytes: 1024 },
      { ...current, rxCapacityEvidence: falconEvidence },
      'grbl-v1.1',
    );
    expect(window).toMatchObject({ bytes: 22, source: 'build-info', provenBytes: 22 });
  });

  it('keeps the profile request for firmwares that offer no ring evidence', () => {
    expect(
      resolveStartStreamWindow(
        { streamingMode: 'char-counted', rxBufferBytes: 512 },
        noBuildInfo,
        'fluidnc',
      ),
    ).toMatchObject({ bytes: 512, source: 'profile', provenBytes: null });
  });
});
