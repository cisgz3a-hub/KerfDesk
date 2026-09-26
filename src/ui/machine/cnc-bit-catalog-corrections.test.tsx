// ADR-322 Amendment 2 (2026-09-25 PR audit, SET-1): a saved copy of a catalog
// bit keeps what the catalog shipped when it was added. #894 gave both Amana
// O-flute ball-nose bits their single flute; a copy saved before still has no
// flute count, so recipe feeds assume two flutes and double the chip load.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncTool } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { staleCatalogBitCorrections } from './cnc-bit-catalog-corrections';
import { MODELED_CNC_BIT_CATALOG } from './cnc-bit-modeled-catalog';
import { CncToolManager } from './CncLibraryPanels';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function savedCopy(catalogId: string, fluteCount?: number): CncTool {
  const entry = MODELED_CNC_BIT_CATALOG.find((candidate) => candidate.id === catalogId);
  if (entry === undefined) throw new Error(`missing catalog entry ${catalogId}`);
  const { fluteCount: _catalogFlutes, ...tool } = entry.tool;
  return {
    ...tool,
    id: `custom-${catalogId}`,
    catalogId,
    ...(fluteCount === undefined ? {} : { fluteCount }),
  };
}

describe('staleCatalogBitCorrections', () => {
  it('names a saved Amana ball-nose copy that still has no flute count', () => {
    for (const catalogId of ['o-ball-0125-amana-51814', 'o-ball-025-amana-51818']) {
      expect(staleCatalogBitCorrections(savedCopy(catalogId))).toEqual([
        {
          toolName: savedCopy(catalogId).name,
          before: 'no flute count, so feeds assume 2 flutes',
          now: '1 flute',
          effect: expect.stringContaining('chip load'),
          patch: { fluteCount: 1 },
        },
      ]);
    }
  });

  it("leaves the operator's own flute count, other catalog bits and custom bits alone", () => {
    expect(staleCatalogBitCorrections(savedCopy('o-ball-0125-amana-51814', 2))).toEqual([]);
    expect(staleCatalogBitCorrections(savedCopy('o-ball-0125-amana-51814', 1))).toEqual([]);
    const other = MODELED_CNC_BIT_CATALOG.find(
      (entry) => !entry.id.includes('amana') && entry.tool.fluteCount === undefined,
    );
    if (other !== undefined) {
      expect(staleCatalogBitCorrections({ ...other.tool, id: 'x', catalogId: other.id })).toEqual(
        [],
      );
    }
    const { catalogId: _catalogId, ...hand } = savedCopy('o-ball-0125-amana-51814');
    expect(staleCatalogBitCorrections(hand)).toEqual([]);
  });
});

describe('bit library correction offer', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(tool: CncTool, onChangeFluteCount: (id: string, count: number) => void): void {
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, tool],
    };
    act(() =>
      root.render(
        <CncToolManager
          machine={machine}
          customTools={[tool]}
          onChangeFluteCount={onChangeFluteCount}
        />,
      ),
    );
  }

  function offerFor(tool: CncTool): HTMLButtonElement | null {
    // Bit names carry inch marks, so match the label rather than build a selector.
    const label = `Use the catalog's 1 flute for ${tool.name}`;
    return (
      [...host.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === label,
      ) ?? null
    );
  }

  it('sets a stale copy to the catalog flute count in one click', () => {
    const stale = savedCopy('o-ball-025-amana-51818');
    const change = vi.fn();
    render(stale, change);

    act(() => offerFor(stale)?.click());

    expect(change).toHaveBeenCalledExactlyOnceWith(stale.id, 1);
  });

  it('offers nothing once the copy has a flute count', () => {
    const current = savedCopy('o-ball-025-amana-51818', 1);
    render(current, vi.fn());
    expect(offerFor(current)).toBeNull();
  });
});
