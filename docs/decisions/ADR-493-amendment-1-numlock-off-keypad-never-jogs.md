## ADR-493 Amendment 1 - A NumLock-off keypad never jogs, Z included (2026-10-22)

**Status:** Accepted by the maintainer's request to fix the confirmed controller audit findings.
**Date:** 2026-10-22.

The controller audit v2 (`docs/audits/2026-10-22-controller-v2/C8-ctl-machine-ui.md`, C8-P2-1,
confirmed by an independent refuter) found that decision 6 rested on a wrong claim. It says that
"with Num Lock off the keypad sends arrow keys". That holds for 8, 4, 6 and 2 only. The W3C UI
Events code values (`https://www.w3.org/TR/uievents-code/`) print `Numpad7` as "7 Home",
`Numpad9` as "9 PgUp", `Numpad1` as "1 End" and `Numpad3` as "3 PgDn". With Num Lock off those
keys send `Home`, `PageUp`, `End` and `PageDown`, keep their `Numpad` code, and report
`DOM_KEY_LOCATION_NUMPAD` (`https://www.w3.org/TR/uievents/`).

The Z focus jog (ADR-362) read `PageUp` and `PageDown` by `event.key` alone. So with Num Lock
off, keypad 9 and 3 jogged Z, while with Num Lock on the same keys jog XY diagonally, and the jog
pad's tooltip names "Numpad 3" for +X -Y. On a CNC, Num Lock-off keypad 3 sent the bit down one
focus step (1 mm by default, 5 mm at most) at `min(maxFeed, 600)` mm/min instead of moving
+X -Y: the refuter reproduced `{ dz: -1, feed: 600 }` through the real `JogPad`. Keypad 7 and 1
sent `Home` and `End`, which nothing binds to a jog. LightBurn's Move window, which decision 6
copies, jogs from the keypad only with Num Lock on and has no Page-key Z jog.

### Decision

- Decision 6 now reads: with Num Lock off the keypad sends arrow keys (8, 4, 6, 2) or navigation
  keys (7 Home, 9 PageUp, 1 End, 3 PageDown), and **no NumLock-off keypad key moves the machine**,
  on any axis. One physical key never jogs a different axis depending on the Num Lock state.
- Only the dedicated `PageUp` and `PageDown` keys jog Z. `isNumpadKey`
  (`src/ui/laser/jog-keyboard-map.ts`) treats a key as the keypad's when its `code` starts with
  `Numpad` or its `location` is `DOM_KEY_LOCATION_NUMPAD`. Either is enough, so a browser that
  reports only one still cannot jog Z from the keypad. The Z jog ignores such a key and leaves
  it unhandled, so the browser's own Page-key behaviour stays.
- The NumLock-on keypad digits, the bracket chords and the dedicated Page keys are unchanged, and
  so is the step, feed and jog action each one sends.

### Evidence and limits

`use-jog-shortcuts.test.ts` pins NumLock-off keypad 7, 9, 1 and 3 (and 8 and 4) as moving
neither XY nor Z and leaving the key unhandled. It covers a keypad Page key named only by its
`code` or only by its `location`, and keeps the dedicated `PageDown` jogging Z.
`JogPad.keyboard-jog.test.tsx` repeats the audit's reproduction through the real pad in CNC mode:
NumLock-off 9, 3, 1 and 7 send no jog, the dedicated `PageDown` still sends `{ dz: -1, feed: 600 }`,
and NumLock-on keypad 3 still sends what its +X -Y arrow sends. With the keypad check removed,
the new keypad Page-key cases fail in both files. Not captured on a real keyboard or on Windows, which
the audit notes may also turn Shift+keypad 3 with Num Lock on into a `PageDown` from the keypad; the
same check covers that if it does. No machine was operated.
