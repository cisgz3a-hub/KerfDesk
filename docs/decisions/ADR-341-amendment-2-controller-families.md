## ADR-341 Amendment 2 - Painted passes read GRBL-family programs, and refuse the rest by name (2026-09-22)

**Status:** Accepted. | **Date:** 2026-09-22

### Context

ADR-341 says the transformer must "reject source semantics the transformer cannot
reproduce rather than silently dropping commands". It does — but only per line, and
only once parsing reaches an unreadable word.

A completed job emitted for Marlin or Smoothieware is not a program with one
unsupported word in it; it is a different dialect from its first line. Marlin's
inline mode writes `M3 I S0`, its fan dialect drives power with `M106`/`M107`
instead of an S word on each move, and Smoothieware replaces the beam words with
`M400` plus `M221` percent overrides. The strict reader reported whichever word it
tripped on first — "Source line 1: Unsupported M106" — which names a symptom and
not the cause. Worse, the completion prompt and the Machine-panel entry were
offered for those runs, so the operator's only route to that message was to accept
an offer that could never succeed.

Separately, Amendment 1 made a laser-off feed move that leaves the current line end
its sweep. That left one case unstated: the *first* sweep, which no travel precedes.
Its entry style defaulted to a rapid, so a controlled-dark program whose archive
records a start position could be derived with a `G0` approach it never contained.

### Decision

1. **Classify the program by its native prelude before parsing it.** Marlin inline,
   Marlin fan and Smoothieware output is refused with a message naming the
   controller family and the families that are supported. Detection reads the
   prelude only, so a large program is not scanned twice, and it is positive
   evidence of a native dialect rather than the absence of GRBL words: a GRBL
   program carries `I` only as an arc offset on `G2`/`G3`, never on a beam word.
2. **Withhold the offer instead of leading to the refusal.** A completed run whose
   profile names an unsupported controller produces no darkening prompt and no
   Machine-panel entry. Where older completions remain, the panel says which
   families are supported and keeps the selector, so a supported job is still
   reachable. An older selection is checked when its archive opens, which is the
   only point where its program is known.
3. **Enter the first sweep with the source's own travel style.** When no travel
   precedes a sweep and the program's opening move is a controlled laser-off feed
   move, position with that move's feed rather than a rapid. A rapid-led program is
   unchanged.

### Consequences

- The supported scope is now stated once, in the refusal message, the operator
  workflow and this amendment, instead of being implied by a parse failure.
- Transforming native Marlin and Smoothieware output remains possible later; this
  amendment only stops the feature from claiming it today.
- Derived bytes change only for a controlled-dark program whose archive records a
  start position, and only in its approach move. Painted-pass archives predating
  Amendment 1 already no longer replay byte-exactly for the reasons recorded there.

### Alternatives rejected

- **Detect by the profile's `controllerKind` alone:** rejected for the parser. The
  archive's sealed *program* is what the transformer reads, and a profile edited
  after the run would misdescribe it. The profile is used only where no program is
  in hand yet — deciding whether to offer the prompt at all.
- **Let the per-line reader report the first unsupported word:** rejected. It names
  a symptom, and for the fan dialect the first difference is the *absence* of an S
  word, which no per-line rule can report at all.
- **Accept Marlin programs and approximate the unsupported commands:** rejected by
  ADR-341 §3 already. A pass that appears to succeed while dropping power commands
  is the outcome that decision exists to prevent.

### Verification

- `source-family.test.ts` classifies real fixtures for each family, keeps a GRBL
  program with an arc `I` offset and a dialect name in a comment classified as
  GRBL-family, and confirms the prelude bound.
- `canonical-output.test.ts` compiles genuine Marlin inline, Marlin fan and
  Smoothieware output through the real emitter and asserts the refusal names the
  controller and not a source line.
- `SecondPassHost.test.tsx` covers a completed Marlin run producing no prompt and no
  rail entry, and an older supported job staying reachable behind the selector.
- `build-program.test.ts` covers the first-sweep travel style in both directions.
- **NOT verified:** no physical machine ran any of this. Marlin and Smoothieware
  behaviour is asserted about emitted text only.
