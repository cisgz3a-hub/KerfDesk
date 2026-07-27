// FluidNC keeps its real configuration in YAML and exposes the familiar
// numeric GRBL settings only as read-only *proxies* of it. Writing one never
// takes effect; it answers error 162.
//
// Verified against FluidNC v4.0.3 (released 2026-04-20):
//   SettingsDefinitions.cpp  make_proxies() registers, via
//     `#define INT_PROXY(number, name, configvar) { new IntProxySetting(...) }`
//       INT_PROXY("32", "Grbl/LaserMode",         spindle->isRateAdjusted())
//       INT_PROXY("30", "Grbl/MaxSpindleSpeed",   spindle->maxSpeed())
//       INT_PROXY("23", "Grbl/HomingDirections",  Homing::direction_mask);
//       INT_PROXY("22", "Grbl/HomingCycleEnable", (bool)Axes::homingMask);
//       INT_PROXY("21", "Grbl/HardLimitsEnable",  config._axes->hasHardLimits());
//       INT_PROXY("20", "Grbl/SoftLimitsEnable",  config._axes->_axis[0]->_softLimits);
//   Settings.h   `class IntProxySetting : public Setting { ...
//                 Error setStringValue(std::string_view value) override
//                     { return Error::ReadOnlySetting; } ... };`
//   Error.h      `ReadOnlySetting = 162,`
//
// $31 is deliberately absent: make_proxies() does not register it, so KerfDesk
// must not claim it mirrors the YAML config. The per-axis float proxies
// ($100/$110/$120/$130 + axis index) are also read-only upstream but are not
// modelled here — they are outside the guarded common-setting lane.

/** Error FluidNC answers a proxy-setting write with. */
export const FLUIDNC_READ_ONLY_SETTING_ERROR_CODE = 162;

/** Numeric GRBL settings FluidNC registers as read-only config mirrors. */
export const FLUIDNC_READ_ONLY_SETTING_IDS: ReadonlySet<number> = new Set([20, 21, 22, 23, 30, 32]);

/**
 * Reports whether FluidNC would reject a write to a numeric GRBL setting.
 * @param id Numeric GRBL setting id, e.g. 32 for `$32`.
 * @returns `true` when FluidNC exposes the setting as a read-only proxy.
 */
export function isFluidncReadOnlySetting(id: number): boolean {
  return FLUIDNC_READ_ONLY_SETTING_IDS.has(id);
}
