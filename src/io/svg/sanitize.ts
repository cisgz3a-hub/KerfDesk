// SVG sanitizer — DOMPurify-backed with a custom hook stripping external
// xlink:href references and non-image data URIs. Returns the sanitized markup
// plus counts of each removed-class-of-thing so the import flow can surface
// "sanitized 2 script tags" in the WORKFLOW.md F-A3 toast.
//
// Security posture per PROJECT.md / ADR-017 / RESEARCH_LOG.md DOMPurify entry:
//   * USE_PROFILES: { svg: true, svgFilters: true }
//   * <script> stripped by profile
//   * <foreignObject> stripped by profile
//   * external xlink:href stripped by custom hook
//   * non-image data: URIs stripped by custom hook
//
// SAFE_FOR_XML defaults to `true` in DOMPurify (escapes characters that
// break XML parsers downstream). We deliberately rely on that default
// instead of setting it explicitly — passing it through the call site
// would invite a future "let me try false to fix X" without realising
// the trade-off. MIT-T4 audit note.
//
// Test corpus of crafted-malicious SVGs lives at
// src/__fixtures__/svg/malicious/.

import DOMPurify from 'dompurify';

export type SvgStripCounts = {
  readonly scripts: number;
  readonly foreignObjects: number;
  readonly externalLinks: number;
  readonly dataUris: number;
};

export type SanitizeResult = {
  readonly clean: string;
  readonly stripped: SvgStripCounts;
};

const DATA_IMAGE_URL = /^data:image\//i;

export function sanitizeSvg(dirty: string): SanitizeResult {
  const counts = {
    scripts: 0,
    foreignObjects: 0,
    externalLinks: 0,
    dataUris: 0,
  };

  // Hooks are global on the DOMPurify singleton. Clear any leakage from prior
  // calls before installing ours, then tear down on exit. Single-threaded JS
  // guarantees no interleaving.
  DOMPurify.removeAllHooks();

  DOMPurify.addHook('uponSanitizeElement', (_node, data) => {
    const tag = data.tagName.toLowerCase();
    if (tag === 'script') counts.scripts += 1;
    if (tag === 'foreignobject') counts.foreignObjects += 1;
  });

  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase();
    if (name !== 'href' && name !== 'xlink:href') return;
    // LU6 (AUDIT-2026-06-10): ALLOWLIST, not a protocol blocklist. The old
    // /^(https?:|file:|ftp:)/ prefix match let protocol-relative ('//evil…')
    // and whitespace-prefixed URLs through. Only same-document fragments and
    // image data URIs have a legitimate use in imported artwork.
    const value = (data.attrValue ?? '').trim();
    if (value === '' || value.startsWith('#')) return;
    if (DATA_IMAGE_URL.test(value)) return;
    if (value.toLowerCase().startsWith('data:')) {
      counts.dataUris += 1;
    } else {
      counts.externalLinks += 1;
    }
    data.keepAttr = false;
  });

  const clean = DOMPurify.sanitize(dirty, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['defs', 'symbol', 'use'],
    ADD_ATTR: ['href', 'xlink:href'],
    KEEP_CONTENT: false,
  });

  DOMPurify.removeAllHooks();

  return { clean: String(clean), stripped: { ...counts } };
}
