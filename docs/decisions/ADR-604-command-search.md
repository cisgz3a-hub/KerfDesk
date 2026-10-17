## ADR-604 - Command search (Ctrl+K)

**Status:** Accepted.

## Context

The application menus hold close to two hundred commands across seven families; Tools alone needs a scrolling menu. An operator who knows what they want ("make a box", "offset", "rotary") still has to guess which menu holds it and read down the list. ADR-348 made Undo / Redo visible for the same reason: a capability hidden behind a menu path or a keyboard fact is one a pointer-first operator cannot discover.

## Decision

A command search window lists every registered command and runs the chosen one. It opens three ways: **Ctrl+K** (Cmd+K on macOS), **Help → Find a command…**, and a standing **Search** button beside Undo / Redo in the menu bar. On narrow windows the button keeps its icon and drops its text.

- **One source.** The window renders `buildAppCommands` output, after the machine-kind gate (ADR-101) and the edition gate (ADR-540). A result runs `runCommand`, the same path a menu item takes. Search cannot offer a command that the menus hide, cannot bypass a command's enablement, and cannot open a Pro tool without the existing licence prompt.
- **Matching.** Each command is matched on its menu label, its menu name and its registered help tooltip (`COMMAND_HELP`). Matching ignores case, accents, punctuation and the spaces inside a label, and every typed word must match. A word that starts a label word ranks highest, then a word inside the label, the menu name, and tooltip words. Letters typed in order ("bxgen") are a last resort. Ties keep menu order.
- **Disabled commands stay visible** with their `disabledReason`, ranked just below an equally good enabled match. Enter and click do nothing on them. Finding out why a command is unavailable is part of finding it.
- **Keyboard.** Up/Down move through the results and wrap at the ends, PageUp/PageDown jump eight rows, Enter runs, and Escape closes through the shared dialog shell. The input is an ARIA combobox that owns a listbox and points `aria-activedescendant` at the active option. The window closes before the command runs, so a command that opens its own dialog takes focus normally.
- **Shortcut scope.** Like Ctrl+, (ADR-499), Ctrl+K types nothing, so it also works from a text field. It is not consulted while a modal or on-canvas text session owns the keyboard. It calls `preventDefault` so the browser does not focus its own search box.

## Consequences

New commands become searchable as soon as they are registered with a help tooltip; no separate index is kept. Tutorials, settings and objects in the drawing are not searched in this first version.

No job output, Frame permission, controller behaviour or licence gate changes.

## Verification

Unit tests cover ranking, word matching, punctuation and space folding, in-order letters, tooltip matches, disabled ordering, and expected first results against the real registry. Component tests cover focus on open, Enter and click running only enabled commands, closing before running, wrapping arrow navigation, `aria-activedescendant`, the disabled reason, the no-match message, the store-driven host, Escape, and Ctrl+K / Cmd+K. The application-menu audit now accounts for **Help → Find a command…**.
