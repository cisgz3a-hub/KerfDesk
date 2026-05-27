import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize';

const CLEAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 10 10 L 90 90" stroke="#ff0000" fill="none" />
</svg>`;

describe('sanitizeSvg — clean input', () => {
  it('passes a clean SVG through with zero strips', () => {
    const { clean, stripped } = sanitizeSvg(CLEAN_SVG);
    expect(stripped).toEqual({
      scripts: 0,
      foreignObjects: 0,
      externalLinks: 0,
      dataUris: 0,
    });
    expect(clean).toContain('<path');
    expect(clean).toContain('M 10 10 L 90 90');
  });
});

describe('sanitizeSvg — malicious input (WORKFLOW.md F-A3 error cases)', () => {
  it('strips <script> tags and counts them', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <script>alert(1)</script>
  <script>console.log('payload')</script>
  <path d="M0 0 L10 10" />
</svg>`;
    const { clean, stripped } = sanitizeSvg(dirty);
    expect(stripped.scripts).toBe(2);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
  });

  it('strips <foreignObject> and counts it', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <foreignObject><div>HTML in SVG</div></foreignObject>
  <path d="M0 0 L10 10" />
</svg>`;
    const { clean, stripped } = sanitizeSvg(dirty);
    expect(stripped.foreignObjects).toBe(1);
    expect(clean.toLowerCase()).not.toContain('<foreignobject');
  });

  it('strips external xlink:href and counts it', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
  <use xlink:href="https://evil.example.com/payload.svg#x" />
  <path d="M0 0 L10 10" />
</svg>`;
    const { clean, stripped } = sanitizeSvg(dirty);
    expect(stripped.externalLinks).toBeGreaterThanOrEqual(1);
    expect(clean).not.toContain('evil.example.com');
  });

  it('strips non-image data: URIs (keeps image/* data URIs)', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
  <use xlink:href="data:text/html,<script>alert(1)</script>" />
  <path d="M0 0 L10 10" />
</svg>`;
    const { clean, stripped } = sanitizeSvg(dirty);
    expect(stripped.dataUris).toBeGreaterThanOrEqual(1);
    expect(clean).not.toContain('data:text/html');
  });

  it('preserves geometry through sanitation', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <script>alert(1)</script>
  <path d="M 10 10 L 90 90" stroke="#ff0000" fill="none" />
  <rect x="5" y="5" width="20" height="20" stroke="#0000ff" fill="none" />
</svg>`;
    const { clean } = sanitizeSvg(dirty);
    expect(clean).toContain('M 10 10 L 90 90');
    expect(clean).toContain('rect');
  });
});

describe('sanitizeSvg — counts reset between calls', () => {
  it("doesn't leak state across two sequential calls", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`;
    const first = sanitizeSvg(dirty);
    const second = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
    expect(first.stripped.scripts).toBe(1);
    expect(second.stripped.scripts).toBe(0);
  });
});
