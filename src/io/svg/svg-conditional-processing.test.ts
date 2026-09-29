import { afterEach, describe, expect, it, vi } from 'vitest';
import { svgRenderedChildren } from './svg-conditional-processing';

function renderedIds(children: string): string[] {
  const document = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg"><switch id="switch">${children}</switch></svg>`,
    'image/svg+xml',
  );
  const element = document.getElementById('switch');
  return element === null ? [] : svgRenderedChildren(element).map((child) => child.id);
}

describe('svgRenderedChildren', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders every child of an element that is not a <switch>', () => {
    const document = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="g"><rect id="a"/><rect id="b"/></g></svg>',
      'image/svg+xml',
    );
    const group = document.getElementById('g') as Element;
    expect(svgRenderedChildren(group).map((child) => child.id)).toEqual(['a', 'b']);
  });

  it('matches systemLanguage by tag or by a prefix that ends at a hyphen', () => {
    vi.stubGlobal('navigator', { languages: ['en', 'de-DE'] });
    expect(
      renderedIds('<rect id="a" systemLanguage="fr"/><rect id="b" systemLanguage="en-GB"/>'),
    ).toEqual(['b']);
    expect(renderedIds('<rect id="a" systemLanguage="de"/><rect id="b"/>')).toEqual(['b']);
    expect(renderedIds('<rect id="a" systemLanguage=" DE-de , fr"/><rect id="b"/>')).toEqual(['a']);
    expect(renderedIds('<rect id="a" systemLanguage=""/><rect id="b"/>')).toEqual(['b']);
  });

  it('never renders a child that requires extensions, and ignores requiredFeatures', () => {
    expect(
      renderedIds(
        '<desc id="d">about</desc><g id="a" requiredExtensions="http://example.com/x"/>' +
          '<g id="b" requiredFeatures="http://www.w3.org/TR/SVG11/feature#Shape"/><g id="c"/>',
      ),
    ).toEqual(['b']);
  });

  it('renders nothing when no child qualifies', () => {
    expect(renderedIds('<title id="t">only a title</title>')).toEqual([]);
  });
});
