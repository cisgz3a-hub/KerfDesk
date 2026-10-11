import { translateEntity } from '../../core/design/ops/translate-entities';
import { sessionSketch, withSketch, type DesignSession } from './design-session';
import { setSessionTool } from './design-session-mutations';

export function selectAllSession(session: DesignSession): DesignSession {
  const ids = sessionSketch(session).entities.map((entity) => entity.id);
  return { ...setSessionTool(session, 'select'), selectedIds: new Set(ids) };
}

/** Identity comes from the UI; the whole copied selection is one history step. */
export function duplicateSelectionSession(
  session: DesignSession,
  newIds: ReadonlyMap<string, string>,
): DesignSession {
  const sketch = sessionSketch(session);
  const used = new Set(sketch.entities.map((entity) => entity.id));
  const copies = sketch.entities.flatMap((entity) => {
    const id = newIds.get(entity.id);
    if (!session.selectedIds.has(entity.id) || id === undefined || used.has(id)) return [];
    used.add(id);
    return [{ ...translateEntity(entity, { x: 5, y: 5 }), id }];
  });
  if (copies.length === 0) return session;
  return {
    ...withSketch(session, { ...sketch, entities: [...sketch.entities, ...copies] }),
    selectedIds: new Set(copies.map((entity) => entity.id)),
  };
}
