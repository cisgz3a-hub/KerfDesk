import { describe, expect, it } from 'vitest';
import { RawOpenTagScanner } from './raw-open-tag-scanner';

describe('RawOpenTagScanner', () => {
  it('ignores declarations, comments, CDATA, processing instructions, and closing tags', () => {
    const scanner = new RawOpenTagScanner();
    const source = `<?xml version="1.0"?>
      <!DOCTYPE svg [
        <!ELEMENT svg ANY>
        <!-- declaration <noise/> -->
        <?declaration instruction?>
      ]>
      <svg data-note="a>b">
        <!-- <comment-noise/> -->
        <![CDATA[<cdata-noise/>]]>
        <?inside instruction?>
        <g/><path data-note='c>d'/>
      </svg>`;

    for (const character of source) scanner.write(character);

    expect(scanner.take()).toBe('<svg data-note="a>b">');
    expect(scanner.take()).toBe('<g/>');
    expect(scanner.take()).toBe("<path data-note='c>d'/>");
    expect(() => scanner.take()).toThrow('SVG source tag did not match');
  });

  it('retains complete tags when markup delimiters cross writes', () => {
    const scanner = new RawOpenTagScanner();
    const source = '<svg><!--ignored--><![CDATA[ignored]]><path d="M0 0 L1 1"/></svg>';

    for (let index = 0; index < source.length; index += 2) {
      scanner.write(source.slice(index, index + 2));
    }

    expect(scanner.take()).toBe('<svg>');
    expect(scanner.take()).toBe('<path d="M0 0 L1 1"/>');
  });
});
