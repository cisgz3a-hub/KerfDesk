/**
 * === FILE: /src/core/output/GrblStrategy.ts ===
 * 
 * Purpose:    GRBL-specific G-code generation strategy.
 *             GRBL uses M4 for dynamic laser mode and S0-S1000 for power.
 *             This is the most common controller for diode lasers.
 * 
 * Dependencies:
 *   - /src/core/output/Output.ts
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { BaseGCodeStrategy, type OutputFormat, registerOutputStrategy } from './Output';

export class GrblOutputStrategy extends BaseGCodeStrategy {
  readonly formatId: OutputFormat = 'grbl';
  readonly formatName = 'GRBL 1.1 (G-code)';

  /**
   * Upper bound for S in M4/M3 (GRBL $30). 0–100% laser power maps linearly to 0–maxSpindle.
   * Set from the active device profile before generating G-code.
   */
  maxSpindle = 1000;

  /**
   * GRBL uses M4 for dynamic laser mode.
   * M4 = laser power scales with speed during acceleration.
   * This prevents burning during acceleration/deceleration.
   */
  encodeLaserOn(power: number): string {
    return `M4 ${this.encodePowerValue(power)}`;
  }

  encodeLaserOff(): string {
    return 'M5 S0';
  }

  encodePowerValue(power: number): string {
    const pct = Math.max(0, Math.min(100, power));
    const sValue = Math.round((pct * this.maxSpindle) / 100);
    return `S${sValue}`;
  }
}

// ─── REGISTER ────────────────────────────────────────────────────
// Self-registering: importing this file adds GRBL to available strategies.

registerOutputStrategy(new GrblOutputStrategy());
