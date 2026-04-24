/**
 * Self-learning material system.
 * Tracks job outcomes per material+machine+settings combination.
 * Over time, builds confidence in which settings work for which materials.
 */

import { getStorage } from '../storage/storage';

export interface MaterialRecord {
  material: string;          // e.g. "3mm Birch Plywood"
  machineType: string;       // 'diode' | 'co2' | 'fiber'
  mode: string;              // 'cut' | 'engrave' | 'score'
  power: number;
  speed: number;
  passes: number;
  outcome: string;           // 'perfect' | 'too_dark' | 'too_light' | 'didnt_cut' | 'burned'
  timestamp: string;         // ISO date
}

export interface MaterialSuggestion {
  power: number;
  speed: number;
  passes: number;
  confidence: number;        // 0-100, based on how many "perfect" outcomes
  sampleCount: number;
  lastUsed: string;
}

const STORAGE_KEY = 'laserforge_material_feedback';

let _migrationAttempted = false;

async function migrateMaterialFeedbackFromLocalStorage(): Promise<void> {
  if (_migrationAttempted) return;
  _migrationAttempted = true;
  if (typeof localStorage === 'undefined') return;
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy === null) return;
    const storage = getStorage();
    const existing = await storage.get(STORAGE_KEY);
    if (existing !== null) return;
    await storage.set(STORAGE_KEY, legacy);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function resetMaterialFeedbackForTest(): void {
  _migrationAttempted = false;
}

/**
 * Record a job outcome for learning
 */
export function recordMaterialOutcome(record: MaterialRecord): void {
  void persistOutcome(record).catch(() => {
    console.warn('Failed to save material feedback');
  });
}

async function persistOutcome(record: MaterialRecord): Promise<void> {
  await migrateMaterialFeedbackFromLocalStorage();
  const records = await loadRecordsAsync();
  records.push(record);
  while (records.length > 200) records.shift();
  await getStorage().set(STORAGE_KEY, JSON.stringify(records));
}

async function loadRecordsAsync(): Promise<MaterialRecord[]> {
  try {
    const raw = await getStorage().get(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as MaterialRecord[] : [];
  } catch {
    return [];
  }
}

/**
 * Get a suggestion for a material+machine+mode based on past outcomes
 */
export async function getSuggestion(
  material: string,
  machineType: string,
  mode: string,
): Promise<MaterialSuggestion | null> {
  await migrateMaterialFeedbackFromLocalStorage();
  const records = await loadRecordsAsync();

  // Find matching records
  const matches = records.filter(r =>
    r.material === material &&
    r.machineType === machineType &&
    r.mode === mode
  );

  if (matches.length === 0) return null;

  // Find records with "perfect" outcome
  const perfect = matches.filter(r => r.outcome === 'perfect');

  if (perfect.length > 0) {
    // Use the most recent perfect settings
    const latest = perfect[perfect.length - 1];
    return {
      power: latest.power,
      speed: latest.speed,
      passes: latest.passes,
      confidence: Math.min(100, Math.round((perfect.length / matches.length) * 100)),
      sampleCount: matches.length,
      lastUsed: latest.timestamp,
    };
  }

  // No perfect results — suggest adjustments based on failures
  const latest = matches[matches.length - 1];
  let suggestedPower = latest.power;
  let suggestedSpeed = latest.speed;
  let suggestedPasses = latest.passes;

  if (latest.outcome === 'too_dark' || latest.outcome === 'burned') {
    suggestedPower = Math.max(5, latest.power - 10);
    suggestedSpeed = Math.round(latest.speed * 1.2);
  } else if (latest.outcome === 'too_light' || latest.outcome === 'didnt_cut') {
    suggestedPower = Math.min(100, latest.power + 10);
    suggestedSpeed = Math.round(latest.speed * 0.8);
  }

  return {
    power: suggestedPower,
    speed: suggestedSpeed,
    passes: suggestedPasses,
    confidence: 0,
    sampleCount: matches.length,
    lastUsed: latest.timestamp,
  };
}

/**
 * Get history summary for a material
 */
export async function getMaterialHistory(
  material: string,
  machineType: string,
): Promise<MaterialRecord[]> {
  await migrateMaterialFeedbackFromLocalStorage();
  const records = await loadRecordsAsync();
  return records.filter(r =>
    r.material === material && r.machineType === machineType
  );
}
