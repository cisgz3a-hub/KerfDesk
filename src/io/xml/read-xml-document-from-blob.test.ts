import { describe, expect, it } from 'vitest';
import {
  readXmlDocumentFromBlob,
  XmlActiveDeclarationError,
  XmlDocumentParseError,
} from './read-xml-document-from-blob';

// Streams the text in small chunks, so declarations and references straddle
// chunk boundaries as they do in a real file read.
function chunkedBlob(text: string, chunkSize = 7): Blob {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.length; at += chunkSize) {
            controller.enqueue(bytes.slice(at, at + chunkSize));
          }
          controller.close();
        },
      }),
  } as unknown as Blob;
}

const readSvg = (text: string) =>
  readXmlDocumentFromBlob(chunkedBlob(text), { label: 'SVG', mediaType: 'image/svg+xml' });

const illustrator = (subset: string, body: string) =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
  subset +
  '\n]>\n' +
  body;

describe('readXmlDocumentFromBlob internal-subset entities', () => {
  it('resolves Illustrator namespace and style entities in attributes and text', async () => {
    const document = await readSvg(
      illustrator(
        '\t<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n\t<!ENTITY st0 "fill:none;stroke:#FF0000;">',
        '<svg xmlns="&ns_svg;"><rect style="&st0;" data-note="a&#10;b"/><desc>&st0;</desc></svg>',
      ),
    );
    const rect = document.querySelector('rect');
    expect(document.documentElement.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(rect?.getAttribute('style')).toBe('fill:none;stroke:#FF0000;');
    expect(rect?.getAttribute('data-note')).toBe('a\nb');
    expect(document.querySelector('desc')?.textContent).toBe('fill:none;stroke:#FF0000;');
  });

  it('still refuses references to external, parameter-built or nested entities', async () => {
    for (const subset of [
      '<!ENTITY xxe SYSTEM "file:///etc/passwd">',
      '<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">',
    ]) {
      const text = illustrator(subset, '<svg>&xxe;&lol2;</svg>');
      await expect(readSvg(text)).rejects.toThrow(XmlDocumentParseError);
      await expect(readSvg(text)).rejects.toThrow(/undefined entity/);
    }
  });

  it('refuses entity expansion that outgrows the file', async () => {
    const value = 'x'.repeat(4096);
    const text = illustrator(`<!ENTITY big "${value}">`, `<svg>${'&big;'.repeat(2100)}</svg>`);
    await expect(readSvg(text)).rejects.toThrow(/entity references expand to more than/);
  });

  it('keeps refusing active declarations where a caller forbids them', async () => {
    const text = illustrator('<!ENTITY ok "fine">', '<LightBurnProject a="&ok;"/>');
    await expect(
      readXmlDocumentFromBlob(chunkedBlob(text), {
        label: 'LightBurn project',
        mediaType: 'text/xml',
        forbidActiveDeclarations: true,
      }),
    ).rejects.toThrow(XmlDocumentParseError);
    const plain = illustrator('<!ENTITY ok "fine">', '<LightBurnProject/>');
    await expect(
      readXmlDocumentFromBlob(chunkedBlob(plain), {
        label: 'LightBurn project',
        mediaType: 'text/xml',
        forbidActiveDeclarations: true,
      }),
    ).rejects.toThrow(XmlActiveDeclarationError);
  });
});
