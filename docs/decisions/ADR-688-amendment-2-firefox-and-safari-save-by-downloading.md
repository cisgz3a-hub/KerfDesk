## ADR-688 Amendment 2 - Firefox and Safari save and export by downloading, and nothing calls their autosave safe (2026-11-09)

**Status:** Accepted; unit evidence and a Chrome e2e run with the pickers removed; Firefox and
Safari themselves were not run. | **Date:** 2026-11-09

Fixes rolling audit v11 finding W9-P2-2 (`docs/audits/2026-11-08-rolling-v11/W9-platform-web-docs.md`).
Amends Decisions 4 and 5 and the Consequence "Firefox and Safari users … keep it in autosave". It
reverses the "no download fallback" line of PROJECT.md "Delivery targets" for saving only: Chromium
stays the first-class target, and Open still needs a picker or a drop.

### Context

- In a browser without `showSaveFilePicker` every Save, Save As and export threw, so the work lived
  only in IndexedDB autosave.
- WebKit deletes all of a site's script-writable storage, IndexedDB included, after seven days of
  Safari use without a visit (webkit.org/blog/10218). Home Screen web apps are exempt.
- Storage belongs to one browser profile, so "open KerfDesk in Chrome or Edge" could not move the
  work, and the banner's "your work is autosaved in this browser" reassured without cause.
- `navigator.storage.persist()` was asked only after a successful manual save, which never happened
  in these browsers.

### Decision

1. **Saving downloads where there is no save picker.** The web adapter's `pickFileForSave` returns a
   download target when `showSaveFilePicker` is missing and the browser can make a Blob URL. Its
   write hands the bytes to an anchor with a `download` name (the URL is revoked a minute later).
   `reserveSaveDirectory` does the same for multi-file exports (tiles, multi-file trace): each file
   downloads on its own. The adapter reports this through `PlatformAdapter.savesByDownload`. Every
   caller of the picker therefore downloads: the project `.lf2`, G-code and every export. A browser
   that has neither keeps the old error, reworded to "can't save or download files".
2. **A download is a save, but not a proven copy.** `SaveTarget.delivery = 'download'`. Save marks
   the project saved, says "Downloaded <name>. Check that it reached your Downloads folder; drag it
   onto the canvas to open it again.", and **keeps the autosave**: the browser reports nothing back
   (it may still ask where to put the file, or the user may cancel), so the hand-over that clears
   the autosave after a file save is skipped. A download target has no Recent Projects handle and
   is never the same destination as another, so each Save downloads a fresh copy and nothing is
   ever written over.
3. **The Save-changes question offers Save there.** `platformCanSaveFiles` (picker or download)
   decides it. The Save-less panel of Decision 5 remains for a browser that can do neither, and now
   says the work is only in this browser's autosave, which the browser can delete and no other
   browser can see.
4. **`persist()` is asked at the first autosave there.** In a browser without file pickers the
   autosave writer asks once per page session, after its first successful write (the moment there
   is work to keep). Firefox may show its permission prompt then. Elsewhere the first manual save
   still asks.
5. **The banner says what is true.** With downloads: "This browser saves by downloading. Save and
   Export download a copy to your Downloads folder; drag a file onto the canvas to open or import
   it." Then, in every no-picker browser: "Until you save, your work is only in this browser's
   autosave: the browser can delete it (Safari does after 7 days without a visit), and no other
   browser or the desktop app can see it. Chrome, Edge and the desktop app save in place."

### Consequences

- Firefox and Safari users can get every project and export out as a file, and are told plainly
  what an autosave-only copy risks.
- A Save that downloads leaves the autosave holding the last interval snapshot, up to 30 seconds
  older than the file. Clearing it on an unconfirmed download would be worse.
- Each Save adds a copy to Downloads ("job (1).lf2" and so on); that is how download saves work.
- Safari may ask "Allow downloads on this site?" the first time, and several at once for a
  multi-file export.
- No change to Chromium, the desktop app, the project format, burns or G-code.

### Verification

`download-save-target.test.ts` (anchor, name, Blob, revoke, no identity), `web-adapter.test.ts`
(the fallback for single files and folders, and the error with neither), `browser-saves-by-download.test.ts`
(the download toast keeps the autosave; the autosave writer asks `persist()` only after a successful
write where pickers are missing), `browser-without-file-pickers.test.tsx` (banner wording, Save offered
with downloads, the Save-less panel's wording) and `e2e/browser-saves-by-download.e2e.ts` (Chrome with
`showOpenFilePicker`, `showSaveFilePicker` and `showDirectoryPicker` removed: the banner, a Save As
that arrives as a download holding the edit, and the download opening again when dropped).
**Not verified:** real Firefox and Safari, and the seven-day ITP clock.
