import type { Box } from './scene';
import { selectionComplete, store } from './store';

type Write = <T extends Record<string, unknown>>(
  command: string,
  args: Record<string, unknown>,
  options?: { expectedRevision?: string },
) => Promise<T | null>;

/** A direct drag selects its target only when committed; cancellation stays entirely local. */
export async function moveArtwork(
  write: Write,
  ids: string[],
  dxMm: number,
  dyMm: number,
  batch: boolean,
  current: () => boolean,
): Promise<void> {
  const state = store.get();
  const args = { artworkIds: ids, transform: { type: 'move', dxMm, dyMm } };
  if (
    state.selectionSync === 'desktop' &&
    selectionComplete(state) &&
    state.selection.length === ids.length &&
    ids.every((id) => state.selection.includes(id))
  ) {
    await write('transform_artwork', args);
    return;
  }
  if (batch) {
    await write('apply_edits', {
      edits: [
        { command: 'set_selection', args: { artworkIds: ids } },
        { command: 'transform_artwork', args },
      ],
    });
    return;
  }
  const selected = await write<{ revision: string }>('set_selection', { artworkIds: ids });
  if (selected !== null && current())
    await write('transform_artwork', args, { expectedRevision: selected.revision });
}

/** Keep the opposite corner fixed; capable desktops apply resize and move in one Undo. */
export async function resizeArtwork(
  write: Write,
  ids: string[],
  from: Box,
  to: Box,
  batch: boolean,
  current: () => boolean,
): Promise<void> {
  const widthMm = Math.max(0.01, to.maxX - to.minX);
  const heightMm = Math.max(0.01, to.maxY - to.minY);
  const dxMm = to.minX - from.minX;
  const dyMm = to.minY - from.minY;
  const resize = { type: 'resize', widthMm, heightMm };
  if (batch) {
    const edits: Record<string, unknown>[] = [
      { command: 'transform_artwork', args: { artworkIds: ids, transform: resize } },
    ];
    if (Math.abs(dxMm) > 1e-6 || Math.abs(dyMm) > 1e-6)
      edits.push({
        command: 'transform_artwork',
        args: { artworkIds: ids, transform: { type: 'move', dxMm, dyMm } },
      });
    await write('apply_edits', { edits });
    return;
  }
  const result = await write<{ revision: string }>('transform_artwork', {
    artworkIds: ids,
    transform: resize,
  });
  if (result === null || !current()) return;
  if (Math.abs(dxMm) > 1e-6 || Math.abs(dyMm) > 1e-6)
    await write(
      'transform_artwork',
      { artworkIds: ids, transform: { type: 'move', dxMm, dyMm } },
      { expectedRevision: result.revision },
    );
}
