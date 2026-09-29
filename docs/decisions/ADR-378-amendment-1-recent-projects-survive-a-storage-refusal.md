## ADR-378 Amendment 1 - Recent Projects survive a storage refusal (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

ADR-378 item 1 keeps Recent Projects in this browser profile's IndexedDB and left open what
happens when IndexedDB refuses. The code switched to an empty in-memory list after the first
refusal and never tried IndexedDB again in that session. One transient refusal (a busy profile,
or a connection the browser closed after another window's version change) therefore emptied the
File menu's list for the rest of the session, and every project opened or saved afterwards was
lost on reload, with nothing on screen to say so. The IndexedDB layer also kept a closed
connection for good, so even a retry could not have recovered. The weakness audit of 2026-09-28
traced this.

### Decision

1. A refusal never turns persistence off by itself. The next Recent Projects operation tries
   IndexedDB again, with a new connection when the last one failed or the browser closed it.
2. While IndexedDB refuses, the list this window last read stays shown and keeps changing in
   memory, so an open or save is still listed.
3. Changes made meanwhile are replayed onto the stored list inside the first transaction that
   succeeds, so they reach IndexedDB and another window's changes to the stored list are kept.
4. After 3 refusals in a row, IndexedDB is left alone for the rest of the session, the list lasts
   until KerfDesk closes, and one warning says so: `Recent Projects could not be saved for next
   session (browser storage is full or blocked). The list is kept until KerfDesk closes.`
5. A host with no IndexedDB at all keeps the list for the session without a warning, as before.

### Consequences

- A transient refusal costs nothing the operator can see.
- A profile that keeps refusing is told once, instead of silently losing every new entry.
- If IndexedDB refused from the start of a session, a file opened during the refusal may be
  listed twice once storage works again: the identity check of item 1 ran against a list that
  could not be read. Removing one entry fixes the list; nothing is lost.
- Unit tests cover a refused open, a dropped connection with another window's change merged,
  the single warning, and the session list when storage keeps refusing.
