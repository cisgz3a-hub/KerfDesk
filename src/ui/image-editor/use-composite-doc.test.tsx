import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createSession } from './editor-session';
import * as identity from './editor-composite-identity';
import { useCompositeDoc } from './use-composite-doc';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('does not scan unchanged pixels again for unrelated canvas renders', async () => {
  const session = createSession('image', 'fixture', createRgbaBuffer(4, 4), {
    minX: 0,
    minY: 0,
    maxX: 4,
    maxY: 4,
  });
  const scan = vi.spyOn(identity, 'compositeIdentity');
  function Probe({ revision, tick }: { revision: number; tick: number }) {
    const doc = useCompositeDoc(session, revision);
    return <div data-tick={tick}>{doc?.width}</div>;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Probe revision={0} tick={0} />));
    for (let tick = 1; tick <= 10; tick += 1) {
      await act(async () => root.render(<Probe revision={0} tick={tick} />));
    }
    expect(scan).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Probe revision={1} tick={11} />));
    expect(scan).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  }
});
