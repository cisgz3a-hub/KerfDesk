import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { parseStlBlob } from './parse-stl-blob';

function binaryStl(triangleCount: number): Uint8Array {
  const bytes = new Uint8Array(84 + triangleCount * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangleCount, true);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = 84 + triangle * 50 + 12;
    for (let value = 0; value < 9; value += 1) {
      view.setFloat32(base + value * 4, triangle + value / 10, true);
    }
  }
  return bytes;
}

describe('parseStlBlob', () => {
  it('streams binary records into an exact typed position buffer', async () => {
    const bytes = binaryStl(2_000);
    const progress = vi.fn();

    const result = await parseStlBlob(new NodeBlob([bytes]) as unknown as Blob, progress);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.format).toBe('binary');
      expect(result.mesh.positions).toBeInstanceOf(Float32Array);
      expect(result.mesh.positions).toHaveLength(18_000);
      expect(result.mesh.positions[9]).toBe(1);
    }
    expect(progress).toHaveBeenLastCalledWith({
      bytesRead: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });
  });

  it('validates then fills ASCII vertices in two streamed passes', async () => {
    const text =
      'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\n' +
      'vertex 2 0 0\nvertex 0 3 4\nendloop\nendfacet\nendsolid x\n';
    const progress = vi.fn();

    const result = await parseStlBlob(new NodeBlob([text]) as unknown as Blob, progress);

    expect(result).toEqual({
      kind: 'ok',
      format: 'ascii',
      mesh: { positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 4]) },
    });
    expect(progress).toHaveBeenLastCalledWith({
      bytesRead: text.length * 2,
      totalBytes: text.length * 2,
    });
  });

  it('preserves the binary size-integrity diagnosis before allocating positions', async () => {
    const truncated = binaryStl(2).slice(0, -10);

    const result = await parseStlBlob(new NodeBlob([truncated]) as unknown as Blob);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('truncated or padded');
  });
});
