// Which Air-off operations run with the air held on anyway (ADR-335).
//
// Some vendor firmware cannot be trusted to restart air assist inside a
// running program. Creality's A1 family delays the real shutoff after M9 by
// `$152`, and its shipped build has dropped the pump seconds after a fresh M8,
// which is the documented "air works while engraving but stops when it cycles
// over to cutting". Emitting `M9` then `M8` across an Air-off operation is
// exactly the sequence such a controller fails to honour, and the operations
// that lose their air are the ones AFTER the gap, not the one that asked for
// none.
//
// So on those machines an Air-off operation that sits BETWEEN two Air-on ones
// keeps the air running. A leading or trailing run of Air-off operations is
// never bridged: that would pre-arm the pump before the first operation that
// wants air, or hold it past the last one, and neither is the operator's
// instruction being rescued from the firmware — it is just extra air.
//
// This is deliberately the ONLY place the rule lives. The emitter reads it to
// decide what bytes to write and Job Review reads it to tell the operator what
// was done, so the advisory can never describe a hold the emitter did not make.

/**
 * Indices of Air-off operations whose request is overridden to keep air on.
 *
 * `wantsAir[i]` is whether operation `i` asks for air AND the device can
 * actually command it. Returns an empty set when nothing is bridged, which is
 * every machine whose `M9` takes effect immediately.
 */
export function bridgedAirGapIndices(
  wantsAir: ReadonlyArray<boolean>,
  restartUnreliable: boolean,
): ReadonlySet<number> {
  if (!restartUnreliable) return EMPTY;
  const firstOn = wantsAir.indexOf(true);
  const lastOn = wantsAir.lastIndexOf(true);
  if (firstOn < 0 || lastOn <= firstOn) return EMPTY;
  const bridged = new Set<number>();
  for (let index = firstOn + 1; index < lastOn; index += 1) {
    if (!(wantsAir[index] ?? false)) bridged.add(index);
  }
  return bridged;
}

const EMPTY: ReadonlySet<number> = new Set<number>();
