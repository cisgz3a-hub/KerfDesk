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
import type { GrblLaserPowerMode } from './GcodeOrigin';

export class GrblOutputStrategy extends BaseGCodeStrategy {
  readonly formatId: OutputFormat = 'grbl';
  readonly formatName = 'GRBL 1.1 (G-code)';
  readonly supportsDynamicLaserPower = true;

  /**
   * GRBL uses M4 for dynamic laser mode.
   * M4 = firmware scales laser power by current_velocity / programmed_feedrate.
   * Software-side accel-aware splitting must be disabled in this mode.
   */
  encodeLaserOn(power: number): string {
    return `M4 ${this.encodePowerValue(power)}`;
  }

  protected encodeLaserOnForMaxSpindle(
    power: number,
    maxSpindle: number,
    grblLaserPowerMode: GrblLaserPowerMode = 'dynamic-m4',
  ): string {
    const modal = grblLaserPowerMode === 'constant-m3' ? 'M3' : 'M4';
    return `${modal} ${this.encodePowerValueForMaxSpindle(power, maxSpindle)}`;
  }

  encodeLaserOff(): string {
    return 'M5 S0';
  }

  encodePowerValue(power: number): string {
    return this.encodePowerValueForMaxSpindle(power, this._maxSpindle);
  }

  protected encodePowerValueForMaxSpindle(power: number, maxSpindle: number): string {
    const pct = Math.max(0, Math.min(100, power));
    const sValue = Math.round((pct / 100) * maxSpindle);
    return `S${sValue}`;
  }
}

// ─── REGISTER ────────────────────────────────────────────────────
// Self-registering: importing this file adds GRBL to available strategies.

registerOutputStrategy(new GrblOutputStrategy());
