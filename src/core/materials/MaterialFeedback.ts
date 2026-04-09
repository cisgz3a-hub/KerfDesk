/**
 * Self-learning material system.
 * Tracks job outcomes per material+machine+settings combination.
 * Over time, builds confidence in which settings work for which materials.
 */

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

/**
 * Record a job outcome for learning
 */
export function recordMaterialOutcome(record: MaterialRecord): void {
  try {
    const records = loadRecords();
    records.push(record);
    // Keep last 200 records
    while (records.length > 200) records.shift();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    console.warn('Failed to save material feedback');
  }
}

/**
 * Get a suggestion for a material+machine+mode based on past outcomes
 */
export function getSuggestion(
  material: string,
  machineType: string,
  mode: string,
): MaterialSuggestion | null {
  const records = loadRecords();

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
export function getMaterialHistory(
  material: string,
  machineType: string,
): MaterialRecord[] {
  return loadRecords().filter(r =>
    r.material === material && r.machineType === machineType
  );
}

function loadRecords(): MaterialRecord[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}
