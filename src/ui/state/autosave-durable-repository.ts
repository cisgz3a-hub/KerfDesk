import type {
  AutosaveIndexedDbMutation,
  AutosaveIndexedDbRecord,
  AutosaveIndexedDbSlot,
} from './autosave-indexeddb';

export interface AutosaveDurableRepository {
  commit(
    record: AutosaveIndexedDbRecord,
    expectedEpoch: number,
  ): Promise<AutosaveIndexedDbMutation>;
  clear(input: {
    readonly storageKey: string;
    readonly sessionId: string;
    readonly expectedEpoch: number;
  }): Promise<AutosaveIndexedDbMutation>;
  readEpoch(storageKey: string): Promise<number>;
  readAllSlots(): Promise<ReadonlyArray<AutosaveIndexedDbSlot>>;
}
