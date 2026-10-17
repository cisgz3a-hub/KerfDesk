// Test-only file adapter: real command output bytes, explicitly no native picker.
import { create } from 'zustand';
import type { FileHandle, PlatformAdapter, SaveTarget } from '../../src/platform/types';

interface Output {
  name: string;
  bytes: number;
  sha256: string;
  detail: string;
  url: string;
}
const useFiles = create<{ queued: File[]; outputs: Output[]; message: string }>(() => ({
  queued: [],
  outputs: [],
  message: 'No synthetic files queued.',
}));
const contents = new Map<string, Blob>();
let pauseNextLookup = false;
let resumeLookup: (() => void) | null = null;

async function exists(name: string): Promise<boolean> {
  if (pauseNextLookup) {
    pauseNextLookup = false;
    useFiles.setState({
      message: 'Filename lookup paused. Cancel Multi-File Trace, then resume this lookup.',
    });
    await new Promise<void>((resolve) => {
      resumeLookup = resolve;
    });
    resumeLookup = null;
    useFiles.setState({ message: 'Filename lookup resumed.' });
  }
  return contents.has(name);
}

async function digest(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function describe(blob: Blob, name: string): Promise<string> {
  if (name.endsWith('.svg')) {
    const document = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    if (document.querySelector('parsererror')) throw new Error('Exported SVG did not parse');
    return `${document.querySelectorAll('path').length} SVG paths`;
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No fixture pixel decoder');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if ((pixels[i] ?? 255) < 128) dark++;
    return `${bitmap.width} × ${bitmap.height} pixels; ${dark} dark pixels`;
  } finally {
    bitmap.close();
  }
}

function target(name: string): SaveTarget {
  return {
    displayName: name,
    write: async (data) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const detail = await describe(blob, name);
      const sha256 = await digest(blob);
      contents.set(name, blob);
      useFiles.setState((state) => ({
        outputs: [
          ...state.outputs.filter((file) => file.name !== name),
          { name, bytes: blob.size, sha256, detail, url: URL.createObjectURL(blob) },
        ],
      }));
    },
  };
}

export const auditFiles: Pick<
  PlatformAdapter,
  'pickFilesForOpen' | 'pickFileForSave' | 'reserveSaveDirectory'
> = {
  pickFilesForOpen: async () =>
    useFiles.getState().queued.map(
      (file): FileHandle => ({
        name: file.name,
        size: file.size,
        text: () => file.text(),
        blob: async () => file,
      }),
    ),
  pickFileForSave: async (request) => target(request.suggestedName),
  reserveSaveDirectory: async () => ({ file: target, exists }),
};

async function image(name: string, ring: boolean): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No fixture canvas');
  context.fillStyle = 'white';
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = 'black';
  context.fillRect(8, 8, 48, 48);
  if (ring) {
    context.fillStyle = 'white';
    context.fillRect(24, 24, 16, 16);
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Fixture PNG failed')))),
  );
  return new File([blob], name, { type: 'image/png' });
}

async function queue(batch: boolean, stress = false): Promise<void> {
  const square = await image('audit-square.png', false);
  const queued = stress
    ? [
        ...Array.from({ length: 32 }, () => square),
        new File(['invalid PNG'], 'unreadable.png', { type: 'image/png' }),
      ]
    : batch
      ? [
          square,
          square,
          await image('audit-ring.png', true),
          new File(['invalid PNG'], 'unreadable.png', { type: 'image/png' }),
        ]
      : [square];
  useFiles.setState({
    queued,
    message: `${queued.length} files queued. Square source SHA-256: ${await digest(square)}`,
  });
}

export function AuditFileControls() {
  const state = useFiles();
  return (
    <details open aria-label="Synthetic file audit controls">
      <summary>Test file adapter · in-memory outputs · native pickers are not tested</summary>
      <button type="button" onClick={() => void queue(false)}>
        Queue one synthetic PNG for Import
      </button>
      <button type="button" onClick={() => void queue(true)}>
        Queue batch: duplicate square, ring, unreadable
      </button>
      <button type="button" onClick={() => void queue(true, true)}>
        Queue stress: 32 duplicate images and one unreadable
      </button>
      <button
        type="button"
        onClick={() => {
          pauseNextLookup = true;
          useFiles.setState({ message: 'Next filename lookup will pause.' });
        }}
      >
        Pause next batch filename lookup
      </button>
      <button type="button" onClick={() => resumeLookup?.()}>
        Resume pending filename lookup
      </button>
      <p>{state.message}</p>
      <p>
        Use the real Import or Tools commands after queueing. Captured exports:{' '}
        {state.outputs.length}
      </p>
      <ul>
        {state.outputs.map((output) => (
          <li key={output.name}>
            <a href={output.url} download={output.name}>
              {output.name}
            </a>
            : {output.bytes} bytes; {output.detail}; SHA-256 {output.sha256}
            <img src={output.url} width={64} height={64} alt={`Decoded export ${output.name}`} />
          </li>
        ))}
      </ul>
    </details>
  );
}
