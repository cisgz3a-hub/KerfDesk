import { operationOverrideForObject } from '../../core/effective-output';
import { outputOperationLayers, sceneObjectUsesOperation, type Project } from '../../core/scene';
import { useStore } from '../state';

type LocalScanOffset = {
  readonly id: string;
  readonly owner: string;
  readonly offsetMm: number;
};

export function ScanOffsetOverrideNotice(): JSX.Element | null {
  const project = useStore((state) => state.project);
  const overrides = localScanOffsets(project);
  if (overrides.length === 0) return null;
  return (
    <div role="note" style={noticeStyle}>
      Saved local scan-offset overrides replace the device table only when the corresponding
      operation emits bidirectionally:
      <ul style={listStyle}>
        {overrides.map((override) => (
          <li key={override.id}>
            {override.owner}: {formatSignedOffset(override.offsetMm)} mm
            {override.offsetMm === 0 ? ' (device table disabled when bidirectional)' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function localScanOffsets(project: Project): ReadonlyArray<LocalScanOffset> {
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  const layers = operations.flatMap((layer) =>
    layer.bidirectionalScanOffsetMm === undefined
      ? []
      : [
          {
            id: `layer:${layer.id}`,
            owner: `Layer ${layer.name}`,
            offsetMm: layer.bidirectionalScanOffsetMm,
          },
        ],
  );
  const objects = project.scene.objects.flatMap((object) =>
    operations.flatMap((operation) => {
      if (!sceneObjectUsesOperation(object, operation)) return [];
      const offsetMm = operationOverrideForObject(operation, object)?.bidirectionalScanOffsetMm;
      return offsetMm === undefined
        ? []
        : [
            {
              id: `object:${object.id}:${operation.id}`,
              owner: `Object ${object.id} / operation ${operation.name}`,
              offsetMm,
            },
          ];
    }),
  );
  return [...layers, ...objects];
}

function formatSignedOffset(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

const noticeStyle: React.CSSProperties = {
  padding: 8,
  border: '1px solid var(--lf-warning)',
  borderRadius: 6,
  color: 'var(--lf-warning)',
  fontSize: 12,
};
const listStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18 };
