import { describe, expect, it } from 'vitest';
import {
  EntityExpansionBudget,
  expandInternalSubset,
  INTERNAL_ENTITY_LIMITS,
  internalSubsetEntities,
} from './internal-subset-entities';

const doctype = (subset: string) => ` svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd" [${subset}]`;

describe('internalSubsetEntities', () => {
  it('reads literal internal general entities', () => {
    const entities = internalSubsetEntities(
      doctype(`
        <!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
        <!-- a comment with ] and > in it -->
        <?pi with ] ?>
        <!ENTITY st0 'fill:none;stroke:#FF0000;font-family:"Arial"'>
        <!ELEMENT svg ANY>
        <!ATTLIST svg id ID #IMPLIED>`),
    );
    expect([...entities]).toEqual([
      ['ns_ai', 'http://ns.adobe.com/AdobeIllustrator/10.0/'],
      ['st0', 'fill:none;stroke:#FF0000;font-family:"Arial"'],
    ]);
  });

  it('ignores external, parameter, nested and markup entities', () => {
    const entities = internalSubsetEntities(
      doctype(`
        <!ENTITY xxe SYSTEM "file:///etc/passwd">
        <!ENTITY pub PUBLIC "-//X//EN" "http://example.com/x">
        <!ENTITY % pe "x">
        <!ENTITY lol2 "&lol;&lol;">
        <!ENTITY markup "<g/>">
        <!ENTITY percent "50%">
        <!ENTITY charref "&#169;">
        <!ENTITY lt "<">
        <!ENTITY kept "ok">`),
    );
    expect([...entities]).toEqual([['kept', 'ok']]);
  });

  it('binds the first declaration of a name', () => {
    const entities = internalSubsetEntities(doctype('<!ENTITY a "first"><!ENTITY a "second">'));
    expect(entities.get('a')).toBe('first');
  });

  it('stops at a parameter-entity reference, as XML 1.0 §5.1 requires', () => {
    const entities = internalSubsetEntities(
      doctype('<!ENTITY before "1"> %external; <!ENTITY after "2">'),
    );
    expect([...entities.keys()]).toEqual(['before']);
  });

  it('bounds the count and length of declarations', () => {
    const many = Array.from({ length: 70 }, (_, index) => `<!ENTITY e${index} "v">`).join('');
    expect(internalSubsetEntities(doctype(many)).size).toBe(INTERNAL_ENTITY_LIMITS.count);
    const long = 'x'.repeat(INTERNAL_ENTITY_LIMITS.valueLength + 1);
    expect(internalSubsetEntities(doctype(`<!ENTITY long "${long}">`)).size).toBe(0);
  });

  it('reads nothing from a DOCTYPE without an internal subset', () => {
    expect(internalSubsetEntities(' svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "a[b].dtd"').size).toBe(0);
  });
});

describe('expandInternalSubset', () => {
  it('expands declared references and drops the internal subset', () => {
    const text =
      '<?xml version="1.0"?>\n<!-- &a; -->\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd" [\n' +
      '  <!ENTITY ns "http://ns.example/">\n  <!ENTITY q \'say "hi" \'>\n]>\n' +
      '<svg xmlns:x="&ns;" title="&q;"><!-- &ns; --><style><![CDATA[&ns;]]></style>&ns;&amp;</svg>';
    expect(expandInternalSubset(text)).toBe(
      '<?xml version="1.0"?>\n<!-- &a; -->\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd" >\n' +
        '<svg xmlns:x="http://ns.example/" title="say &#34;hi&#34; ">' +
        '<!-- &ns; --><style><![CDATA[&ns;]]></style>http://ns.example/&amp;</svg>',
    );
  });

  it('leaves a document without an internal subset unchanged', () => {
    const text = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd"><svg>&x;</svg>';
    expect(expandInternalSubset(text)).toBe(text);
  });

  it('refuses expansion that outgrows the file', () => {
    const value = 'x'.repeat(INTERNAL_ENTITY_LIMITS.valueLength);
    const references = '&big;'.repeat(
      Math.ceil(INTERNAL_ENTITY_LIMITS.expansionFloor / INTERNAL_ENTITY_LIMITS.valueLength) + 1,
    );
    const text = `<!DOCTYPE svg [<!ENTITY big "${value}">]><svg>${references}</svg>`;
    expect(() => expandInternalSubset(text)).toThrow(/entity references expand/);
  });
});

describe('EntityExpansionBudget', () => {
  it('allows the larger of the floor and the input ratio', () => {
    const budget = new EntityExpansionBudget();
    budget.spend(INTERNAL_ENTITY_LIMITS.expansionFloor, 1);
    expect(() => budget.spend(1, 1)).toThrow(/expand to more than/);
    const large = new EntityExpansionBudget();
    const input = INTERNAL_ENTITY_LIMITS.expansionFloor;
    expect(() => large.spend(INTERNAL_ENTITY_LIMITS.expansionRatio * input, input)).not.toThrow();
  });
});
