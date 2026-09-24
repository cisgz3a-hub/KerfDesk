// The renderer half of the packaged native smoke: evaluated in the Electron
// window by native-smoke.ts, and in the browser suite against the real UI by
// e2e/native-smoke-renderer.e2e.ts. It has no imports so both can load it.
// src/ui/common/Toolbar.native-smoke-reach.test.tsx pins the toolbar side of
// the contract (accessible names, More items as menuitems) in the fast suite.

export const RENDERER_SMOKE_SOURCE = String.raw`(async () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const labelled = (selector, label) =>
    [...document.querySelectorAll(selector)].find(
      (candidate) => candidate.getAttribute('aria-label') === label,
    );
  // The responsive toolbar renders only its primary commands as buttons; the
  // rest live in the "More commands" popover, which exists in the DOM only
  // while it is open. Run a command from whichever place holds it now.
  const command = async (label) => {
    const direct = labelled('button', label);
    if (direct instanceof HTMLButtonElement) {
      direct.click();
      return;
    }
    const more = labelled('button', 'More commands');
    if (!(more instanceof HTMLButtonElement)) throw new Error(label + ' button missing');
    if (more.getAttribute('aria-expanded') !== 'true') more.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const item = labelled('[role="menuitem"]', label);
      if (item instanceof HTMLButtonElement) {
        item.click();
        return;
      }
      await delay(10);
    }
    throw new Error(label + ' command missing from More');
  };
  let saved = '';
  Object.defineProperty(window, 'showOpenFilePicker', {
    configurable: true,
    value: async () => [{
      kind: 'file',
      name: 'native-smoke.svg',
      getFile: async () => new File([
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M1 1 L9 9" stroke="#000"/></svg>',
      ], 'native-smoke.svg', { type: 'image/svg+xml' }),
    }],
  });
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: async () => ({
      kind: 'file',
      name: 'native-smoke.lf2',
      createWritable: async () => ({
        write: async (data) => { saved = data instanceof Blob ? await data.text() : String(data); },
        close: async () => undefined,
        abort: async () => undefined,
      }),
    }),
  });
  await command('Import...');
  for (let attempt = 0; attempt < 40 && !saved.includes('native-smoke.svg'); attempt += 1) {
    await delay(50);
    await command('Save As...');
    await delay(50);
  }
  if (!saved.includes('native-smoke.svg')) throw new Error('imported SVG was absent from saved project');
  let savedSchemaVersion = null;
  try {
    const savedProject = JSON.parse(saved);
    savedSchemaVersion = savedProject?.schemaVersion ?? null;
  } catch {
    // The result below reports an invalid save without hiding the other smoke evidence.
  }
  return {
    readyToShow: true,
    imported: true,
    saved: Number.isSafeInteger(savedSchemaVersion) && savedSchemaVersion > 0,
    savedSchemaVersion,
    savedBytes: saved.length,
    title: document.title,
    url: location.href,
  };
})()`;
