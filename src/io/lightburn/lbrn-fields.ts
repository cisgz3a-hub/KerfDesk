// Reads a LightBurn setting as LightBurn writes it: an attribute, or a child
// element holding its value in `Value` or its text.

export function booleanField(element: Element, names: ReadonlyArray<string>): boolean | null {
  const value = textField(element, names).trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  return null;
}

export function numericField(element: Element, names: ReadonlyArray<string>): number | null {
  return finiteNumber(textField(element, names));
}

// An element's own attributes and children only: a <SubLayer> inside a
// CutSetting holds its own values, which are never the layer's.
export function textField(element: Element, names: ReadonlyArray<string>): string {
  const allowed = new Set(names.map(normalized));
  for (const attribute of [...element.attributes]) {
    if (allowed.has(normalized(attribute.name))) return attribute.value;
  }
  for (const child of [...element.children]) {
    if (allowed.has(normalized(child.tagName)))
      return child.getAttribute('Value') ?? child.textContent ?? '';
  }
  return '';
}

export function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
