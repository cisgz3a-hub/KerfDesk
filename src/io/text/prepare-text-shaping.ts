import { needsTextShaping } from '../../core/text/text-shaping-required';
import { textForLayout } from '../../core/text/glyph-coverage';
import type { TextShaping } from '../../core/text/text-shaping-types';
import type * as HarfBuzz from 'harfbuzzjs';
import type * as TextShaper from '../../core/text/text-shaping';

type Runtime = typeof HarfBuzz;
type Shaper = typeof TextShaper;
let loading: Promise<readonly [Runtime, Shaper]> | undefined;

/** Runtime/WASM loading belongs to I/O; core receives only a ready shaper. */
export async function prepareTextShaping(
  fontBuffer: ArrayBuffer,
  content: string,
): Promise<TextShaping | undefined> {
  const text = textForLayout(content);
  if (!needsTextShaping(text)) return undefined;
  loading ??= Promise.all([import('harfbuzzjs'), import('../../core/text/text-shaping')]).catch(
    (error: unknown) => {
      loading = undefined;
      // A failed WASM top-level await can remain cached in the browser module
      // registry. Clearing our promise alone cannot retry that evaluation.
      throw new Error('The multilingual text engine could not start. Reload KerfDesk to retry.', {
        cause: error,
      });
    },
  );
  const [hb, shaper] = await loading;
  return shaper.createTextShaping(hb, fontBuffer, text);
}
