export const RECOVERY_PURGE_GENERATION_KEY = 'laserforge.recovery-purge-generation.v1';

export type RecoveryGenerationStore = {
  readonly read: () => number;
  readonly write: (generation: number) => boolean;
};

export class MemoryRecoveryGenerationStore implements RecoveryGenerationStore {
  private generation = 0;

  read(): number {
    return this.generation;
  }

  write(generation: number): boolean {
    this.generation = Math.max(this.generation, generation);
    return true;
  }
}

export class LocalStorageRecoveryGenerationStore implements RecoveryGenerationStore {
  constructor(private readonly storage: Storage | null = availableLocalStorage()) {}

  read(): number {
    try {
      const raw = this.storage?.getItem(RECOVERY_PURGE_GENERATION_KEY);
      if (raw === null || raw === undefined) return 0;
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  write(generation: number): boolean {
    try {
      this.storage?.setItem(RECOVERY_PURGE_GENERATION_KEY, String(generation));
      return this.storage !== null;
    } catch {
      return false;
    }
  }
}

export function availableLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
