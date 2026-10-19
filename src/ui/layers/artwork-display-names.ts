import { artworkOperationName, isRegistrationBox, type SceneObject } from '../../core/scene';

// One name per artwork for every place that lists it: the Properties header,
// the Artwork picker and Run order. It is the artwork's own name, numbered in
// canvas order when several share it, so "Rectangle (2)" is the same artwork
// everywhere and each run's controls have their own accessible name (ADR-631).
export function artworkDisplayNames(
  objects: ReadonlyArray<SceneObject>,
): ReadonlyMap<string, string> {
  const artwork = objects.filter((object) => !isRegistrationBox(object));
  const bases = artwork.map(artworkOperationName);
  const totals = new Map<string, number>();
  bases.forEach((base) => totals.set(base, (totals.get(base) ?? 0) + 1));
  // Reserve every natural name before assigning suffixes, including names
  // such as "Rectangle (1)" that look like a generated label.
  const taken = new Set(bases);
  const seen = new Map<string, number>();
  return new Map(
    artwork.map((object, index) => {
      const base = bases[index] ?? artworkOperationName(object);
      if ((totals.get(base) ?? 0) < 2) return [object.id, base];
      let occurrence = (seen.get(base) ?? 0) + 1;
      let name = `${base} (${occurrence})`;
      while (taken.has(name)) {
        occurrence += 1;
        name = `${base} (${occurrence})`;
      }
      seen.set(base, occurrence);
      taken.add(name);
      return [object.id, name];
    }),
  );
}

export function artworkDisplayName(
  names: ReadonlyMap<string, string>,
  object: SceneObject,
): string {
  return names.get(object.id) ?? artworkOperationName(object);
}
