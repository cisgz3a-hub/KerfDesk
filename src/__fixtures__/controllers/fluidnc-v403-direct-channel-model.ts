import {
  fluidncV403RealtimeDispatch,
  isFluidncV403RealtimeByte,
  type FluidncV403RealtimeDispatch,
} from './fluidnc-v403-realtime-dispatch';

const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const BACKSPACE = 0x08;
const DELETE = 0x7f;
const FORM_FEED = 0x0c;
const ASCII_CONTROL_CEILING = 0x20;
const INVALID_UTF8_START = 0xf8;
const UTF8_CONTINUATION_MASK = 0xc0;
const UTF8_CONTINUATION_TAG = 0x80;
const UTF8_PAYLOAD_MASK = 0x3f;
const UTF8_VALUE_SHIFT_BITS = 6;
const UTF8_FOUR_BYTE_START = 0xf0;
const UTF8_FOUR_BYTE_PAYLOAD_MASK = 0x07;
const UTF8_FOUR_BYTE_CONTINUATIONS = 3;
const UTF8_THREE_BYTE_START = 0xe0;
const UTF8_THREE_BYTE_PAYLOAD_MASK = 0x0f;
const UTF8_THREE_BYTE_CONTINUATIONS = 2;
const UTF8_TWO_BYTE_START = 0xc0;
const UTF8_TWO_BYTE_PAYLOAD_MASK = 0x1f;
const UTF8_TWO_BYTE_CONTINUATIONS = 1;
const RAW_REALTIME_PASSTHROUGH_CEILING = 0xbf;
const LINEEDIT_RETAINED_BYTES = 254;

type DirectChannelOptions = {
  readonly isEditing?: boolean;
};

type CompletedRecord = {
  readonly lineBytes: ReadonlyArray<number>;
  readonly completion: 'nonempty-poll-ready' | 'empty-poll-ready';
};

type RealtimeCommand = {
  readonly command: number;
  readonly dispatch: FluidncV403RealtimeDispatch;
};

type DirectChannelResult = {
  readonly completedRecords: ReadonlyArray<CompletedRecord>;
  readonly realtimeCommands: ReadonlyArray<RealtimeCommand>;
  readonly pendingLineBytes: ReadonlyArray<number>;
  readonly isEditing: boolean;
};

type MutableDirectChannel = {
  lineBytes: Array<number>;
  completedRecords: Array<CompletedRecord>;
  realtimeCommands: Array<RealtimeCommand>;
  isEditing: boolean;
  utf8Remaining: number;
  utf8Value: number;
};

/**
 * Executes a bounded firmware-side model of pinned FluidNC v4.0.3's direct
 * UartChannel, Lineedit, realtime interception, and UTF-8 decoder seams.
 * It intentionally does not model CurveDesk host encoding or acknowledgement.
 * @throws RangeError for editor controls outside the explicitly bounded model.
 */
export function simulateFluidncV403DirectChannel(
  inputChunks: ReadonlyArray<ReadonlyArray<number>>,
  options: DirectChannelOptions = {},
): DirectChannelResult {
  const state: MutableDirectChannel = {
    lineBytes: [],
    completedRecords: [],
    realtimeCommands: [],
    isEditing: options.isEditing ?? false,
    utf8Remaining: 0,
    utf8Value: 0,
  };
  for (const chunk of inputChunks) {
    for (const byte of chunk) processDirectByte(state, byte);
  }
  return {
    completedRecords: state.completedRecords,
    realtimeCommands: state.realtimeCommands,
    pendingLineBytes: state.lineBytes,
    isEditing: state.isEditing,
  };
}

/**
 * Models only pinned FluidNC v4.0.3 base Channel CR/LF record splitting.
 * This separate transport path coalesces CRLF and is not direct Lineedit.
 */
export function simulateFluidncV403BaseChannelRecords(
  input: ReadonlyArray<number>,
): ReadonlyArray<ReadonlyArray<number>> {
  const completed: Array<ReadonlyArray<number>> = [];
  const line: Array<number> = [];
  let isLastCarriageReturn = false;
  for (const byte of input) {
    if (byte === LINE_FEED) {
      if (isLastCarriageReturn) {
        isLastCarriageReturn = false;
        continue;
      }
      completed.push([...line]);
      line.length = 0;
      continue;
    }
    isLastCarriageReturn = byte === CARRIAGE_RETURN;
    if (isLastCarriageReturn) {
      completed.push([...line]);
      line.length = 0;
      continue;
    }
    if (line.length < LINEEDIT_RETAINED_BYTES) line.push(byte);
  }
  return completed;
}

