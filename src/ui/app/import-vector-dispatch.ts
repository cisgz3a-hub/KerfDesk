// The editable line-art formats of the unified Import: SVG, DXF, HPGL and
// PostScript (EPS and Illustrator 3–8, ADR-700). PDF-based `.ai` files arrive
// as kind 'pdf' and stay with the PDF importer unless they are PostScript.

import type { ImportDispatchActions } from './import-dispatch';
import { importDxfFiles } from './dxf-import-action';
import { importHpglFile } from './hpgl-import-action';
import { importPostscriptFile, isPostscriptIllustratorFile } from './postscript-import-action';
import { importSvgFiles } from './svg-import-action';

/** Imports `file` when it is one of these formats; false leaves it to the caller. */
export async function dispatchVectorFile(
  file: File,
  kind: string,
  actions: ImportDispatchActions,
  nextSuccessIndex: () => number,
): Promise<boolean> {
  const fragment =
    actions.importSvgFragment === undefined ? {} : { importFragment: actions.importSvgFragment };
  const lineArt = {
    importObject: actions.importSvgObject,
    pushToast: actions.pushToast,
    nextSuccessIndex,
  };
  if (kind === 'postscript' || (kind === 'pdf' && (await isPostscriptIllustratorFile(file)))) {
    await importPostscriptFile(file, { ...lineArt, ...fragment });
    return true;
  }
  if (kind === 'svg') {
    await importSvgFiles([file], actions.importSvgObject, actions.pushToast, {
      nextSuccessIndex,
      ...fragment,
    });
    return true;
  }
  if (kind === 'dxf') {
    await importDxfFiles([file], lineArt);
    return true;
  }
  if (kind === 'hpgl') {
    await importHpglFile(file, lineArt);
    return true;
  }
  return false;
}
