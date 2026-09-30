import { join } from 'node:path';
import { extractFile } from '@electron/asar';

/** Refuse a browser Free bundle accidentally left in the shared dist/web directory. */
export function requireDesktopRendererHtml(html) {
  const markers = [...html.matchAll(/<meta\b[^>]*>/giu)]
    .map(([tag]) =>
      Object.fromEntries(
        [...tag.matchAll(/\b(name|content)\s*=\s*["']([^"']*)["']/giu)].map(([, name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      ),
    )
    .filter((attributes) => attributes.name === 'kerfdesk-build-capabilities');
  if (markers.length !== 1 || markers[0].content !== 'desktop')
    throw new Error(
      'Desktop packaging requires the desktop renderer. Run pnpm build:bundle:desktop first.',
    );
}

export function verifyDesktopRendererAsar(asarPath) {
  requireDesktopRendererHtml(
    extractFile(asarPath, join('dist', 'web', 'index.html')).toString('utf8'),
  );
}

/** electron-builder supplies the platform-specific Resources path on every target. */
export default function verifyDesktopRenderer(context) {
  verifyDesktopRendererAsar(join(context.packager.getResourcesDir(context.appOutDir), 'app.asar'));
}
