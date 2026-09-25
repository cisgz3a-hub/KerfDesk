// grblHAL status codes above GRBL 1.1's 38, with grblHAL's own wording
// (grblHAL/core errors.c at d7aaee3d84b1e7010f075d395206afff038d7379). Codes
// 1-38 keep the shared GRBL meanings. A few carry a detail naming what the
// operator does next (controller audit 2026-09-25 HF-3): error:79 is the answer
// `$X` and `$H` get while a hard limit, soft limit, E-stop or motor fault still
// holds the controller, which only a soft reset clears (system.c:1179-1181).

import type { ErrorDescription } from './error-codes';

const GRBLHAL_EXTENDED_ERROR_ENTRIES: ReadonlyArray<readonly [number, string, string?]> = [
  [39, 'Value out of range.'],
  [40, 'G-code command not allowed when tool change is pending.'],
  [41, 'Spindle not running when motion commanded in CSS or spindle sync mode.'],
  [42, 'Plane must be ZX for threading.'],
  [43, 'Max. feed rate exceeded.'],
  [44, 'RPM out of range.'],
  [
    45,
    'Only homing is allowed when a limit switch is engaged.',
    'Clear the limit switch, or home the machine.',
  ],
  [46, 'Home machine to continue.', 'Run the homing cycle before other commands.'],
  [47, 'ATC: current tool is not set. Set current tool with M61.'],
  [48, 'Value word conflict.'],
  [49, 'Power on self test failed. A hard reset is required.'],
  [50, 'Emergency stop active.', 'Release the E-stop, then soft-reset (Ctrl-X) and unlock.'],
  [51, 'Motor fault.'],
  [52, 'Setting value is out of range.'],
  [53, 'Setting is not available, possibly due to limited driver support.'],
  [54, 'Retract position is less than drill depth.'],
  [55, 'Attempt to home two auto squared axes at the same time.'],
  [56, 'Coordinate system is locked.'],
  [57, 'Unexpected file demarcation.'],
  [58, 'Port is not available'],
  [71, 'Unknown operation found in expression.'],
  [72, 'Divide by zero in expression attempted.'],
  [73, 'Too large or too small argrument provided.'],
  [74, 'Argument is not valid for the operation'],
  [75, 'Expression is not valid.'],
  [76, 'Either NAN (not a number) or infinity was returned from expression.'],
  [77, 'Authentication required.'],
  [78, 'Access denied.'],
  [
    79,
    'Not allowed while critical event is active.',
    'A hard limit, soft limit, E-stop or motor fault stopped the controller, and it accepts only a soft reset until then. Press Reset (Ctrl-X), then unlock or home.',
  ],
  [80, 'Flow statement only allowed in filesystem macro.'],
  [81, 'Unknown flow statement.'],
  [82, 'Stack overflow while executing flow statement.'],
  [83, 'Out of memory while executing flow statement.'],
  [84, 'Could not open file.'],
  [86, 'Port is not usable.'],
  [87, 'Tool in spindle.'],
  [88, 'No tool in spindle.'],
  [90, 'Cutter compensation is already active.'],
  [91, 'Command not allowed while cutter compensation is active.'],
  [92, 'Cutter compensation is not valid for current move.'],
];

const GRBLHAL_EXTENDED_ERRORS: ReadonlyMap<number, ErrorDescription> = new Map(
  GRBLHAL_EXTENDED_ERROR_ENTRIES.map(([code, title, detail]) => [
    code,
    detail === undefined ? { code, title, detail: title } : { code, title, detail },
  ]),
);

/** grblHAL's description of a status code above 38, or null. */
export function describeGrblhalExtendedError(code: number): ErrorDescription | null {
  return GRBLHAL_EXTENDED_ERRORS.get(code) ?? null;
}
