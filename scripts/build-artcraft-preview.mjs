// Builds only the opt-in local source-development preview. Not a release artifact.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

export const ARTCRAFT_REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ARTCRAFT_PREVIEW_ROOT = path.join(ARTCRAFT_REPO_ROOT, '.artcraft', 'preview-app');

export async function buildArtcraftPreview() {
  // Vite may clean this generated directory. Never allow it outside this exact preview root.
  const output = path.resolve(ARTCRAFT_PREVIEW_ROOT, 'dist', 'web');
  if (
    path.relative(ARTCRAFT_REPO_ROOT, output) !==
    path.join('.artcraft', 'preview-app', 'dist', 'web')
  )
    throw new Error('Unexpected preview output directory');
  await mkdir(ARTCRAFT_PREVIEW_ROOT, { recursive: true });
  const compile = spawnSync(
    process.execPath,
    [
      path.join(ARTCRAFT_REPO_ROOT, 'node_modules/typescript/bin/tsc'),
      '--project',
      'electron/tsconfig.json',
      '--outDir',
      path.join(ARTCRAFT_PREVIEW_ROOT, 'dist-electron'),
    ],
    { cwd: ARTCRAFT_REPO_ROOT, stdio: 'inherit', windowsHide: true },
  );
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw new Error('Preview main process compilation failed');
  const previousEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    await build({
      root: ARTCRAFT_REPO_ROOT,
      mode: 'desktop',
      // DEV bootstrap normally requests /src from Vite. A direct entry bundles
      // that same development app offline, retaining its existing source-only edition policy.
      plugins: [
        {
          name: 'artcraft-source-preview-entry',
          enforce: 'pre',
          configResolved(config) {
            if (
              config.command !== 'build' ||
              config.mode !== 'desktop' ||
              path.resolve(config.build.outDir) !== output
            )
              throw new Error(
                'Source preview transform cannot run outside its fixed desktop development artifact',
              );
          },
          transform(source, id) {
            if (id.replaceAll('\\', '/').endsWith('/src/ui/app/main.tsx'))
              return { code: artcraftPreviewEntry(source), map: null };
            return null;
          },
          transformIndexHtml: {
            order: 'pre',
            handler: (html) => {
              const entry = '/src/ui/app/browser-entry.ts';
              if (html.split(entry).length !== 2)
                throw new Error('Source preview HTML entry changed');
              return html.replace(entry, '/src/ui/app/main.tsx');
            },
          },
        },
      ],
      build: { outDir: output, emptyOutDir: true },
    });
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
  const publicRoot = path.join(ARTCRAFT_PREVIEW_ROOT, 'public');
  await mkdir(publicRoot, { recursive: true });
  for (const entry of await readdir(path.join(ARTCRAFT_REPO_ROOT, 'public'), {
    withFileTypes: true,
  })) {
    if (entry.isFile() && /\.(?:mjs|json|txt)$/u.test(entry.name))
      await copyFile(
        path.join(ARTCRAFT_REPO_ROOT, 'public', entry.name),
        path.join(publicRoot, entry.name),
      );
  }
  await writeFile(
    path.join(ARTCRAFT_PREVIEW_ROOT, 'package.json'),
    JSON.stringify(
      {
        name: 'kerfdesk-artcraft-source-preview',
        version: '0.1.0',
        private: true,
        type: 'module',
        main: 'dist-electron/main.js',
        kerfdeskArtcraftSourcePreview: true,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    path.join(ARTCRAFT_PREVIEW_ROOT, 'preview-build.json'),
    JSON.stringify(
      {
        kind: 'artcraft-source-development-preview',
        builtAt: new Date().toISOString(),
        machineQualification: false,
        releaseArtifact: false,
        editionHarness: 'unrestricted-development-without-commercial-client',
      },
      null,
      2,
    ) + '\n',
  );
  await copyFile(
    path.join(ARTCRAFT_REPO_ROOT, 'LICENSE'),
    path.join(ARTCRAFT_PREVIEW_ROOT, 'LICENSE'),
  );
  await writeFile(
    path.join(ARTCRAFT_PREVIEW_ROOT, 'README.txt'),
    'Local ArtCraft source-development harness only. Never package or publish this artifact.\nThe preview-only build transform omits the commercial licence client and uses the existing unrestricted desktop development edition (ADR-540 Amendment 1). Production entry source and normal build commands are unchanged.\nUse scripts/start-artcraft-studio.mjs to launch with the isolated .artcraft/kerfdesk-preview profile.\n',
  );
  return ARTCRAFT_PREVIEW_ROOT;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(await buildArtcraftPreview());

/** ADR-540 Amendment 1: explicitly unrestricted local development, never shipping. */
export function artcraftPreviewEntry(source) {
  const normalized = source.replaceAll('\r\n', '\n');
  const client =
    "const desktopLicenceClient =\n  adapter.id === 'electron' && window.location.protocol === 'app:'\n    ? createDesktopLicenceAdapter()\n    : undefined;";
  if (
    normalized.split(client).length !== 2 ||
    !normalized.includes('import.meta.env.DEV &&') ||
    !normalized.includes('? { unlicensedRunsFree: false }')
  )
    throw new Error(
      'Desktop source development entry changed; review the preview harness before rebuilding',
    );
  return normalized.replace(client, 'const desktopLicenceClient = undefined;');
}
