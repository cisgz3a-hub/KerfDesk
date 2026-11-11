// core/design/entry — typed numeric entry during a draw gesture (ADR-272
// Amendment 5, Phase N DS-3c).
//
// Its own sub-barrel, like core/design/snap and core/design/ops: the parent
// barrel is at the ADR-015 cap, and the dimension tool's value parsing can
// share this one without pressing on it.

export {
  hasEntryLocks,
  lockPolarPoint,
  lockSweepEnd,
  NO_ENTRY_LOCKS,
  parseEntryValue,
  withEntryLock,
  type EntryLockKey,
  type EntryLocks,
  type EntryParse,
} from './typed-entry';
