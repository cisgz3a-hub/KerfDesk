// RailSection — the one disclosure chrome for collapsible rail sections
// (probe, bit manager, machine catalog, tiling, spoilboard…). Before this,
// eight panels each rolled their own <details>/<summary> styling — some
// boxed, some bare — which is exactly the inconsistency the operations-rail
// redesign removes. Styling lives in tokens.css (.lf-section*).

export function RailSection(props: {
  readonly label: string;
  /** Right-aligned muted status: a count ("20") or a state ("Off"). */
  readonly badge?: string;
  /** Tooltip explaining what the section does. */
  readonly hint?: string;
  /** Force the open state on render; omit for ordinary uncontrolled toggling. */
  readonly open?: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <details className="lf-section" {...(props.open === undefined ? {} : { open: props.open })}>
      <summary {...(props.hint === undefined ? {} : { title: props.hint })}>
        <span>{props.label}</span>
        {props.badge === undefined ? null : <span className="lf-section-badge">{props.badge}</span>}
      </summary>
      <div className="lf-section-body">{props.children}</div>
    </details>
  );
}
