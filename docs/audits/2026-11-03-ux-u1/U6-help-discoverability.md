# New-user experience audit U1 — U6 Help and discoverability

- **When:** 2026-11-03 **Tree:** origin/main @ `c93fbb3bc` (`git fetch origin main`; `git diff HEAD origin/main -- src public electron e2e index.html vite.config.ts package.json` is empty, so the app is the one U1–U4 audited).
- **Scope:** a beginner with no machine connected looks for help on ten real questions, using only what the app offers: tooltips, help links, the Help menu, Learn lessons and their search, Find a command (Ctrl+K), the Settings window, the Keyboard Shortcuts dialog and the kerfdesk.com pages the app links to. Also: every in-app help link, icon-only buttons without a tooltip, Learn lessons against the current UI, settings sprawl, and the shortcut list against the bindings in code. Code read: `src/ui/commands/` (command-search, CommandSearchDialog, help-command-family, support-command-family), `src/ui/tutorials/` (catalogue, search, all `*-tutorials.ts`), `src/ui/help/`, `src/ui/settings/`, `src/ui/common/shortcut-list.ts` and `Toolbar.tsx`, `src/ui/app/{shortcuts,editing-tool-shortcuts,view-shortcuts,use-shortcuts}.ts`, `src/ui/commands/arrange-shortcut-keys.ts`, `src/ui/laser/use-jog-shortcuts.ts`/`jog-keyboard-map.ts`. Governing: ADR-604 (command search), ADR-540 (Free/Pro), ADR-546 (support report), ADR-547 (updates).
- **How:** my own production web build of main (`git archive origin/main` into `zz-u6\tree`, `vite build` into `zz-u6\dist`), served with the repo's COOP/COEP/CSP headers on 127.0.0.1:4961 (`zz-u6-host.mjs`) and driven by Playwright in installed Chrome from a fresh context (`zz-u6-drive.mjs` on 4962, a copy of U3's driver). External pages were read only (HTTP status, and the live support and safety pages rendered once); nothing was downloaded. No hardware, no desktop app.
- **Counts:** 7 raised → P1 0 / P2 1 / P3 6 (+ 9 KNOWN re-observed). 5 of my own candidates refuted (see Refuted).
  - **After refuter (2026-11-03, origin/main @ `19faee6f1`):** P1 0 / **P2 0** / **P3 7** (+ 9 KNOWN, two of them partly fixed on main by #1554). Confirmed 6, refuted 0, severity changes 1 (U6-P2-1 → P3). The auditor's 5 refutations all stand.

`SHOTS` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u6\shots\`.

## Headline

The help that exists is good. The beginner just can't search their way to it.

What works:
- Every icon-only button has a hover tooltip (58 in the first two states, and none without one in six more).
- Every in-app link opens a live page (7 distinct URLs from 12 entry points). The support page names an email address and the Save Support Report file.
- Units, Line/Fill/Image, Bend and Path text, and origin placement are explained in plain words where they live.
- The Keyboard Shortcuts dialog matches the bindings in code, with one omission (F12).

What fails is **search**. The beginner's two search boxes miss the things they ask about most:
- **U6-P2-1.** Find a command (Ctrl+K) only searches menu commands. Frame, Start, Set origin here, Jog, Machine Setup, Material Library and Keyboard Shortcuts are panel buttons, so they can't be found. Its own placeholder suggests "frame", which returns Wireframe View, Import Image… and Focus Test…. "machine setup" returns Settings…, and "shortcuts", "set origin", "units" and "inches" return nothing.
- **U6-P3-1.** Learn's search filters by substring and doesn't rank. "origin" puts the origin lesson 7th of 12, after image and joint lessons. "fill" puts "Studio: Fillet" first. A laser user also gets CNC lessons.

The lessons also drift from the UI:
- **U6-P3-3.** Six lessons name a control by a word the screen doesn't use: "Optimization Settings" (the menu says Cut Planner…), "Apply to layer" (Apply to operation), "Apply Image Mask" (Apply Mask to Image), "Affects count" (Shared by N artworks), "Visible" (Show on canvas), and "Click Design on the left toolbar" (Design Studio is in the top toolbar).
- **U6-P3-4.** Sixteen lessons teach Pro tools with no Pro mark, including 10 of the 27 in Drawing & editing.

Of the ten questions, the app answers six directly in three steps or fewer: Q2, Q4, Q7, Q8, Q9 (via Learn) and Q10. Two it answers only by browsing: Q1 (units) and Q5 (origin). Two it answers only partly: Q3 (no starting values for plywood, KNOWN) and Q6 (cut last, KNOWN, plus a stale lesson).

**The single help improvement with the most beginner value** is to make one search answer everything. When Ctrl+K finds no command, or finds a weak one, it should also list:
- the matching Learn lessons, ranked by title;
- the named panel controls (Frame job, Set origin here, Machine Setup, Keyboard Shortcuts, Materials);
- the Settings entries (Units).

That one change fixes U6-P2-1, U6-P3-1 and U6-P3-2, and the KNOWN U1-P3-4. ADR-604 already lists tutorials and settings as left out "in this first version".

## Beginner journey

The table records each attempt in the order a beginner would make it: Ctrl+K, then Learn, then menus and panels. "Steps" counts the searches, clicks and menus opened until the answer is on screen. The full search outputs are in `zz-u6-search.out.json` and `zz-u6-learnfull` (re-runnable).

| # | Question | Where I looked (in order) | Steps | Found | Answer right for main |
|---|---|---|---|---|---|
| 1 | Change mm to inches | Ctrl+K "mm to inches", "inches", "units", "imperial" → "No command matches" (`10-q1-cmd-inches.png`). "inch" gives only "Constrained sketch…". Learn "inches"/"units" → "0 tutorials found" (`11-q1-learn-inches.png`). Edit menu → Settings… (its tooltip lists theme, layout, snapping… not units) → General → **Units** (`40-settings-general.png`) | 7 | Yes, by browsing | **Yes.** Inches changes the selection box, status bar and bed readout (`3.937 × 2.756 in`, `Bed: 15.748 × 15.748 in`, `46-units-inches.png`), as the Settings text says. KNOWN U1-P3-4 |
| 2 | Text on a curve; weld letters | Ctrl+K "text on a curve" → Export artwork as PDF…, Optimize Shapes…; "weld text" → no match. Learn "text on a curve" → **Bend text and follow a path** first (`17-q2-learn-curve.png`); "weld" → Weld, Type and edit text | 3 | Yes | **Yes.** The text panel has Bend, Path text (Guide, Path offset, Reverse) and "Weld overlaps · Join script letters" (`23-text-editor.png`). The lesson's "Text formatting" and "Size" are "Text" and "Font size" on screen (U6-P3-3). Path text is greyed with no reason until a path exists (U6-P3-6) |
| 3 | Power and speed for 3 mm plywood | Ctrl+K "plywood", "3mm plywood", "settings for wood", "cut wood" → no match; "power speed" → Material Test…. Learn "plywood" → 0 (`12-q3-learn-plywood.png`); "power speed" → Laser outlines and cuts, Compare laser settings on material. Artwork → **Materials** tab: "Create a library below, or open one from Saved Libraries." (`41-materials-tab.png`) | 5 | Partly | **Yes as far as it goes:** "Enter Power, Speed and Passes from a material test for your machine", and Tools → Material Test… exists. No starting numbers anywhere. KNOWN G-S05-3 / U3-P2-1 |
| 4 | Engrave a photo | Learn "engrave a photo" → **Engrave a photo or bitmap** first; "photo" → 2nd. Ctrl+K "photo" → Photo engraving… (disabled until an image is selected). After import the toolbar shows **Photo engraving** and the Image process with a dither picker described in words (`24-image-selected.png`) | 3 | Yes | **Yes, but** the lesson teaches only the raw Image settings and never mentions the Photo engraving window, the app's guided photo tool with material recipes (U6-P3-5) |
| 5 | Set where on the bed it burns (origin) | Ctrl+K "origin" → Save Original Image…, Re-trace Original…; "set origin" → no match; "where it burns" → Move Laser to Selection… (disabled). Learn "where it burns" → 0 (`18-q5-learn-where.png`); "origin" → **Place the job using an origin** 7th of 12 (`19-learn-origin-results.png`). Machine panel **Origin** / **Placement** (`43-origin-panel.png`, `44-placement-panel.png`) | 5 | Yes | **Yes.** The lesson's Start from, Absolute Coordinates, Current Position, User Origin, Verified Origin, Job origin, Set origin here, Selected artwork only and Advanced origin all exist (`l-origin-1..4.png`). "Home is off in Machine Setup … then set the origin" is shown in the panel |
| 6 | Cut out a shape (inside first, cut last) | Ctrl+K "cut last", "inside first" → no match; "cut order" → Cut Planner…. Learn "cut last" → Use keyboard shortcuts only (`13-q6-learn-cutlast.png`); "inside first" → **Plan the order of laser cuts** 3rd. Its step 1 says "Open Optimization Settings" (`l-cutorder-1.png`); the menu item is Cut Planner…, whose dialog has Inside paths first and Operation priority (`42-cut-planner.png`) | 5 | Partly | **Partly.** Inside-first: yes, under another name. Engrave first, cut last: no. "Sort cuts last" sits behind the operation list's "•••" and no search or lesson names it. KNOWN U3-P2-4; stale lesson U6-P3-3 |
| 7 | "Fill" vs "Line" | Hover Line / Fill / Image on the operation: a plain one-line explanation (U1 verified). Learn "fill" → Fill a shape with laser engraving 5th (after "Studio: Fillet"); "fill vs line", "engrave vs cut" → 0 | 1–2 | Yes | **Yes** |
| 8 | Update KerfDesk | Ctrl+K "update" → **Check for Updates…** first; Help → Check for Updates… → "Info: KerfDesk in the browser updates itself. When a new version is ready, an Update button appears in the status bar." (`30-check-updates-web.png`) | 2 | Yes | **Yes** for the web. The desktop wording is READ only (`update-status-text.ts:28-58`) |
| 9 | Keyboard shortcuts | Help menu: no entry (`02-help-menu.png`). Ctrl+K "shortcuts", "keyboard", "hotkeys", "keys" → no match (`15-q9-cmd-shortcuts.png`). Learn "shortcuts" → **Use keyboard shortcuts** → "Top toolbar → Keyboard Shortcuts" → the keyboard icon at the far right of the top toolbar (`16-q9-learn-shortcuts.png`, `21-shortcuts-dialog.png`) | 5 | Yes | **Yes.** Every listed key is bound in code. F12 is bound but not listed (U6-P3-2) |
| 10 | Get support / report a bug | Help → **Report a Problem** / **Get Help** → `https://kerfdesk.com/support.html#report` → 308 → `/support#report`, scrolled to "Reporting a problem" (`33-support-live.png`). Ctrl+K "support", "problem" find them; "report a bug", "contact" don't; "bug" → Distribute H/V Spacing (an in-order-letters match) | 2 | Yes | **Yes.** The page says email support@kerfdesk.com (the live page's Cloudflare-obfuscated address decodes to it in Chrome), and to attach Help → Save Support Report; both exist |

**Other checks**
- **Help links.** All 7 distinct in-app external URLs return 200 (12 entry points). The entry points are Report a Problem, Get Help, Pricing, Terms, Privacy and Refunds in the Help menu; Pricing, Terms, Privacy and Refunds in the status bar; the download page; and `kerfdesk.com/safety/`, named in the Safety alert. The URLs were recorded by intercepting the anchor click (`zz-u6-links.js`). Twelve of the 15 CNC-preset source links in Machine Setup return 200; 3 return 403 to a scripted request (Not verified).
- **Icon-only controls.** These are controls with at most two visible characters, checked in eight states: empty workspace, rectangle drawn, Preview, Learn library and a lesson, Settings, Keyboard Shortcuts, Machine Setup, the text editor, and an image selected. Every one has a `title` (`zz-u6-icons.js`, `zz-u6-icons2.js`: 0 without).
- **Settings sprawl.** It is moderate and signposted:
  - The Settings window has 4 tabs on the web: General, Canvas, Machine & materials and Labs (Phone & MCP is desktop only).
  - Its Machine & materials tab only links on: "Open Machine Setup…" and "Show Materials" (`48-settings-machine-tab.png`).
  - Machine setup itself is a 3-stage window.
  - Settings also live in Tools (Cut Planner…, Labs…), the Artwork panel (Materials tab), Help (Licence), the jog pad (Step, Speed) and the toolbar (Auto layout, which repeats Settings → Workspace layout).
  - There is no search inside Settings. ADR-604 Consequences keeps settings out of Ctrl+K "in this first version".
- **Shortcut list against the code.** Every row of `shortcut-list.ts` has a binding:
  - `shortcuts.ts` (File, Edit, Tools);
  - `editing-tool-shortcuts.ts`: rotate, Ctrl+Shift+H/V flip, Ctrl+Shift+I, Alt+V, Alt+W, Alt+D;
  - `view-shortcuts.ts`, `arrange-shortcut-keys.ts`, `use-job-shortcuts.ts` and `jog-keyboard-map.ts`.

  Bound but missing from the dialog:
  - **F12** (toggle side panels; `view-shortcuts.ts:79`, also labelled in Window → Toggle Side Panels);
  - the Ctrl+Shift+G alias for Ungroup (harmless);
  - the Alt peek (KNOWN U3-P3-3).

## Findings

### U6-P2-1 — Find a command can't find Frame, Set origin, Machine Setup, Jog, Materials or Keyboard Shortcuts, and its own example "frame" returns Wireframe View

- **Where:**
  - `src/ui/commands/CommandSearchDialog.tsx:84`: `placeholder="Type what you want to do, such as box, offset or frame"`.
  - `src/ui/commands/command-search.ts:24`: the comment says `"setorigin" finds "Set origin"`, but no command has that label. "Set origin here" is a panel button (`src/ui/laser/OriginRow.tsx:80`).
  - The search covers only registered menu commands (ADR-604 Decision, "One source"). Frame job, Start, Set origin here, the jog pad, Machine Setup (the rail button, `help-topics.ts` `laser.machine-setup.launch`), the Materials tab and Keyboard Shortcuts (`src/ui/common/Toolbar.tsx:41`) are not commands.
  - The Laser menu, whose tooltip says "Machine menu for connection and controller setup actions" (`src/ui/help/help-topics.ts:150`), holds only Connect, Disconnect and Home. There is no Machine Setup item.
- **What a beginner sees:** Search → typed the placeholder's own example, **frame** → "Wireframe View — Draw Fill artwork as outlines…", "Import Image…", "Focus Test…", "Dock Left…" (`25-cmd-frame.png`, `26-cmd-placeholder.png`). Further results:

  | Typed | Results |
  |---|---|
  | set origin | "No command matches "set origin". Try another word, or browse Help → Visual tutorials." |
  | machine setup | Settings… |
  | jog | Resize Joint Openings… |
  | start | Open template…, Delete Duplicates, Settings… |
  | material library | AI Assistant… |
  | keyboard shortcuts, shortcuts, units, inches | no match |
- **Why it misleads:** Ctrl+K is offered three ways: Help → Find a command…, a standing **Search** box beside Undo/Redo, and Ctrl+K. It is the app's main "where is it?" tool, and its placeholder teaches the beginner to type an action. The actions a beginner needs first (frame, set the origin, set up the machine, find the shortcuts) all miss. The top result for "frame" is a different feature with a similar name, and Enter runs it.
- **Workaround:** the controls are visible on the machine panel and toolbar once you know what they look like. Learn finds most of them, slowly (U6-P3-1). Hence P2, not P1.
- **Accepted part:** ADR-604 Consequences: "Tutorials, settings and objects in the drawing are not searched in this first version." So Units (U1-P3-4) and lessons missing from the results are accepted for now. The panel actions and the placeholder are not covered by that sentence.
- **Evidence:** REPRO (`zz-u6-search.js` with the question list, and the "m" list in the report's run; output above), plus READ for the lines cited.
- **Fix direction:**
  1. Register the panel actions as searchable entries that focus or open their control. These are Frame job, Start, Set origin here, Home, Jog (focus the pad), Machine Setup…, Materials, and Keyboard Shortcuts…. Disabled ones keep their reason, for example "Connect to the machine first."
  2. Add **Machine Setup…** and **Keyboard Shortcuts…** to the Laser and Help menus.
  3. On no match or a weak match, show "Lessons:" with the top Learn hits and "Settings:" entries (Units → Settings → General).
  4. Make the placeholder name examples that work, or keep "frame" once it finds Frame job.
  5. Add a registry test that "frame", "set origin", "machine setup", "shortcuts" and "units" each return the intended first result.

**Refuter (2026-11-03):** SEVERITY CHANGE → **P3** because the search does what ADR-604 decided, nothing it returns leads a beginner into a wrong action, and the placeholder is a wording fault.
- **Re-checked on main `19faee6f1`.** The placeholder is unchanged (`CommandSearchDialog.tsx:84`) and has been there since the feature landed (`91d0d6043`). No registered command has "Frame" in its label (`git grep` over `src/ui/commands`). The Laser family is still only Connect, Disconnect and Home (`laser-command-family.ts:10-43`). The `"setorigin"` comment is still at `command-search.ts:24`.
- **Reproduced** with a focused Vitest over the real registry (`buildAppCommands(baseCtx())`, 194 commands; `zz-u6r\zz-u6r-search.test.ts`, output in `zz-u6r\zz-u6r-search.out.json`). To re-run it: `git archive origin/main` into a tree, junction `node_modules`, copy the test into `src\`, then `vitest run src/zz-u6r-search.test.ts --maxWorkers=1`. Results:
  - "frame" → Wireframe View, Import Image…, Focus Test….
  - "set origin", "shortcuts", "keyboard shortcuts", "hotkeys", "cut last", "lesson", "report a bug" and "contact" → no match.
  - "jog" → Resize Joint Openings… (disabled).
  - "material library" → AI Assistant….
  - **Changed since the audit:** "units", "inch" and "inches" now put **Settings…** first (#1554, `a9d0f8034`; `command-search.test.ts:72-74`). The "units, inches → no match" row in the table above is stale on main. "imperial" and "mm to inches" still miss.
- **Why ADR-604 covers the panel part.** The ADR's Decision defines the scope as "every registered command", and its "One source" bullet keeps it there. Its Context frames the problem as guessing "which menu holds it". Frame job, Set origin here, the jog pad and the Keyboard Shortcuts icon are not registered commands, so the Decision itself leaves them out. The Consequences sentence names other surfaces that are also left out (tutorials, settings, objects). It is not an exhaustive list that brings panel buttons back in. Searching panel controls is therefore a scope extension, not broken behaviour.
- **Why the placeholder doesn't mislead into anything.** Each result shows its description under the label. Wireframe View says "Draw Fill artwork as outlines … Output is unchanged." (`editing-tools-command-help.ts:87`), and Enter only toggles a view (Alt+W undoes it). No wrong burn or move comes of it.
- **Ways out a beginner would plausibly find:**
  - "machine setup" → Settings…, whose description names "links to Machine Setup and your materials" (`settings-command-help.ts`). Its Machine & materials tab has **Open Machine Setup…** (`SettingsMachineSection.tsx:60`), so the only hit is a correct two-click route, not a dead end.
  - "machine" → Machine Controls Panel first. That is the panel holding Frame job, Origin and the jog pad.
  - "tutorials" → Visual tutorials…. The no-match message also points to Learn.
  - Frame job sits on the always-visible machine panel, and Start's hover says "Press Frame job first" (`JobActionControls.tsx:128`).
- **Worse than reported, kept at P3:**
  - With artwork selected and a machine connected, "frame job" and "where it burns" put **Move Laser to Selection Center** first, enabled. Enter moves the head there. The move is beam off, and the label and tooltip say so (`machine-move-command-help.ts:22`: "Move the head, beam off, … in other Start From modes, Frame shows where the job burns"). It is a deliberate, described move inside the job's footprint, so it isn't P1. With nothing selected, these results are disabled with "Select…".
  - "machine" + Enter **hides** the machine panel if it is open, because Machine Controls Panel is a toggle (`window-panel-commands.ts:54-61`). It is reversible.
- **LightBurn:** its documented Help menu has no command search at all (LightBurn 2.1 docs, [Help Menu](https://docs.lightburnsoftware.com/2.1/Reference/UI/HelpMenu/), fetched 2026-11-03). In LightBurn, Frame is a button in the Laser window, as in KerfDesk. Ctrl+K is above parity, so a missing panel search isn't a gap against the reference.
- **Fix direction stands as written.** Step 4 (the placeholder) is the cheap must-do. Steps 1 to 3 are an enhancement and would need an ADR-604 amendment.

### U6-P3-1 — Learn's search is an unranked substring filter, so the matching lesson is often far down, and a laser user gets CNC lessons

- **Where:**
  - `src/ui/tutorials/tutorial-catalog.ts:16-37`: `searchTutorials` keeps every lesson whose title, summary, location, keywords or step text contains every typed word as a substring, in catalogue order. There is no ranking.
  - `src/ui/tutorials/TutorialLibrary.tsx:17` calls it with `'All', 'all'`, so laser mode searches CNC lessons too.
- **What a beginner sees** (`zz-u6-learnfull.js`):

  | Typed | Lessons found | Where the right lesson appears |
  |---|---|---|
  | origin | 12 | **Place the job using an origin** is 7th, after Prepare an image for engraving, Turn an image into paths, Resize receiving joint openings, … (`19-learn-origin-results.png`) |
  | fill | 7 | "Refine a Studio drawing" and "Studio: Fillet" come before **Fill a shape with laser engraving** |
  | line | 48 | — |
  | material | 20 | "Import artwork" and "Keep project notes" first; **Reuse a material recipe** 9th |
  | update | 7 | none is about updating |
  | cut out | 18 | "Cut around a shape with a router" and "Clear a recessed pocket" appear on a laser |
  | where it burns, inches, plywood, fill vs line | 0 | — |
- **Why it matters:** Learn is where the empty-search message sends the beginner ("browse Help → Visual tutorials"). The beginner reads the first few titles and concludes there is no lesson.
- **Evidence:** REPRO plus READ.
- **Fix direction:**
  - Rank the results: a title word match first, then keywords, then summary or location, then step text.
  - Match whole-word prefixes, so "fill" doesn't match "fillet" and "line" doesn't match "outline".
  - Filter by the current machine kind, as the topics already can.
  - Add synonyms to the keywords: inches/units, curve, cut last, plywood → material test, update.

**Refuter (2026-11-03):** CONFIRMED P3. It is slightly worse on main.
- **Code:** `searchTutorials` is unchanged (`tutorial-catalog.ts:16-37`: a substring `includes`, catalogue order). `TutorialLibrary.tsx:17` still passes `'All', 'all'`.
- **Reproduced** with the same Vitest over `TUTORIALS` (97 lessons on main):
  - "origin": the origin lesson is now **8th of 13**. #1554's new "Words you'll see" lesson comes 1st.
  - "frame": **Frame, review and start the exact job** is **10th of 22**, after four CNC lessons.
  - "fill": Fill a shape with laser engraving is 5th of 7.
  - "material": Reuse a material recipe is outside the top 9 of 21.
  - "units", "inches", "plywood", "where it burns" and "fill vs line" → 0.
  - Ctrl+K now finds Settings for "units", but Learn still doesn't.
- **Way out:** browsing a topic. Learn's topic list has a "Getting started" category, and the lesson titles are plain. This keeps it at P3.
- **LightBurn:** its help is the online docs, whose site has its own search. There is no in-app lesson list to compare.

### U6-P3-2 — Keyboard Shortcuts can only be found through a lesson; the icon's hover is the whole list instead of its name; F12 is missing

- **Where:**
  - `src/ui/common/Toolbar.tsx:41-42`: the icon-only button has `aria-label="Keyboard Shortcuts"` but `title={shortcutHint(...)}`. Its hover is a run-on text that begins "File: Ctrl+N new - Ctrl+O open - …" and never says "Keyboard Shortcuts".
  - Not in the Help menu (`02-help-menu.png`), not a command (U6-P2-1).
  - `src/ui/common/shortcut-list.ts:136-144` (View) omits F12, which `src/ui/app/view-shortcuts.ts:79` binds and Window → Toggle Side Panels labels.
- **What a beginner sees:**
  1. Help → nothing.
  2. Ctrl+K "shortcuts" → "No command matches" (`15-q9-cmd-shortcuts.png`).
  3. Learn "shortcuts" → Use keyboard shortcuts → "Click Keyboard Shortcuts in the top toolbar".
  4. The keyboard icon, far right (`21-shortcuts-dialog.png`).

  That is five steps for the most-asked "where's the list" question.
- **Evidence:** REPRO plus READ.
- **Fix direction:**
  - Add Help → Keyboard Shortcuts… (Ctrl+/ or F1 would be conventional), and register it as a command.
  - Make the icon's title "Keyboard Shortcuts (list every key)".
  - Add `{ keys: 'F12', action: 'show or hide both side panels' }` to the View rows.

**Refuter (2026-11-03):** CONFIRMED P3.
- **Code on main:**
  - `Toolbar.tsx:38-45`: `aria-label="Keyboard Shortcuts"`, `title={shortcutHint(...)}`.
  - `shortcutHint` joins every family into one string (`shortcut-list.ts:161-171`).
  - The View rows (`shortcut-list.ts:136-144`) have no F12. `view-shortcuts.ts:79` binds it.
  - `help-command-family.ts` has no shortcuts entry.
  - Ctrl+K "shortcuts", "keyboard" and "hotkeys" → no match (Vitest repro).
- **Mitigation:** the hover is itself the key list, so a beginner who hovers the icon sees the shortcuts even without the dialog. The icon is always visible in the top toolbar.
- **LightBurn** puts its list one step away: Help → Quick Help and Notes opens the Help and Notes window "directly to the Hotkeys tab", and F1 does the same (LightBurn 2.1 docs, [Help Menu](https://docs.lightburnsoftware.com/2.1/Reference/UI/HelpMenu/) and [Help and Notes](https://docs.lightburnsoftware.com/2.1/Reference/HelpAndNotes/), fetched 2026-11-03). So KerfDesk is below parity here. That supports the fix, but it's still polish.

### U6-P3-3 — Six lessons name a control by a word the screen doesn't use

| Lesson | Lesson says | Screen says |
|---|---|---|
| Plan the order of laser cuts (`production-tool-tutorials.ts:11,18`) | "Tools → Optimization Settings → Cut Planner"; "Open Optimization Settings." | Tools → **Cut Planner...** (`command-families.ts:37`); dialog title "Cut Planner". "Optimization Settings" appears nowhere in the UI (`l-cutorder-1.png`, `42-cut-planner.png`) |
| Reuse a material recipe (`laser-tutorials.ts:178,186-187`) | "Choose the target Layer"; "Apply to layer … Link to layer" | Field "**Apply to operation**" (`MaterialLibraryPanel.tsx:336`); button "Apply to <operation name>" (`MaterialLibraryRecipeControls.tsx:35`); "**Link to operation**" inside "Link or delete this preset" (`:58`) |
| Mask and crop an image (`image-tutorials.ts:85,99-100`) | "Apply Image Mask" | Tools → "**Apply Mask to Image**" (`command-families.ts:222`) |
| Give artwork an operation (`layout-tutorials.ts:300`) | "Read the Affects count before editing" | "**Shared by N artworks.** Edits apply to all of them." (`OperationInspectorControls.tsx:50`) |
| Laser outlines and cuts, tip (`laser-tutorials.ts:40`) | "Visible changes the canvas display. Output decides…" | "**Show on canvas**" / "**Include in output**" (`OperationInspectorControls.tsx:75,85`); the next lesson uses those names correctly |
| Draw in Design Studio (`studio-tutorials.ts:11,18`) | "Click Design on the left toolbar" | No Design item in the left toolbar (13 controls listed, `zz-u6-toolbars.js`). **Design Studio** (Pro) is in the top toolbar, and "Design" is the canvas tab opposite "G-code 3D", which does nothing here (`l-design-1.png`) |

Smaller drifts of the same kind:
- "In Text formatting, choose a Font. Set Size" (`text-tutorials.ts:25`): the panel is headed "Text" and the field is "Font size". "Text formatting" is only an aria-label.
- "Click Lib on the left toolbar" (`project-tutorials.ts:225`): the button shows an icon, and its hover says "Insert ready-made line art from the bundled design library."

The pictures are schematic diagrams, not screenshots, so they don't go stale the same way. One shows a generic leaf for the material recipe (`l-material-1.png`).

- **Why it matters:** the beginner reads the lesson's word and looks for it. "Optimization Settings" and "Design on the left toolbar" are dead ends.
- **Evidence:** REPRO (lessons opened in the app, `zz-u6-lessons.js`) plus READ. The lesson-word scan `zz-u6-lesson-words.mjs` lists 111 lesson phrases not found in UI strings; most are descriptive, and the six above are the ones that name a control.
- **Fix direction:**
  - Use the on-screen names in those lines.
  - Add a unit test that each lesson's `focus` and `location`, split on → · or ",", matches a command label, a help-topic label or a visible `<label>` text from a maintained allow-list. The scanner here is a starting point.

**Refuter (2026-11-03):** CONFIRMED P3. Every case was re-read on main, and none leaves a beginner unable to finish the lesson.

| Lesson | Re-checked on main | Can the beginner still do it? |
|---|---|---|
| Plan the order of laser cuts | `production-tool-tutorials.ts:11,18` unchanged. The dialog component is `OptimizationSettingsDialog` but is titled "Cut Planner" (`OptimizationSettingsDialog.tsx:18`). Ctrl+K "optimization settings" → no match. | **Yes.** The lesson's own location line ends "→ Cut Planner", and Tools → Cut Planner… exists. Learn "optimization" finds the lesson. Every later word in the lesson exists in that dialog: Travel policy, Reduce travel, Keep source order (`:54,68`), Inside paths first, Operation priority. |
| Reuse a material recipe | `laser-tutorials.ts:178,186-187` unchanged. Screen: "Apply to operation" (`MaterialLibraryPanel.tsx:336`), "Link to operation" (`MaterialLibraryRecipeControls.tsx:58`). The select's aria-label still says "Material library target layer" (`:343`), so a screen reader hears the lesson's word. | **Yes.** It is the only target picker in the panel, and the panel is headed "Material Library" (`:364`). |
| Mask and crop an image | `image-tutorials.ts:85,99-100`. The command is "Apply Mask to Image". | **Yes.** Same words, reordered. |
| Give artwork an operation | `layout-tutorials.ts:300-301`. Screen: "Shared by N artworks. Edits apply to all of them." (`OperationInspectorControls.tsx:50`). "Make unique" exists (`:30`). | **Yes.** The count is shown, and the action it leads to (Make unique) is named correctly. |
| Laser outlines and cuts (tip) | `laser-tutorials.ts:40`. Screen: "Include in output" / "Show on canvas" (`OperationInspectorControls.tsx:75,85`). | **Yes.** It is only a tip. |
| Draw in Design Studio | `studio-tutorials.ts:18`. Its **location line is also wrong**: "Left drawing toolbar → Design" (`:11`). The top toolbar shows a labelled **Design Studio** button (`DesignStudioButton.tsx:20`, rendered at `Toolbar.tsx:28`). | **Yes, with a detour.** The lesson title says "Design Studio", and a visible text button carries that name. In Free it ends at the Pro prompt either way (U6-P3-4). |

Nothing was found that makes this worse. The pictures are schematic, so none of them shows a wrong screen.

### U6-P3-4 — Sixteen lessons teach Pro tools to Free users with no Pro mark

- **Where:** `src/ui/tutorials/TutorialLibrary.tsx` and `TutorialReader.tsx` have no edition check. The lessons cover the Pro features in `src/ui/licensing/pro-features.ts:20-61`:
  - Design Studio (Draw in Design Studio, Draw to exact dimensions, Refine a Studio drawing, and Studio: Line / Polyline / Rectangle / Circle / Arc / Fillet / Chamfer);
  - Generate a finger-jointed box;
  - Engrave a leather keychain using a registration jig;
  - Place artwork on a measured board;
  - Trace several image files;
  - Carve lettering with a V-bit;
  - Prepare a 3D relief carve.
- **What a beginner sees:** Learn → Drawing & editing lists 27 lessons, 10 of them Design Studio, with no "Pro" (`49-learn-drawing-topic.png`). Following one ends at the "Design Studio is a Pro tool…" dialog. The menus and toolbar do mark these "(Pro)", for example "Box Generator... (Pro)" and "Design Studio Pro".
- **Evidence:** REPRO plus READ.
- **Fix direction:**
  - Show the same "Pro" pill on Pro lessons in the list and the reader, using `PRO_FEATURES` and a `proFeature` field on the lesson.
  - In Free, sort them after the free lessons in each topic.

**Refuter (2026-11-03):** CONFIRMED P3.
- **Code:** there is no edition, licence or Pro reference anywhere in `src/ui/tutorials/*.tsx` or `tutorial-types.ts` (grep on main).
- **Mitigation:** the Free user is told at the point of action by the "Design Studio is a Pro tool…" prompt, and the top-toolbar button's hover says "(Pro)" (`DesignStudioButton.tsx:14`). They lose a few minutes reading; they don't reach a wrong result.

### U6-P3-5 — The photo lesson never mentions the Photo engraving window

- **Where:** `src/ui/tutorials/laser-tutorials.ts:106-148` (Engrave a photo or bitmap) teaches Dither, Line Interval/DPI and Negative under Process: Image. Grep for "Photo engraving" in `src/ui/tutorials/` finds nothing.
- **What a beginner sees:** the tool exists as Tools → Photo engraving…, and the toolbar shows **Photo engraving** when an image is selected (`24-image-selected.png`). It holds the material recipes (wood, leather, tile, slate, anodised aluminium, glass) and Auto tones, but the lesson for "engrave a photo" sends the beginner to the expert controls.
- **Note:** U3-P2-3 is the separate problem that the window can't preview a phone-sized photo. This finding is only the missing pointer.
- **Evidence:** READ plus REPRO (toolbar).
- **Fix direction:** make step 1 "Select the photo and choose **Photo engraving** in the toolbar: pick your material and let Auto tones set the contrast", and keep the Dither steps as "Fine-tune by hand".

**Refuter (2026-11-03):** CONFIRMED P3.
- **Code:** `grep -i "photo engraving"` over `src/ui/tutorials/` on main finds nothing.
- **Ctrl+K:** "photo" puts Photo engraving… first. It is disabled with no image selected, and the row says why.
- **Way out:** the contextual toolbar button appears as soon as a photo is selected. The lesson's raw Image settings also produce a correct burn.
- **Main change:** #1555 (`19faee6f1`) fixed U3-P2-3, so a phone photo now previews in that window. The pointer is now worth more, but the severity is unchanged.

### U6-P3-6 — Path text is greyed with no reason until a path exists

- **Where:** `src/ui/text/PathTextFields.tsx:39-41`: `disabled={props.guides.length === 0}` with `title="Place text along a selected vector path."`.
- **What a beginner sees:** the text panel lists "Path text" with a greyed checkbox (`23-text-editor.png`). The hover doesn't say a path must be drawn first. The lesson says so only under its prerequisites ("a suitable vector guide in the project for Path text").
- **Evidence:** REPRO plus READ.
- **Fix direction:** when there are no guides, use the title "Draw a line, curve or shape first; text can follow it", as every disabled menu command already gives its reason.

**Refuter (2026-11-03):** CONFIRMED P3.
- **Code:** `PathTextFields.tsx:39,41` on main is unchanged.
- **Slightly worse:** "selected vector path" suggests the beginner should select a path, but the real requirement is only that a path exists.
- **Way out:** Bend, in the same panel, curves text without any path, which answers Q2's "text on a curve". The lesson's prerequisites also name the guide.

## KNOWN re-observed

- **U1-P3-4: units can't be found by search.** Re-observed for "inches", "imperial", "mm to inches" and in Learn. Sibling: the Settings window's General tab tooltip "Theme, workspace layout, recent projects and autosave" (`src/ui/settings/SettingsDialog.tsx:42`) also leaves out Units. Same fix.
- **U1-P3-7: no plain-language glossary.** Learn "fill vs line" and "engrave vs cut" return 0. The hover tooltips answer Q7 instead.
- **U1-P3-9: nothing points to Learn from the welcome card.**
- **S12-F1 (2026-07-10) / U2-P3-6: help in native alerts that can't link.**
  - "Can't connect?" still ends "Full guide: docs/connection-troubleshooting.md".
  - Safety & liability now ends "Full guide: https://kerfdesk.com/safety/" (200), but in an alert it can't be clicked.
  - Sibling: About says "see /third-party-notices.txt".
- **G-S18-2 / U1-P3-8: there is no docs site.** `https://kerfdesk.com/docs/` and `https://www.kerfdesk.com/docs/` return 404 (2026-11-03). The support page lists in-app help (Visual tutorials, Can't connect?, Safety) and email only.
- **G-S05-3 / U3-P2-1: no starting values for a material.** Q3 ends at an empty Materials tab and "run a material test".
- **U3-P2-4: nothing advises engraving first and cutting last.** Re-observed from the help side: "cut last" is in no command, lesson or keyword. "Sort cuts last" is only behind "•••" (`src/ui/layers/OperationListTools.tsx:84,102`).
- **U3-P3-3: the Alt colour peek is undocumented,** including in the Keyboard Shortcuts dialog.
- **ADR-604 Consequences (accepted):** tutorials and settings are not searched by Ctrl+K "in this first version". It is the accepted limit behind U1-P3-4. U6-P2-1 covers what it does not accept.

**Refuter (2026-11-03), KNOWN items on main `19faee6f1`:**
- **U1-P3-4: partly fixed by #1554.**
  - Ctrl+K "units", "inch" and "inches" → Settings… first. The Settings… tooltip now begins "units (millimetres or inches)".
  - Still open: "imperial", "mm to inches", and Learn "units"/"inches" (0). The General tab's tooltip at `SettingsDialog.tsx:42` still leaves Units out.
- **U1-P3-7: partly fixed by #1554.** The "Words you'll see" lesson (`project-tutorials.ts:53-121`) covers G-code, GRBL, homing, origin, Frame and kerf, and Learn "glossary" finds it. It doesn't cover Line, Fill or Image: "fill vs line" and "engrave vs cut" still return 0. Those are answered by hover instead.
- **U1-P3-9:** only the download page's half is fixed (#1554). The welcome card is unchanged.
- **S12-F1 / U2-P3-6:** unchanged.
  - `connection-help.ts:48` still says "Full guide: docs/connection-troubleshooting.md".
  - `CommandShell.tsx:400` still says "see /third-party-notices.txt".
- **G-S18-2 / U1-P3-8:** `https://kerfdesk.com/docs/` still returns 404. `/support` and `/safety/` return 200 (curl, 2026-11-03).
- **G-S05-3, U3-P2-4, U3-P3-3:** no change on main.

## Refuted

- **"Icon-only buttons have no tooltip."** Every control with at most two visible characters had a `title`, across eight UI states (`zz-u6-icons.js`: 58 in two states; `zz-u6-icons2.js`: 0 untitled in six more).
- **"Help links are dead or land in the wrong place."** All 7 distinct external targets return 200. Report a Problem lands on `/support#report`, scrolled to "Reporting a problem" (`33-support-live.png`).
- **"The live support page hides the email address."** Cloudflare rewrites the `mailto:` into an obfuscated link plus a decoder script. The page's CSP is `script-src 'self'` and the decoder is same-origin, so it runs. Rendered in Chrome, the page reads "Email support@kerfdesk.com." The repo copy (`public/support.html:67`) differs only by that rewrite.
- **"Ctrl+Shift+H / V, listed as flips, don't flip"** (`shortcuts.ts` `handleTransformShortcut` returns early on Ctrl). They are handled earlier, by `editing-tool-shortcuts.ts` `tryShiftChord`, which `use-shortcuts.ts` runs before the transform handler.
- **"Learn lessons for origin and text name controls that no longer exist."** Every name in Place the job using an origin and Bend text and follow a path was found on screen (`43/44-*.png`, `23-text-editor.png`). The stale names are only those in U6-P3-3.

**Refuter (2026-11-03):** all five refutations stand.
- **Flips:** `use-shortcuts.ts:55` runs `handleEditingToolShortcut` before `handleTransformShortcut` (`:56`). `editing-tool-shortcuts.ts:83-87` handles Ctrl+Shift+H/V there.
- **Help links:** `/support` and `/safety/` re-fetched as 200.
- **Tooltips and the support email:** not re-run (no build). I accept the auditor's DOM evidence, which covers 8 states.

## Verified clean

- **Help menu** (15 items, `02-help-menu.png`):
  - Find a command…, About, Visual tutorials…, Safety & liability, Can't connect?, Report a Problem, Save Support Report…, Get Help, Pricing, License & Safety Notice (an in-app dialog), Terms, Privacy, Refunds, Licence (the web welcome card) and Check for Updates…;
  - each has a hover that says what it does.
- **Support path:** the support page names email, Save Support Report and what to include. "If a machine does anything unexpected, stop it with the machine's own emergency stop first."
- **Units** (Settings → General): explains which readouts change and that "Projects and G-code stay in millimetres". Choosing Inches works (`46-units-inches.png`).
- **Line / Fill / Image hovers, the dither swatch descriptions, and the origin and placement controls** match their lessons.
- **Keyboard Shortcuts dialog:** grouped File / Tools / Edit / Transform / Arrange / View / machine, and machine-aware. Every listed key is bound (see Other checks).
- **Disabled menu commands** all give a reason in their hover, for example "Select an image first."
- **Search dialog** says what to do on no match. Learn says "No matching tutorials. Try another tool name, such as text or trace."
- **Settings window:** small (4 tabs on the web), with links to Machine Setup and Materials instead of duplicates.

## Not verified

- **Desktop-only help:** Help → Open Data Folder, Check for Updates in the installed app, Licence, and the "Phone & MCP" settings tab. Instructions were not to launch the installed app; the wording was read in `update-status-text.ts`.
- **Three CNC-preset source links** returned 403 to a scripted request: `docs.sainsmart.com/article/7c20d7zaw3`, and two `resources.sienci.com` print views. This is likely bot protection; not opened in a browser.
- **Native `title` tooltips** don't render in headless screenshots. Their text was read from the DOM.
- **The Save Support Report file content** (ADR-546): not saved.
- **LightBurn's help surfaces** were not compared. U8 owns the LightBurn comparison.

## Refuter summary

**Refuter:** fresh agent, 2026-11-03.

**Tree.** I read origin/main @ `19faee6f1`. Since the audited `c93fbb3bc`, main has merged:
- #1554: the Ctrl+K units match, the "Words you'll see" lesson, and the Frame/Start "Connect your machine first." wording;
- #1555: the Photo engraving phone-photo preview.

None of the U6 code lines cited above changed.

**Evidence.** The search results come from a focused Vitest over the real registry and lesson catalogue (`zz-u6r\zz-u6r-search.test.ts`; its tree was deleted after the run, junction removed first). It ran in the default context and again with a selection and a connected machine. No production bundle was built: every finding was settled by that run or by READ, so ports 4981–4989 were not used.

**Result.** P1 0 / P2 0 / P3 7. Confirmed 6, refuted 0, severity changes 1.

| ID | Verdict | Reason |
|---|---|---|
| U6-P2-1 | **SEVERITY CHANGE → P3** | Panel controls are outside ADR-604's Decision ("every registered command", "One source"), not only outside its Consequences list. Results show their descriptions, so nothing leads to a wrong action. The beginner has routes out: "machine setup" → Settings… → Open Machine Setup…, "machine" → Machine Controls Panel, and the always-visible Frame job button. LightBurn has no command search at all. The "frame" placeholder is a wording fault and should still be fixed. The table's "units, inches → no match" row is stale on main (#1554). |
| U6-P3-1 | CONFIRMED P3 | Slightly worse on main: "origin" puts the lesson 8th of 13, and "frame" puts the Frame lesson 10th of 22. |
| U6-P3-2 | CONFIRMED P3 | The icon's hover is itself the list. LightBurn has Help → Quick Help and Notes / F1, so KerfDesk is below parity. |
| U6-P3-3 | CONFIRMED P3 | None of the six blocks a lesson: each real control is nearby under a close name, and the Cut Planner lesson's own location line names it. Added: the Studio lesson's location line (`studio-tutorials.ts:11`) is also wrong. |
| U6-P3-4 | CONFIRMED P3 | The Pro prompt tells a Free user at the point of action. |
| U6-P3-5 | CONFIRMED P3 | Now more valuable, since #1555 makes the window work for phone photos. |
| U6-P3-6 | CONFIRMED P3 | Bend works without a path. The hover's "selected" wording is slightly misleading. |

**New, folded into U6-P2-1 rather than raised separately.** With artwork selected and a machine connected, Ctrl+K "frame job" or "where it burns" + Enter moves the head, beam off, to the selection's centre: **Move Laser to Selection Center** ranks first. The move is labelled and described, so it is not a safety finding. A fix that adds Frame job as a search entry must make sure it outranks these commands.

**For the coordinator.** If U6-P2-1's fix goes ahead, steps 1–3 need an ADR-604 amendment (scope beyond registered commands). Step 4, the placeholder, needs none.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u6\`:

| File | Purpose |
|---|---|
| `zz-u6-host.mjs` | Static host with production headers (copy of U3's): `node zz-u6-host.mjs dist 4961` |
| `zz-u6-drive.mjs`, `zz-u6-init.js`, `zz-u6-d.sh` | Playwright driver on 4962 (copy of U3's; `page` is a live proxy so a body can call `h.fresh()` first): `sh zz-u6-d.sh < body.js` |
| `zz-u6-menus.js` | Fresh profile; every menu's items, hovers and shortcuts (`zz-u6-menus.out.json`) |
| `zz-u6-search.js`, `zz-u6-learnfull.js` | The ten questions in Ctrl+K and Learn search; full Learn result order |
| `zz-u6-icons.js`, `zz-u6-icons2.js` | Icon-only controls without a title, eight states |
| `zz-u6-help.js`, `zz-u6-links.js`, `zz-u6-support.js` | Help items, external URLs (intercepted, not opened), the live support and safety pages |
| `zz-u6-lessons.js`, `zz-u6-learnlist.js`, `zz-u6-lesson-words.mjs` | Lessons opened step by step; Learn topic list; lesson words against UI strings (`node zz-u6-lesson-words.mjs <tree>/src`) |
| `zz-u6-screens.js`, `zz-u6-units.js`, `zz-u6-toolbars.js`, `zz-u6-rail.js` | Settings, Materials, Cut Planner, Origin/Placement, units, toolbars, rail menus |
| `shots\*.png` | Screenshots cited above |

To rebuild:
1. `git archive --format=tar origin/main src public index.html vite.config.ts package.json tsconfig.json scripts electron` into `zz-u6\tree`.
2. Junction `tree\node_modules` to the main checkout's.
3. Copy `zz-u5\tree\zz-u5-vite.config.ts` (the fflate alias) as `zz-u6-vite.config.ts`.
4. Run `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config zz-u6-vite.config.ts --outDir ../dist --emptyOutDir`. It took 35 min on the loaded machine.

`dist` and `tree` were deleted after the run.

```json
[
  {"id":"U6-P2-1","severity":"P2","refuterSeverity":"P3","area":"help-discoverability","file":"src/ui/commands/CommandSearchDialog.tsx","line":84,"anchor":"Contract: ADR-604 Decision ('One source') and Context ('An operator who knows what they want … still has to guess'); Consequences accept only tutorials/settings/objects as unsearched","evidence":"REPRO","known":false,"related":["U1-P3-4"],"summary":"Ctrl+K searches only menu commands: Frame, Start, Set origin here, Jog, Machine Setup, Materials and Keyboard Shortcuts can't be found; placeholder example 'frame' returns Wireframe View/Import Image/Focus Test; 'machine setup' → Settings; 'set origin', 'shortcuts', 'units' → no match; Laser menu has no Machine Setup"},
  {"id":"U6-P3-1","severity":"P3","area":"help-discoverability","file":"src/ui/tutorials/tutorial-catalog.ts","line":16,"anchor":"Twin: command-search.ts ranks label matches first; Learn search does not","evidence":"REPRO","known":false,"summary":"Learn search is an unranked substring filter over all machines: 'origin' puts the origin lesson 7th of 12, 'fill' puts Studio: Fillet first, 'line' gives 48, CNC lessons appear for a laser user"},
  {"id":"U6-P3-2","severity":"P3","area":"help-discoverability","file":"src/ui/common/Toolbar.tsx","line":42,"anchor":"Twin: every other icon-only control's title names it; view-shortcuts.ts:79 binds F12","evidence":"REPRO","known":false,"summary":"Keyboard Shortcuts not in Help menu or Ctrl+K (5 steps via a lesson); its icon's hover is the run-on key list, not its name; F12 missing from the list"},
  {"id":"U6-P3-3","severity":"P3","area":"help-discoverability","file":"src/ui/tutorials/production-tool-tutorials.ts","line":18,"anchor":"Twin: on-screen labels (command-families.ts:37,222; MaterialLibraryPanel.tsx:336; OperationInspectorControls.tsx:50,75,85; Toolbar)","evidence":"REPRO","known":false,"summary":"Six lessons name controls the screen calls something else: Optimization Settings (Cut Planner), Apply/Link to layer (operation), Apply Image Mask (Apply Mask to Image), Affects count (Shared by N), Visible (Show on canvas), Design on the left toolbar (top-toolbar Design Studio)"},
  {"id":"U6-P3-4","severity":"P3","area":"help-discoverability","file":"src/ui/tutorials/TutorialLibrary.tsx","line":17,"anchor":"Twin: menus and toolbar mark Pro tools '(Pro)' (edition-command-gate.ts labelProCommands)","evidence":"REPRO","known":false,"summary":"16 lessons teach Pro tools (10 of 27 in Drawing & editing are Design Studio) with no Pro mark in Learn"},
  {"id":"U6-P3-5","severity":"P3","area":"help-discoverability","file":"src/ui/tutorials/laser-tutorials.ts","line":118,"anchor":"Twin: Tools → Photo engraving… and the contextual toolbar button","evidence":"READ","known":false,"related":["U3-P2-3"],"summary":"'Engrave a photo or bitmap' teaches raw Dither/DPI and never mentions the Photo engraving window with material recipes and Auto tones"},
  {"id":"U6-P3-6","severity":"P3","area":"help-discoverability","file":"src/ui/text/PathTextFields.tsx","line":39,"anchor":"Twin: every disabled menu command's title gives its reason","evidence":"REPRO","known":false,"summary":"Path text checkbox greyed with no reason until a path exists; hover says only 'Place text along a selected vector path.'"}
]
```
