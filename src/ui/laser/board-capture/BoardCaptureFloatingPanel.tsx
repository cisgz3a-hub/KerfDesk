import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Icon } from '../../kit';
import { TutorialButton } from '../../tutorials/TutorialButton';
import { useFloatingBoardPanel, type FloatingBoardPanelPosition } from './use-floating-board-panel';
import './board-capture.css';

type FloatingPanelProps = {
  readonly busy: boolean;
  readonly checkActive: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly rememberedPosition: React.MutableRefObject<FloatingBoardPanelPosition | null>;
};

export function BoardCaptureFloatingPanel(props: FloatingPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const { panelRef, position, dragHandle } = useFloatingBoardPanel(props.rememberedPosition);
  // Keep correction/cancellation controls visible for the whole operation,
  // including motion started while the controls were collapsed.
  const collapseDisabled = props.busy || props.checkActive;
  const folded = collapsed && !collapseDisabled;
  useLayoutEffect(() => {
    if (!props.checkActive) return;
    const content = contentRef.current;
    const check = content?.querySelector<HTMLElement>('[data-board-active-check]');
    if (content === null || check === undefined || check === null) return;
    content.scrollTop += check.getBoundingClientRect().top - content.getBoundingClientRect().top;
  }, [folded, props.checkActive]);
  return (
    <section
      ref={panelRef}
      aria-label="Place board"
      className="lf-board-panel"
      data-collapsed={folded}
      style={{ left: position.x, top: position.y }}
    >
      <FloatingPanelHeader
        contentId={contentId}
        folded={folded}
        collapseDisabled={collapseDisabled}
        onToggle={() => setCollapsed(!folded)}
        dragHandle={dragHandle}
        busy={props.busy}
        onClose={props.onClose}
      />
      <span id={`${contentId}-move-help`} className="lf-board-panel-move-help">
        Drag this title bar or use arrow keys to move the panel. Hold Shift for larger steps. Press
        Home to return it to the top-right corner.
      </span>
      <div id={contentId} ref={contentRef} className="lf-board-panel-content" hidden={folded}>
        {props.children}
      </div>
    </section>
  );
}

type HeaderProps = Pick<FloatingPanelProps, 'busy' | 'onClose'> & {
  readonly contentId: string;
  readonly folded: boolean;
  readonly collapseDisabled: boolean;
  readonly onToggle: () => void;
  readonly dragHandle: ReturnType<typeof useFloatingBoardPanel>['dragHandle'];
};

function FloatingPanelHeader(props: HeaderProps): JSX.Element {
  const toggleLabel = props.folded
    ? 'Expand Place Board controls'
    : 'Collapse Place Board controls';
  return (
    <header className="lf-board-panel-header">
      <div className="lf-board-panel-toggle">
        <Button
          variant="ghost"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!props.folded}
          aria-controls={props.contentId}
          disabled={props.collapseDisabled}
          onClick={props.onToggle}
        >
          <Icon name={props.folded ? 'chevron-down' : 'chevron-up'} size={14} />
        </Button>
      </div>
      <div className="lf-board-panel-drag">
        <Button
          variant="ghost"
          aria-label="Move Place Board panel"
          aria-describedby={`${props.contentId}-move-help`}
          title="Drag to move. Arrow keys move the panel; Shift moves farther. Home resets its position."
          {...props.dragHandle}
        >
          <span aria-hidden="true" className="lf-board-panel-grip">
            ⋮⋮
          </span>
          <strong>Place Board</strong>
        </Button>
      </div>
      <TutorialButton tutorialId="board" compact label="Place board" />
      <Button
        variant="ghost"
        aria-label="Close board capture panel"
        disabled={props.busy}
        onClick={props.onClose}
      >
        <Icon name="close" size={16} />
      </Button>
    </header>
  );
}
