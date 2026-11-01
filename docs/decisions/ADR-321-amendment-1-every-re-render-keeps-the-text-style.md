## ADR-321 Amendment 1 - Every re-render keeps the text's style, text box and weld, and all new text welds (2026-10-28)

**Status:** Accepted; software-verified through tests that compare remote and jig re-renders with
the text editor's own render on bundled fonts. Not tested on a machine. | **Date:** 2026-10-28

Extends Decision 1 ("New editor sessions enable it") and Decision 3 ("The same final step runs when
variable content is evaluated for output") to remote text and the registration-jig text editor.
Follows rolling audit v7 findings L3-P2-2 and L3-P2-4 (P2) and L3-P3-3 (P3), which an independent
refuter and the coordinator confirmed in main's code. Changes nothing in Frame, Start or output
policy.

### Context

The text editor and variable output lay text out with everything the text says it has: its style
(Bold, Italic, Upper case, Max width, right-to-left, an undistorted bend), its text box, and Weld
overlaps. Two other writers did not, yet kept those settings on the text:

- Remote `update_text` rendered without the text box, so a 40 × 40 mm wrapped box became one
  87.6 mm line.
- The jig text editor rendered the raw wording: Max width 30 burned 40.45 mm wide, Upper case went
  back to lower case, the box unwrapped, and Pacifico "Hello" with Weld overlaps went from 7 to 10
  contours, so a Line layer would cut through the letters.

New remote text was also created with Weld overlaps off, while new desktop text has it on.

### Decision

1. **One re-render.** `renderStyledText` (`src/ui/text/render-styled-text.ts`) lays out new wording
   with the text's style, its text box (laid out in its frame, never bent) and its weld, as the
   text editor does. Remote `update_text` and the jig text editor use it. Path and variable text
   stay with the main editor, as before.
2. **New text welds, wherever it is made.** New remote `add_text` and new jig text have Weld
   overlaps on, as a new editor session has. The single-line font route still bypasses welding.

### Consequences

- A remote edit of a text box re-wraps inside its frame, and a jig edit keeps Max width, Bold,
  Upper case, Weld overlaps and the text box. The settings the main editor shows are the ones the
  burn uses.
- Script fonts made remotely or in the jig editor cut their joins welded on Line layers.
