## ADR-611 Amendment 1 - The connection bar reads "Not responding" when a controller goes quiet (2026-10-18)

**Status:** Accepted by the maintainer's request to audit and upgrade the controller fixes. **Date:** 2026-10-18.

**Amended by [ADR-610 Amendment 2](ADR-610-amendment-2-unidentified-firmware-and-owed-replies.md):**
a line still owed its reply excuses the silence only for as long as the Home
button would wait for a homing reply, because a reply lost on the link leaves
the line owed for the rest of the session.

ADR-611 kept controller information out of the way and left one pop-up: a
failed settings read on a controller that has stopped answering. An audit found
the opposite gap. A controller that answered normally, passed qualification,
and then went quiet (a hung board, a USB adapter that stopped passing data)
still read "Connected" with a green dot, because nothing re-read its settings.
Other senders show such a link as stalled.

### Decision

- While connected, the status line reads **Not responding**, with an amber dot
  and amber text, once a controller that answered status queries in this
  session has sent no status reply for the existing 8 s window
  (`controllerWentSilent`). Alarm and Sleep replies count as answers.
- The 8 s count only time the status poll ran on schedule (ADR-356
  Amendment 1): a hidden, throttled or sleeping page asked nothing, so the
  label waits for 8 s of on-schedule polling after the page resumes.
- The connection bar re-reads the rule on every store write and on its own
  1 s timer. A status write stuck in a wedged transport stops the poll from
  writing to the store, which is the case this label exists for.
- Any line the controller sends counts as an answer, not only a status
  report: the `ok` that ends a Console `$H` restarts the window before the
  next status reply arrives.
- It does not apply while a sent line is still owed its reply. GRBL answers
  neither `?` nor a Console `$H` until homing ends, and a Console `$H` owns
  no controller operation.
- It does not apply before the session's first reply (connect-time silence
  keeps its own report), while a controller operation runs (GRBL may leave `?`
  unanswered while it homes), or to a queued-poll controller (Marlin is not
  polled while a job streams).
- It is a status, not a pop-up. It clears with the next reply. Disconnect and
  Reconnect stay where they are; nothing is reset or refused.

### Evidence and limits

`controller-recovery-status.test.ts` pins the rule and its exclusions, and
`ConnectionBar.compact.test.tsx` pins the label and its clearing. The idle
status poll writes every second, so the store re-reads the rule without a
timer of its own. Unit-tested only; no machine was operated.
