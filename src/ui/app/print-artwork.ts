// File > Print artwork... (LightBurn Print / Print Black / print line width):
// the selected artwork, or all of it, printed at true size through the
// system print dialog, in its own colours or all black, with every line at a
// chosen width. Text is outlined and variable fields are evaluated, as for
// SVG export. Nothing about the job or the project changes.

import { DEFAULT_PROJECT_VARIABLE_DATA, type Project } from '../../core/scene';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import { renderVariableText } from '../text/render-variable-text';
import { exportProjectSelection } from './export-artwork-svg';

export type PrintOptions = {
  readonly blackOnly: boolean;
  /** Printed line width in millimetres. */
  readonly lineWidthMm: number;
};

/** The exported SVG with the print styling: line width, and black when asked. */
export function styledPrintSvg(svg: string, options: PrintOptions): string {
  const width = Math.max(0.01, options.lineWidthMm);
  const rules = [`*{stroke-width:${width}px !important;vector-effect:none}`];
  if (options.blackOnly) {
    // Printed ink, not app chrome: black is the colour a black-only print means.
    /* eslint-disable no-restricted-syntax */
    rules.push(
      '[stroke]:not([stroke="none"]){stroke:#000 !important}',
      '[fill]:not([fill="none"]){fill:#000 !important}',
      'image{filter:grayscale(1)}',
    );
    /* eslint-enable no-restricted-syntax */
  }
  return svg.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${rules.join('')}</style>`);
}

export async function printableArtworkSvg(
  project: Project,
  selectedIds: readonly string[],
  options: PrintOptions,
  now: Date,
): Promise<
  { readonly ok: true; readonly svg: string } | { readonly ok: false; readonly message: string }
> {
  const ids = selectedIds.length > 0 ? [...selectedIds] : undefined;
  const scoped = exportProjectSelection(project, ids);
  if (scoped.scene.objects.length === 0)
    return { ok: false, message: 'There is no artwork to print.' };
  const variables = scoped.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const resolved = await materializeVariableText(
    scoped,
    { now, recordIndex: variables.recordIndex, serialValue: variables.serialValue },
    renderVariableText,
  );
  if (!resolved.ok) {
    return {
      ok: false,
      message: resolved.preflight.issues.map((issue) => issue.message).join(' '),
    };
  }
  const objects = resolved.project.scene.objects.filter(
    (object) => object.kind !== 'raster-image' || object.dataUrl !== undefined,
  );
  const exported = exportSceneSvg(
    { ...resolved.project, scene: { ...resolved.project.scene, objects } },
    ids,
  );
  if (exported.kind === 'error') return { ok: false, message: exported.error };
  return { ok: true, svg: styledPrintSvg(exported.value.svg, options) };
}

/** Print an SVG at its own millimetre size from a hidden frame. */
export function printSvg(svg: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = `<!doctype html><html><head><style>@page{margin:10mm}html,body{margin:0}svg{display:block}</style></head><body>${svg}</body></html>`;
  frame.onload = () => {
    const view = frame.contentWindow;
    if (view === null) return;
    view.addEventListener('afterprint', () => frame.remove(), { once: true });
    view.focus();
    view.print();
  };
  document.body.appendChild(frame);
}
