import type { SketchEditorProps } from './SketchConstraintEditor';
export function SketchInitialPointEditor({ sketch, onChange }: SketchEditorProps): JSX.Element {
  return (
    <>
      {sketch.points.map((point, index) => (
        <div key={point.id} className="lf-sketch-point-row">
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
                value={Number.isFinite(point[axis]) ? point[axis] : ''}
                onChange={(event) =>
                  onChange({
                    ...sketch,
                    points: sketch.points.map((candidate, i) =>
                      index === i
                        ? {
                            ...candidate,
                            [axis]:
                              event.currentTarget.value.trim() === ''
                                ? NaN
                                : Number(event.currentTarget.value),
                          }
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
