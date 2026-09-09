# Serial characterization preservation, 2026-09-06

This test-only publication reconciles the historical FluidNC receive and host-session
characterization donors against main `00abb56e151332a85d9f9673ed6a5e0fae3faaef`.
The production Web Serial read loop, decoder, controller parser, acknowledgement ownership,
connection lifecycle and Frame/Start policy are unchanged.

## Published coverage

The corrected RX-01 through RX-12 cases exercise the production read loop through a mock
raw-byte reader: coalesced and bytewise records, CRLF, split and malformed UTF-8, stream end,
the existing decoded-length boundary, and valid records after an actual newline. They make
no claim about every split of an oversized record or a real Chromium serial device.

The existing replacement-connection test now invokes callbacks captured before unsubscribe.
This exercises queued stale line and close deliveries against the actual ownership guards,
including the replacement log, transcript, status, acknowledgement count and operation state.
It retains the ordinary unsubscribed-delivery assertions as well. The guards themselves
already shipped in [PR139](https://github.com/cisgz3a-hub/KerfDesk/pull/139) and
[PR200](https://github.com/cisgz3a-hub/KerfDesk/pull/200).

## Withdrawn and pending evidence

The original RX-13 expectation was **withdrawn**. It expected an oversized unterminated
record's later `ok` suffix to become an acknowledgement, despite there being no intervening
newline. That expectation is excluded from the published passing suite.

The separate B-19 reproducer remains an **open, unimplemented receive-framing defect**.
For the exact current source, these schedules contain identical concatenated text:

```ts
const oversized = 'A'.repeat(65_537);
const first = extractSerialLines('', oversized);
const split = extractSerialLines(first.buffer, 'ok\n');
const coalesced = extractSerialLines('', oversized + 'ok\n');
```

The split schedule emits `['ok']`, while the coalesced schedule emits no record. Dropping the
buffer forgets that the next chunk still belongs to the oversized record. The desired B-19
assertion that the split schedule emits no acknowledgement therefore remains intentionally
red; it is not installed as a passing or skipped product regression by this publication.

A later transport fix needs discard-through-newline state and a regression through the real
read-loop route. It must preserve the decoded-length boundary, CRLF handling, following valid
records and end/close ownership. This note records the defect and the required boundary;
it does not adopt a new transport implementation or claim browser/controller qualification.

## Original paths and preservation

| Donor and original path | Disposition |
| --- | --- |
| `fix-fluidnc-rx-characterization` at `e5880c0842e2f682e77331b101e93bafd5419acf`: `src/platform/web/web-serial-rx-framing.test.ts` | RX-01–12 ported; RX-13 explicitly withdrawn and excluded |
| `fix-fluidnc-lifecycle-characterization` at `43945b0113ac3fe1fb408bdc321ba72fefd51f2a`: `src/ui/state/laser-connection-actions.lifecycle.test.ts` | Surviving state-invariant intent incorporated into the existing test with captured queued callbacks |
| Same lifecycle donor: `src/platform/web/web-serial-rx-framing.test.ts` | B-19 preserved as the open defect and reproducer above; no false passing assertion |
| Both donors: `AGENTS.md` and `CLAUDE.md` | Instruction proposals already accounted for by PR753; no duplicate instruction edit |

All seven original dirty files, both indexes, HEADs, branches and status entries remain
preserved. Exact raw copies and before/after SHA-256 receipts are retained in the external
commit/PR monitor evidence. Historical July test counts are not current validation.
