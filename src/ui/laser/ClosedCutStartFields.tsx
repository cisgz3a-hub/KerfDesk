// Cut Planner options for where closed Line cuts start (ADR-385). Each works
// on its own and all are off by default, so a project that never ticks them
// plans and emits exactly as before. They apply under Keep source order too:
// the visiting order stays the operator's, only each loop's entry moves.

import type { ProjectOptimizationSettings } from '../../core/scene';

type ClosedCutStartKey = 'bestStartPoint' | 'preferCorners' | 'bestDirection';

const FIELDS: ReadonlyArray<{
  readonly key: ClosedCutStartKey;
  readonly label: string;
  readonly title: string;
}> = [
  {
    key: 'bestStartPoint',
    label: 'Choose best start point',
    title:
      'Start each closed cut at the node nearest to where the head arrives, instead of where the shape was drawn. Cut geometry does not change.',
  },
  {
    key: 'preferCorners',
    label: 'Prefer corners',
    title:
      'Start closed cuts on a sharp corner (45° or more) where the start mark hides best. Shapes without a sharp corner keep their start.',
  },
  {
    key: 'bestDirection',
    label: 'Choose best direction',
    title:
      'Let each closed cut run whichever way continues the approach move, instead of always the drawn direction.',
  },
];

export function ClosedCutStartFields(props: {
  readonly settings: ProjectOptimizationSettings;
  readonly update: (patch: Partial<ProjectOptimizationSettings>) => void;
}): JSX.Element {
  return (
    <div style={groupStyle} role="group" aria-label="Closed cut starts">
      {FIELDS.map((field) => (
        <label key={field.key} style={checkboxRowStyle}>
          <input
            name={field.key}
            type="checkbox"
            className="lf-checkbox"
            checked={props.settings[field.key] === true}
            title={field.title}
            onChange={(event) =>
              props.update(closedCutPatch(field.key, event.currentTarget.checked))
            }
          />
          <span>{field.label}</span>
        </label>
      ))}
    </div>
  );
}

function closedCutPatch(
  key: ClosedCutStartKey,
  checked: boolean,
): Partial<ProjectOptimizationSettings> {
  switch (key) {
    case 'bestStartPoint':
      return { bestStartPoint: checked };
    case 'preferCorners':
      return { preferCorners: checked };
    case 'bestDirection':
      return { bestDirection: checked };
  }
}

const groupStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
