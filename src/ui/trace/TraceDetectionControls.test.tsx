// Automatic detection shows the band it uses and which route it took, and the
// first manual band starts where the automatic threshold was (ADR-559).

import { describe, expect, it } from 'vitest';
import { prepareTraceForContour, preprocessForTrace } from '../../core/trace/trace-image';
import { fill, ink, paper } from './trace-controls-test-helpers';
import { withControls } from './trace-settings-controls.test-support';

describe('automatic detection tells the operator what it used', () => {
  it('shows the band Line Art uses when the image has no colour detail', async () => {
    const image = paper();
    fill(image, 10, 10, 20, 20, [0, 0, 0]);
    fill(image, 40, 10, 30, 10, [172, 172, 172]);
    await withControls('Line Art', async (controls) => {
      const automatic = ink(preprocessForTrace(image, controls.options()));
      expect(controls.host.textContent).toContain('Automatic (band + pale colour detail)');
      await controls.setPreviewFacts({
        report: prepareTraceForContour(image, controls.options()).report,
      });
      expect(controls.host.textContent).toContain('Band in use: Cutoff 0, Threshold 128.');
      expect(controls.host.textContent).toContain(
        'No colour detail found: using brightness band 0–128 only.',
      );
      await controls.detect('manual');
      expect(controls.number('Threshold').value).toBe('128');
      expect(ink(preprocessForTrace(image, controls.options()))).toBe(automatic);
    });
  });

  it('says when Line Art added pale colour detail to its band', async () => {
    const image = paper();
    fill(image, 20, 20, 30, 10, [220, 180, 80]);
    await withControls('Line Art', async (controls) => {
      const report = prepareTraceForContour(image, controls.options()).report;
      expect(report).toEqual({ localDetailAdded: true });
      await controls.setPreviewFacts({ report });
      expect(controls.host.textContent).toContain(
        'Colour detail found: pale marks darker than their surroundings are added to the band.',
      );
    });
  });

  it.each(['Smooth', 'Sharp', 'Centerline', 'Line + fill'])(
    '%s starts the manual band where its automatic threshold was',
    async (name) => {
      const image = paper(240);
      fill(image, 20, 15, 30, 30, [150, 150, 150]);
      await withControls(name, async (controls) => {
        const report = prepareTraceForContour(image, controls.options()).report;
        const automatic = report?.automaticThresholdLuma;
        if (automatic === undefined) throw new Error('No automatic threshold reported');
        expect(automatic).not.toBe(129);
        await controls.setPreviewFacts({ report });
        expect(controls.host.textContent).toContain(
          `Band in use: Cutoff 0, Threshold ${automatic - 1}, set from this image.`,
        );
        expect(ink(preprocessForTrace(image, controls.options()))).toBe(900);
        await controls.detect('manual');
        expect(controls.number('Threshold').value).toBe(String(automatic - 1));
        expect(ink(preprocessForTrace(image, controls.options()))).toBe(900);
      });
    },
  );

  it('starts at the preset band until a preview has reported', async () => {
    await withControls('Sharp', async (controls) => {
      expect(controls.host.textContent).toContain(
        'Band in use: set from this image when the preview finishes.',
      );
      await controls.detect('manual');
      expect(controls.number('Threshold').value).toBe('128');
    });
  });

  it('names no band when uneven lighting was evened out first', async () => {
    await withControls('Smooth', async (controls) => {
      await controls.setPreviewFacts({ report: { lightingLevelled: true } });
      expect(controls.host.textContent).toContain(
        'Band in use: none. Uneven lighting was evened out before the cut',
      );
      await controls.detect('manual');
      expect(controls.number('Threshold').value).toBe('128');
    });
  });

  it('keeps a band the operator already set', async () => {
    await withControls('Sharp', async (controls) => {
      await controls.detect('manual');
      await controls.change('Threshold', 190);
      await controls.detect('preset');
      await controls.setPreviewFacts({ report: { automaticThresholdLuma: 97 } });
      await controls.detect('manual');
      expect(controls.number('Threshold').value).toBe('190');
    });
  });
});
