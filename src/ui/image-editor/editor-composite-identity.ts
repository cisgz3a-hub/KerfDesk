import type { RgbaBuffer } from '../../core/image-edit';
import type { EditorSession } from './editor-session';

/** Only an opaque plain layer can stand in for the white-backed composite. */
export function compositeIdentity(session: EditorSession): RgbaBuffer | null {
  const only = session.layers.length === 1 ? session.layers[0] : undefined;
  if (
    only === undefined ||
    !only.isVisible ||
    only.opacity !== 1 ||
    only.blend !== 'normal' ||
    only.buffer !== session.doc
  )
    return null;
  for (let i = 3; i < only.buffer.data.length; i += 4) {
    if (only.buffer.data[i] !== 255) return null;
  }
  return only.buffer;
}