function processDirectByte(state: MutableDirectChannel, byte: number): void {
  assertByte(byte);
  if (isFluidncV403RealtimeByte(byte)) {
    processRealtimeByte(state, byte);
    return;
  }
  assertSupportedLineeditByte(byte);
  processLineeditByte(state, byte);
}

function processRealtimeByte(state: MutableDirectChannel, byte: number): void {
  if (byte >= INVALID_UTF8_START) return;
  const command = decodeRealtimeByte(state, byte);
  if (command === null) return;
  state.realtimeCommands.push({ command, dispatch: fluidncV403RealtimeDispatch(command) });
}

function decodeRealtimeByte(state: MutableDirectChannel, byte: number): number | null {
  if (state.utf8Remaining > 0) {
    if ((byte & UTF8_CONTINUATION_MASK) !== UTF8_CONTINUATION_TAG) {
      state.utf8Remaining = 0;
      state.utf8Value = 0;
      return null;
    }
    state.utf8Remaining -= 1;
    state.utf8Value = (state.utf8Value << UTF8_VALUE_SHIFT_BITS) | (byte & UTF8_PAYLOAD_MASK);
    if (state.utf8Remaining > 0) return null;
    const decoded = state.utf8Value;
    state.utf8Value = 0;
    return decoded;
  }
  if (byte < RAW_REALTIME_PASSTHROUGH_CEILING) return byte;
  if (byte >= UTF8_FOUR_BYTE_START) {
    return beginUtf8Sequence(
      state,
      byte & UTF8_FOUR_BYTE_PAYLOAD_MASK,
      UTF8_FOUR_BYTE_CONTINUATIONS,
    );
  }
  if (byte >= UTF8_THREE_BYTE_START) {
    return beginUtf8Sequence(
      state,
      byte & UTF8_THREE_BYTE_PAYLOAD_MASK,
      UTF8_THREE_BYTE_CONTINUATIONS,
    );
  }
  if (byte >= UTF8_TWO_BYTE_START) {
    return beginUtf8Sequence(state, byte & UTF8_TWO_BYTE_PAYLOAD_MASK, UTF8_TWO_BYTE_CONTINUATIONS);
  }
  return null;
}

function beginUtf8Sequence(
  state: MutableDirectChannel,
  initialValue: number,
  remaining: number,
): null {
  state.utf8Value = initialValue;
  state.utf8Remaining = remaining;
  return null;
}

function processLineeditByte(state: MutableDirectChannel, byte: number): void {
  if (byte === FORM_FEED) {
    state.isEditing = false;
    return;
  }
  if (byte === CARRIAGE_RETURN || byte === LINE_FEED) {
    completeDirectRecord(state);
    return;
  }
  if (state.isEditing && (byte === DELETE || byte === BACKSPACE)) {
    state.lineBytes.pop();
    return;
  }
  if (!state.isEditing && byte < ASCII_CONTROL_CEILING) {
    state.isEditing = true;
    if (byte === BACKSPACE) state.lineBytes.pop();
    return;
  }
  if (byte >= ASCII_CONTROL_CEILING && state.lineBytes.length < LINEEDIT_RETAINED_BYTES) {
    state.lineBytes.push(byte);
  }
}

function completeDirectRecord(state: MutableDirectChannel): void {
  const lineBytes = [...state.lineBytes];
  state.completedRecords.push({
    lineBytes,
    completion: lineBytes.length > 0 ? 'nonempty-poll-ready' : 'empty-poll-ready',
  });
  state.lineBytes.length = 0;
}

function assertByte(byte: number): void {
  if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
    throw new RangeError(`Expected one byte, received ${String(byte)}.`);
  }
}

function assertSupportedLineeditByte(byte: number): void {
  const isSupportedControl =
    byte === BACKSPACE || byte === LINE_FEED || byte === FORM_FEED || byte === CARRIAGE_RETURN;
  if (byte < ASCII_CONTROL_CEILING && !isSupportedControl) {
    throw new RangeError(`Editor control 0x${byte.toString(16)} is outside this bounded model.`);
  }
}
