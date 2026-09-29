// Tiny HTML templating for the KerfDesk website.
//
// `html` is a tagged template: every interpolated value is HTML-escaped unless
// it is itself the result of `html` or `raw`. Arrays are joined, and null,
// undefined and false render as nothing, so conditional fragments read as
// `${cond && html`...`}`. There is no other templating layer; pages are plain
// modules that return `html` fragments.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class RawHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

// Marks trusted markup (for example an inlined SVG file) as already safe.
export function raw(value) {
  return new RawHtml(String(value));
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += renderValue(value) + strings[index + 1];
  });
  return new RawHtml(out);
}
