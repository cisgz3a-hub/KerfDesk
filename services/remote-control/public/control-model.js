export const $ = (selector) => document.querySelector(selector);
export const errorMessages = {
  unavailable: 'The computer is offline. Open KerfDesk on your PC and refresh.',
  stale_revision: 'The workspace changed on your PC. Refresh before trying the edit again.',
  needs_pro: 'Choose a trial or licence in the desktop app to use this Pro feature.',
  unsupported_operation: 'This operation cannot be edited here. Use KerfDesk on your PC.',
  invalid_input: 'Check the values and try again.',
  cancelled: 'The request was cancelled or this connection was revoked.',
  control_limit: 'No action was sent. Pair again and approve machine control on the PC.',
  failed: 'The change could not be completed. Refresh the workspace and try again.',
};

export function safeText(value, max = 2048) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function validWorkspace(value) {
  const items = (list) =>
    Array.isArray(list) &&
    list.length <= 200 &&
    list.every((item) => item && typeof item.id === 'string' && item.id.length <= 128);
  return (
    value &&
    typeof value.revision === 'string' &&
    value.revision.length > 0 &&
    value.revision.length <= 200 &&
    items(value.artwork) &&
    items(value.operations) &&
    Array.isArray(value.selection) &&
    value.selection.length <= 200
  );
}

export function selectedIds() {
  return [...document.querySelectorAll('#artwork-list input:checked')].map((item) => item.value);
}

export function number(form, name, min = -100_000, max = 100_000) {
  const value = form.elements.namedItem(name).value.trim();
  if (!value) throw new Error('Enter a value in each required number field.');
  // Drafts stay untouched while typing, including an empty value, minus and decimal point.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error('Use a valid number.');
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max)
    throw new Error(`Use a number between ${min} and ${max}.`);
  return parsed;
}

export function numbers(form, names) {
  return Object.fromEntries(names.map((name) => [name, number(form, name)]));
}

export function positive(form, name, max = 100_000) {
  const value = number(form, name, 0, max);
  if (value <= 0) throw new Error('Width, height, font size and speed must be greater than zero.');
  return value;
}

export function bindForm(id, action, callback) {
  $(id).addEventListener('submit', (event) => {
    event.preventDefault();
    void action(() => callback(event.currentTarget));
  });
}

export function fillOptions(select, items, chosen = select.value, emptyLabel) {
  select.replaceChildren();
  if (emptyLabel) select.append(new Option(emptyLabel, ''));
  for (const item of items)
    select.append(new Option(safeText(item.name || item.type || item.id, 512), item.id));
  if ([...select.options].some((option) => option.value === chosen)) select.value = chosen;
}

export function renderPreview(value, revision) {
  const image = $('#workspace-preview');
  image.hidden = true;
  image.removeAttribute('src');
  const message = $('#preview-message');
  const bounds = $('#preview-bounds');
  bounds.textContent = '';
  if (!value || value.revision !== revision) {
    message.textContent = 'Refresh to see a preview of the current workspace.';
    return;
  }
  if (value.status === 'disabled') {
    message.textContent =
      'Artwork sharing is off. On the PC, open Settings → Phone & MCP and enable “Share artwork previews and text with approved phones and MCP apps”.';
    return;
  }
  if (value.status !== 'ready' || !validPreview(value.preview)) {
    message.textContent =
      safeText(value.message) || 'Preview unavailable. Your artwork stays on the PC.';
    return;
  }
  image.src = 'data:image/png;base64,' + value.preview.data;
  image.hidden = false;
  message.textContent =
    safeText(value.message) ||
    'Design preview from your PC. Machine position and toolpaths stay in the PC view.';
  const box = value.bounds;
  if (box && [box.xMm, box.yMm, box.widthMm, box.heightMm].every(Number.isFinite))
    bounds.textContent = `Artwork bounds: ${box.widthMm.toFixed(2)} × ${box.heightMm.toFixed(2)} mm · X ${box.xMm.toFixed(2)}, Y ${box.yMm.toFixed(2)}`;
}

function invalidImageSize(value) {
  return (
    value.mimeType !== 'image/png' ||
    !Number.isInteger(value.widthPx) ||
    !Number.isInteger(value.heightPx) ||
    value.widthPx < 1 ||
    value.heightPx < 1 ||
    value.widthPx > 1024 ||
    value.heightPx > 1024
  );
}

export function validPreview(value) {
  if (!value || invalidImageSize(value)) return false;
  const data = value.data;
  if (typeof data !== 'string' || data.length > 65_536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    return false;
  try {
    const bytes = atob(data);
    const dimension = (offset) =>
      [0, 1, 2, 3].reduce((size, index) => size * 256 + bytes.charCodeAt(offset + index), 0);
    return (
      bytes.startsWith('\x89PNG\r\n\x1a\n') &&
      bytes.slice(12, 16) === 'IHDR' &&
      dimension(16) === value.widthPx &&
      dimension(20) === value.heightPx
    );
  } catch {
    return false;
  }
}

export function createFontPickers() {
  let fonts = [];
  function paint(form) {
    const select = form.elements.fontId;
    const chosen = select.value;
    const query = form.elements.fontSearch.value.trim().toLocaleLowerCase();
    const matching = fonts.filter((font) => font.name.toLocaleLowerCase().includes(query));
    const current = fonts.find((font) => font.id === chosen);
    const caption = form.querySelector('.current-font');
    if (caption)
      caption.textContent = current ? ` · ${safeText(current.name, 128)}` : ' · Keep current';
    const visible = current && !matching.includes(current) ? [current, ...matching] : matching;
    fillOptions(
      select,
      visible,
      chosen,
      form.id === 'text-edit-form' ? 'Keep current font' : 'Desktop default',
    );
    if (chosen && !visible.some((font) => font.id === chosen)) {
      const currentOption = new Option('Current font (keep unchanged)', chosen);
      currentOption.disabled = true;
      select.append(currentOption);
      select.value = chosen;
    }
    form.querySelector('.font-count').textContent = `${matching.length} matching bundled fonts`;
  }
  const forms = [$('#text-form'), $('#text-edit-form')];
  for (const form of forms) {
    form.elements.fontSearch.addEventListener('input', () => paint(form));
    form.elements.fontId.addEventListener('change', () => paint(form));
  }
  return {
    set(value) {
      fonts = Array.isArray(value?.fonts)
        ? value.fonts
            .slice(0, 200)
            .filter((font) => font && typeof font.id === 'string' && typeof font.name === 'string')
        : [];
      for (const form of forms) paint(form);
    },
    choose(form, id) {
      form.elements.fontSearch.value = '';
      if (![...form.elements.fontId.options].some((option) => option.value === id))
        form.elements.fontId.append(new Option('Current font (keep unchanged)', safeText(id, 128)));
      form.elements.fontId.value = id;
      paint(form);
    },
  };
}

export function continueToMcp() {
  const target = new URLSearchParams(location.search).get('continue');
  if (!target || target.length > 4096) return false;
  try {
    const parsed = new URL(target, location.origin);
    if (
      parsed.origin === location.origin &&
      parsed.pathname === '/authorize' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    ) {
      location.assign(parsed.href);
      return true;
    }
  } catch {
    /* Only an exact same-origin consent page is accepted. */
  }
  return false;
}
