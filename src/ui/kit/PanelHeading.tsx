// PanelHeading — consistent section headings for rails and panels. The
// audit's UX pass found three different h2 margins and two h3 sizes across
// the right rails; this is the single replacement.

export function PanelHeading(props: {
  readonly level?: 2 | 3;
  readonly children: React.ReactNode;
}): JSX.Element {
  if (props.level === 3) {
    return <h3 className="lf-subheading">{props.children}</h3>;
  }
  return <h2 className="lf-heading">{props.children}</h2>;
}
