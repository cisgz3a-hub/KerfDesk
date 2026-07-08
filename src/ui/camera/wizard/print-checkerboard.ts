// In-app printing for the calibration checkerboard (F-CAM2). Renders the
// true-scale SVG into a hidden iframe and triggers the browser/Electron print
// dialog directly, so the operator never has to save a file and hunt for it.
// `@page { margin: 0 }` keeps the millimetre sizing exact on paper.

export type PrintResult = 'printed' | 'unavailable';

export function printCheckerboard(
  svg: string,
  // Injectable for tests; production prints into a real hidden iframe.
  host: Document = document,
): PrintResult {
  const iframe = host.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  host.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDoc = frameWindow?.document;
  if (frameWindow === null || frameDoc === undefined || typeof frameWindow.print !== 'function') {
    iframe.remove();
    return 'unavailable';
  }

  frameDoc.open();
  frameDoc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0;padding:0}</style></head><body>${svg}</body></html>`,
  );
  frameDoc.close();

  const cleanup = (): void => {
    // Keep the frame alive until the print dialog is dismissed, then remove it.
    setTimeout(() => iframe.remove(), 1000);
  };
  frameWindow.onafterprint = cleanup;
  frameWindow.focus();
  frameWindow.print();
  cleanup();
  return 'printed';
}
