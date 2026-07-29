/**
 * Literal firmware-side expectations derived from pinned FluidNC v4.0.3 source.
 * These do not model CurveDesk preparation, text encoding, acknowledgement
 * ownership, configured asynchronous effects, or physical behavior.
 *
 * Pinned source: bdring/FluidNC commit
 * 25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f in UartChannel.cpp,
 * Channel.cpp, lineedit.cpp, UTF8.cpp, RealtimeCmd.*, and ProcessSettings.cpp.
 */
export const FLUIDNC_V403_DIRECT_CHANNEL_FIXTURES = [
  directFixture('LF completes one payload record', [[0x47, 0x31, 0x0a]], {
    completedRecords: [nonemptyRecord([0x47, 0x31])],
  }),
  directFixture('CR completes one payload record', [[0x47, 0x31, 0x0d]], {
    completedRecords: [nonemptyRecord([0x47, 0x31])],
  }),
  directFixture(
    'CRLF completes a payload then an empty synchronization record',
    [[0x47, 0x31, 0x0d, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x31]), emptyRecord()],
    },
  ),
  directFixture('an empty completed record bypasses the content parser', [[0x0a]], {
    completedRecords: [emptyRecord()],
  }),
  directFixture(
    'a high-byte safety-door command is removed without separating ordinary bytes',
    [[0x47, 0x31, 0x84, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x31, 0x58])],
      realtimeCommands: [{ command: 0x84, dispatch: 'safety-door-event' }],
    },
  ),
  directFixture(
    'routed realtime bytes retain their command and handler identity outside the ordinary line',
    [[0x47, 0x80, 0x85, 0x87, 0x90, 0x9e, 0xa0, 0xa1, 0xb2, 0xb3, 0xb4, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x58])],
      realtimeCommands: [
        { command: 0x80, dispatch: 'undefined-no-op' },
        { command: 0x85, dispatch: 'motion-cancel-event-if-jogging' },
        { command: 0x87, dispatch: 'macro-0-event' },
        { command: 0x90, dispatch: 'feed-override-reset-event' },
        { command: 0x9e, dispatch: 'spindle-override-stop-event' },
        { command: 0xa0, dispatch: 'coolant-flood-toggle-event' },
        { command: 0xa1, dispatch: 'coolant-mist-toggle-event' },
        { command: 0xb2, dispatch: 'pin-ack-channel-control' },
        { command: 0xb3, dispatch: 'pin-nak-channel-control' },
        { command: 0xb4, dispatch: 'pin-reset-channel-control' },
      ],
    },
  ),
  directFixture(
    'decoded pin commands retain low and high channel-event identity',
    [[0x47, 0xc4, 0x80, 0xc4, 0xbf, 0xc5, 0xbe, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x58])],
      realtimeCommands: [
        { command: 0x100, dispatch: 'pin-low-channel-event' },
        { command: 0x13f, dispatch: 'status-report-direct' },
        { command: 0x17e, dispatch: 'pin-high-channel-event' },
      ],
    },
  ),
  directFixture(
    'non-reset ASCII realtime controls retain identity outside the ordinary line',
    [[0x47, 0x3f, 0x7e, 0x21, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x58])],
      realtimeCommands: [
        { command: 0x3f, dispatch: 'status-report-direct' },
        { command: 0x7e, dispatch: 'cycle-start-event' },
        { command: 0x21, dispatch: 'feed-hold-event' },
      ],
    },
  ),
  directFixture(
    'Ctrl-X asserts reset dispatch identity without a post-reset transcript',
    [[0x18]],
    {
      realtimeCommands: [{ command: 0x18, dispatch: 'reset-event' }],
    },
  ),
  directFixture(
    'an invalid high byte is removed without creating a realtime event',
    [[0x47, 0x31, 0xff, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x31, 0x58])],
    },
  ),
  directFixture(
    'BE passes through the decoder while BF and F8 are removed without dispatch',
    [[0x47, 0xbe, 0xbf, 0xf8, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x58])],
      realtimeCommands: [{ command: 0xbe, dispatch: 'undefined-no-op' }],
    },
  ),
  directFixture(
    '0x7F remains ordinary data in fresh non-editing streaming mode',
    [[0x47, 0x7f, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x7f, 0x58])],
    },
  ),
  directFixture(
    '0x7F deletes the preceding byte only in explicitly interactive editing mode',
    [[0x47, 0x7f, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x58])],
      isEditing: true,
    },
    true,
  ),
  directFixture(
    'Ctrl-L leaves interactive editing before a following 0x7F arrives',
    [[0x0c, 0x47, 0x7f, 0x58, 0x0a]],
    {
      completedRecords: [nonemptyRecord([0x47, 0x7f, 0x58])],
    },
    true,
  ),
  directFixture(
    'fragmented C2 A0 dispatches A0 without entering the ordinary line',
    [
      [0x47, 0xc2],
      [0xa0, 0x58, 0x0a],
    ],
    {
      completedRecords: [nonemptyRecord([0x47, 0x58])],
      realtimeCommands: [{ command: 0xa0, dispatch: 'coolant-flood-toggle-event' }],
    },
  ),
] as const;

