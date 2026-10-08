import type { SketchEditorProps } from './SketchConstraintEditor';
export function SketchInitialPointEditor({ sketch, onChange }: SketchEditorProps): JSX.Element {
  return (
    <>
      {sketch.points.map((point, index) => (
        <div key={point.id}>
          {point.id}
          {(['x', 'y'] as const).map((axis) => (
            <label key={axis}>
              {axis} (mm)
              <input
                title={
                  'Initial ' +
                  axis.toUpperCase() +
                  ' coordinate of point ' +
                  point.id +
                  ' in millimetres'
                }
                type="number"
                aria-label={point.id + ' ' + axis}
                value={point[axis]}
                onChange={(event) =>
                  onChange({
                    ...sketch,
                    points: sketch.points.map((candidate, i) =>
                      index === i
                        ? { ...candidate, [axis]: Number(event.currentTarget.value) }
                        : candidate,
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
      ))}
    </>
  );
}
