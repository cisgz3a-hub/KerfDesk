// JCZ LMC (EZCad2-class galvo board) opcodes and USB facts (ADR-704). Every
// value follows MeerK40t at d511944e (MIT, meerk40t/balormk/), which its README
// says was rewritten from scratch rather than from the GPL balor code:
// controller.py L23-24 (the list filler), L26-57 (list opcodes, 0x8000 and
// up), L59-112 (single commands), L206-208 (status bits); usb_connection.py
// L13-17 (USB ids and bulk endpoints) and L272-301 (packet sizes, 8-byte
// replies). Clean-room TypeScript; NOT verified on a real controller.

/** USB vendor and product id of the LMC board (usb_connection.py L13-14). */
export const LMC_USB_VENDOR_ID = 0x9588;
export const LMC_USB_PRODUCT_ID = 0x9899;
/** Bulk endpoint NUMBERS (direction bit dropped): OUT 0x02 → 2, IN 0x88 → 8. */
export const LMC_ENDPOINT_OUT = 2;
export const LMC_ENDPOINT_IN = 8;

/** One command: six little-endian uint16 words (controller.py L601-616). */
export const LMC_COMMAND_BYTES = 12;
/** One list packet: 256 commands (controller.py L24, L596; usb L274). */
export const LMC_LIST_BYTES = 0xc00;
export const LMC_LIST_COMMANDS = LMC_LIST_BYTES / LMC_COMMAND_BYTES;
/** Each single command is answered by four little-endian uint16 words. */
export const LMC_REPLY_BYTES = 8;

// List opcodes (controller.py L26-57). Only those this build writes, plus the
// ones its decoder must name, are listed.
export const LIST_JUMP_TO = 0x8001;
/** Also the filler of an unused list slot (controller.py L23-24). */
export const LIST_END_OF_LIST = 0x8002;
export const LIST_LASER_ON_POINT = 0x8003;
/** Delay in units of 10 µs (controller.py L1179-1186). */
export const LIST_DELAY_TIME = 0x8004;
export const LIST_MARK_TO = 0x8005;
export const LIST_JUMP_SPEED = 0x8006;
export const LIST_LASER_ON_DELAY = 0x8007;
export const LIST_LASER_OFF_DELAY = 0x8008;
export const LIST_MARK_FREQ = 0x800a;
export const LIST_MARK_POWER_RATIO = 0x800b;
export const LIST_MARK_SPEED = 0x800c;
export const LIST_JUMP_DELAY = 0x800d;
export const LIST_POLYGON_DELAY = 0x800f;
export const LIST_WRITE_PORT = 0x8011;
export const LIST_MARK_CURRENT = 0x8012;
export const LIST_QSWITCH_PERIOD = 0x801b;
export const LIST_SET_CO2_FPK = 0x801e;
export const LIST_FIBER_YLPM_PULSE_WIDTH = 0x8026;
/** Seen at the start of every list program (controller.py L1464-1470). */
export const LIST_READY_MARK = 0x8051;

// Single commands (controller.py L59-112).
export const LMC_DISABLE_LASER = 0x0002;
export const LMC_ENABLE_LASER = 0x0004;
export const LMC_EXECUTE_LIST = 0x0005;
export const LMC_SET_PWM_PULSE_WIDTH = 0x0006;
export const LMC_GET_VERSION = 0x0007;
export const LMC_GET_SERIAL_NO = 0x0009;
export const LMC_GET_LIST_STATUS = 0x000a;
export const LMC_WRITE_COR_LINE = 0x0010;
export const LMC_RESET_LIST = 0x0012;
export const LMC_RESTART_LIST = 0x0013;
export const LMC_WRITE_COR_TABLE = 0x0015;
export const LMC_SET_CONTROL_MODE = 0x0016;
export const LMC_SET_DELAY_MODE = 0x0017;
export const LMC_SET_END_OF_LIST = 0x0019;
export const LMC_SET_FIRST_PULSE_KILLER = 0x001a;
export const LMC_SET_LASER_MODE = 0x001b;
export const LMC_SET_TIMING = 0x001c;
export const LMC_SET_STANDBY = 0x001d;
export const LMC_SET_PWM_HALF_PERIOD = 0x001e;
export const LMC_STOP_EXECUTE = 0x001f;
export const LMC_STOP_LIST = 0x0020;
export const LMC_WRITE_PORT = 0x0021;
export const LMC_WRITE_ANALOG_PORT_1 = 0x0022;
export const LMC_SET_FPK_PARAM_2 = 0x002e;
export const LMC_SET_FLY_RES = 0x0032;
export const LMC_FIBER_SET_MO = 0x0033;
export const LMC_ENABLE_Z = 0x003a;
export const LMC_RESET = 0x0040;
export const LMC_GET_MARK_TIME = 0x0041;

/** Bits of reply word 3 (controller.py L206-208, read from GetVersion). */
export const LMC_STATUS_BUSY = 0x04;
export const LMC_STATUS_READY = 0x20;
/** GetListStatus word 3 (controller.py L1499-1514): running, paused. */
export const LMC_LIST_RUNNING = 0x0004;
export const LMC_LIST_PAUSED = 0x0008;

/** Port bit 0 is raised for a marking program and lowered after it; the red
 *  pointer light is on bit 8 by default (controller.py L258, L492, L558-559). */
export const LMC_PORT_PROGRAM_BIT = 0;
export const LMC_DEFAULT_LIGHT_BIT = 8;

/** The galvo coordinate range: 0..0xFFFF across the lens field, centre 0x8000
 *  (controller.py L717, L1153; driver.py goes home to 0x8000, 0x8000). */
export const LMC_GALVO_MAX = 0xffff;
export const LMC_GALVO_CENTRE = 0x8000;

const LIST_NAMES: Readonly<Record<number, string>> = {
  [LIST_JUMP_TO]: 'JumpTo',
  [LIST_END_OF_LIST]: 'EndOfList',
  [LIST_LASER_ON_POINT]: 'LaserOnPoint',
  [LIST_DELAY_TIME]: 'DelayTime',
  [LIST_MARK_TO]: 'MarkTo',
  [LIST_JUMP_SPEED]: 'JumpSpeed',
  [LIST_LASER_ON_DELAY]: 'LaserOnDelay',
  [LIST_LASER_OFF_DELAY]: 'LaserOffDelay',
  [LIST_MARK_FREQ]: 'MarkFreq',
  [LIST_MARK_POWER_RATIO]: 'MarkPowerRatio',
  [LIST_MARK_SPEED]: 'MarkSpeed',
  [LIST_JUMP_DELAY]: 'JumpDelay',
  [LIST_POLYGON_DELAY]: 'PolygonDelay',
  [LIST_WRITE_PORT]: 'WritePort',
  [LIST_MARK_CURRENT]: 'MarkCurrent',
  [LIST_QSWITCH_PERIOD]: 'QSwitchPeriod',
  [LIST_SET_CO2_FPK]: 'SetCo2FPK',
  [LIST_FIBER_YLPM_PULSE_WIDTH]: 'FiberYLPMPulseWidth',
  [LIST_READY_MARK]: 'ReadyMark',
};

/** The name of a list opcode, or `unknown-0x…` for one this build never writes. */
export function lmcListOpcodeName(opcode: number): string {
  return LIST_NAMES[opcode] ?? `unknown-0x${opcode.toString(16).padStart(4, '0')}`;
}