type DirectFixtureDispatch =
  | 'reset-event'
  | 'status-report-direct'
  | 'cycle-start-event'
  | 'feed-hold-event'
  | 'safety-door-event'
  | 'motion-cancel-event-if-jogging'
  | 'debug-event'
  | 'macro-0-event'
  | 'macro-1-event'
  | 'macro-2-event'
  | 'macro-3-event'
  | 'feed-override-reset-event'
  | 'feed-override-coarse-plus-event'
  | 'feed-override-coarse-minus-event'
  | 'feed-override-fine-plus-event'
  | 'feed-override-fine-minus-event'
  | 'rapid-override-reset-event'
  | 'rapid-override-medium-event'
  | 'rapid-override-low-event'
  | 'rapid-override-extra-low-event'
  | 'spindle-override-reset-event'
  | 'spindle-override-coarse-plus-event'
  | 'spindle-override-coarse-minus-event'
  | 'spindle-override-fine-plus-event'
  | 'spindle-override-fine-minus-event'
  | 'spindle-override-stop-event'
  | 'coolant-flood-toggle-event'
  | 'coolant-mist-toggle-event'
  | 'pin-ack-channel-control'
  | 'pin-nak-channel-control'
  | 'pin-reset-channel-control'
  | 'pin-low-channel-event'
  | 'pin-high-channel-event'
  | 'undefined-no-op';

type DirectFixtureResult = {
  readonly completedRecords?: ReadonlyArray<{
    readonly lineBytes: ReadonlyArray<number>;
    readonly completion: 'nonempty-poll-ready' | 'empty-poll-ready';
  }>;
  readonly realtimeCommands?: ReadonlyArray<{
    readonly command: number;
    readonly dispatch: DirectFixtureDispatch;
  }>;
  readonly pendingLineBytes?: ReadonlyArray<number>;
  readonly isEditing?: boolean;
};

function directFixture(
  name: string,
  inputChunks: ReadonlyArray<ReadonlyArray<number>>,
  expected: DirectFixtureResult,
  isEditing = false,
) {
  return {
    name,
    inputChunks,
    isEditing,
    expected: {
      completedRecords: expected.completedRecords ?? [],
      realtimeCommands: expected.realtimeCommands ?? [],
      pendingLineBytes: expected.pendingLineBytes ?? [],
      isEditing: expected.isEditing ?? false,
    },
  };
}

function nonemptyRecord(lineBytes: ReadonlyArray<number>) {
  return { lineBytes, completion: 'nonempty-poll-ready' as const };
}

function emptyRecord() {
  return { lineBytes: [], completion: 'empty-poll-ready' as const };
}
