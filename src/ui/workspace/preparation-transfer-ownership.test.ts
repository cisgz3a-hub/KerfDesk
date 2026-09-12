import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { largeJobPreparationFromPrepared, type LargeJobPreparation } from './large-job-preparation';
import { PreparationTransferAssembler } from './preparation-transfer-assembler';
import { PREPARATION_TRANSFER_STEP_CHUNK } from './preparation-transfer-protocol';
import { PreparationTransferSender } from './preparation-transfer-sender';

describe('worker-owned preparation transfer', () => {
  it('releases a fresh raster route without modifying or invalidating its prepared output', async () => {
    const width = 128;
    const height = 32;
    const project = {
      ...createProject(),
      scene: {
        objects: [
          {
            kind: 'raster-image' as const,
            id: 'raster',
            source: 'alternating-pixels.png',
            dataUrl: 'data:image/png;base64,unused',
            color: '#808080',
            pixelWidth: width,
            pixelHeight: height,
            lumaBase64: btoa(
              Array.from({ length: width * height }, (_, index) =>
                String.fromCharCode(index % 2 === 0 ? 0 : 255),
              ).join(''),
            ),
            linesPerMm: 2,
            dither: 'floyd-steinberg' as const,
            bounds: { minX: 0, minY: 0, maxX: width / 2, maxY: height / 2 },
            transform: IDENTITY_TRANSFORM,
            operationIds: ['image'],
          },
        ],
        layers: [
          { ...createLayer({ id: 'image', color: '#808080', mode: 'image' }), linesPerMm: 2 },
        ],
      },
    };
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    const sourceBefore = structuredClone(project);
    const preparedBefore = structuredClone(prepared);
    const owned = largeJobPreparationFromPrepared(project, prepared, {});
    expect(owned.toolpath.steps.length).toBeGreaterThan(PREPARATION_TRANSFER_STEP_CHUNK);
    const before = structuredClone(owned);
    let receiver: PreparationTransferAssembler | undefined;
    let delivered: LargeJobPreparation | null = null;
    const sender = new PreparationTransferSender((response) => {
      const packet = structuredClone(response);
      if (packet.kind === 'transfer-start') receiver = new PreparationTransferAssembler(packet);
      else if (packet.kind === 'transfer-chunk' || packet.kind === 'transfer-complete') {
        if (receiver === undefined) throw new Error('missing transfer header');
        delivered = receiver.accept(packet);
      } else throw new Error('unexpected unchunked response');
      queueMicrotask(() =>
        sender.acceptAcknowledgement({
          kind: 'transfer-ack',
          id: packet.id,
          sequence: packet.sequence,
        }),
      );
    });

    await sender.sendOwned(3, owned);

    expect(delivered).toEqual(before);
    expect(owned.toolpath.steps.every((step) => step === undefined)).toBe(true);
    expect(project).toEqual(sourceBefore);
    expect(structuredClone(prepared)).toEqual(preparedBefore);
    expect(largeJobPreparationFromPrepared(project, prepared, {})).toEqual(before);
  });
});
