import { useLayoutEffect, useState, type CSSProperties } from 'react';

type ToastPlacement = {
  readonly host: HTMLElement | null;
  readonly style: CSSProperties;
};

const EMPTY_PLACEMENT: ToastPlacement = { host: null, style: {} };

/** Toasts share the canvas's available space, never the machine or live controls.
 * A modal owns a reserved in-flow host so even full-window dialogs stay usable. */
export function useToastPlacement(active: boolean): ToastPlacement {
  const [placement, setPlacement] = useState<ToastPlacement>(EMPTY_PLACEMENT);
  useLayoutEffect(() => {
    if (!active) {
      setPlacement(EMPTY_PLACEMENT);
      return undefined;
    }
    let host: HTMLElement | null = null;
    let modalPanel: HTMLElement | null = null;
    let workspace: HTMLElement | null = null;
    let scheduled: number | undefined;
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    const mutations = new MutationObserver(() => schedule());

    function sync(): void {
      scheduled = undefined;
      const nextPanel = topmostModalPanel();
      if (nextPanel !== modalPanel) {
        host?.remove();
        modalPanel = nextPanel;
        host = nextPanel === null ? null : document.createElement('div');
        if (host !== null) {
          host.className = 'lf-toast-dialog-host';
          // Append in DOM order so an opening dialog keeps its established
          // first control for initial focus; flex order reserves the visual row.
          nextPanel?.append(host);
        }
      }
      const nextWorkspace = document.querySelector<HTMLElement>('[data-toast-workspace]');
      if (nextWorkspace !== workspace) {
        if (workspace !== null) resize?.unobserve(workspace);
        workspace = nextWorkspace;
        if (workspace !== null) resize?.observe(workspace);
      }
      const style = workspacePlacement(workspace?.getBoundingClientRect());
      setPlacement((previous) =>
        previous.host === host && samePlacement(previous.style, style) ? previous : { host, style },
      );
    }

    function schedule(): void {
      scheduled ??= window.requestAnimationFrame(sync);
    }

    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    sync();
    return (): void => {
      mutations.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
      if (scheduled !== undefined) window.cancelAnimationFrame(scheduled);
      host?.remove();
    };
  }, [active]);
  return placement;
}

function topmostModalPanel(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const modal = dialogs[dialogs.length - 1];
  if (modal === undefined) return null;
  const panel = modal.querySelector<HTMLElement>(':scope > .lf-dialog');
  if (panel !== null) return panel;
  // Small custom modals have one card; full-window editors own their layout.
  return modal.children.length === 1 && modal.firstElementChild instanceof HTMLElement
    ? modal.firstElementChild
    : modal;
}

function workspacePlacement(bounds: DOMRect | undefined): CSSProperties {
  if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) return {};
  const gap = 12;
  // Leave the bottom canvas zoom controls clear too. The measured bottom is
  // already above both Live Motion and the status bar, including wrapped rows.
  const bottomInset = Math.min(56, bounds.height / 4);
  return {
    left: bounds.left + gap,
    bottom: Math.max(gap, window.innerHeight - bounds.bottom + bottomInset),
    width: Math.max(0, Math.min(360, bounds.width - gap * 2)),
    maxHeight: Math.max(0, Math.min(240, bounds.height - bottomInset - gap)),
  };
}

function samePlacement(left: CSSProperties, right: CSSProperties): boolean {
  return (
    left.left === right.left &&
    left.bottom === right.bottom &&
    left.width === right.width &&
    left.maxHeight === right.maxHeight
  );
}
