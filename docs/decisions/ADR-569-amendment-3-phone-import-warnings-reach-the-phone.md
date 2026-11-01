## ADR-569 Amendment 3 - A phone-only job hears its import's warnings on the phone

Date: 2026-10-27

Status: Accepted; software-verified through browser tests of the built phone app. Not tested on a
real phone or machine.

### Context

ADR-569 and its amendments let a phone import art, Frame, open Job Review and Start without
touching the PC. Rolling audit v5 J3-P2-3 (P1) found that the one warning such a workflow needs
before Frame, that the import was scaled to fit the bed or read with an assumed unit, reached only
a short PC toast. The phone said "Imported.".

### Decision

The phone's Import sheet shows the import receipt's bed fit and notices, and a bed fit must be
kept or restored before the sheet closes ([ADR-125 Amendment 3](ADR-125-amendment-3-phone-import-sheet-shows-the-fit.md)).
This is disclosure at import time. It is not a Frame or Start gate: a completed Frame for the
unchanged footprint and placement stays the sole ordinary Start policy gate (ADR-565), and policy
findings stay warnings.

### Consequences

The phone-only workflow carries the same import warnings as the desktop, on the screen its
operator is using. It needs the relay Worker redeploy named in ADR-125 Amendment 3.
