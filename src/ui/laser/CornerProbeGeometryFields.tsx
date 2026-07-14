import { ProbeNumberField } from './ProbeNumberField';

export type CornerProbeGeometryDraft = {
  readonly plateCenterOffsetXmm: number;
  readonly plateCenterOffsetYmm: number;
  readonly sideDropMm: number;
  readonly sideClearanceMm: number;
};

export function CornerProbeGeometryFields(props: {
  readonly bitDiameterMm: number;
  readonly geometry: CornerProbeGeometryDraft;
  readonly onBitDiameter: (value: number) => void;
  readonly onGeometry: (value: CornerProbeGeometryDraft) => void;
}): JSX.Element {
  return (
    <>
      <div style={rowStyle}>
        <ProbeNumberField
          label="Bit diameter"
          value={props.bitDiameterMm}
          onCommit={props.onBitDiameter}
        />
        <ProbeNumberField
          label="Plate center X offset"
          value={props.geometry.plateCenterOffsetXmm}
          onCommit={(plateCenterOffsetXmm) =>
            props.onGeometry({ ...props.geometry, plateCenterOffsetXmm })
          }
        />
      </div>
      <div style={rowStyle}>
        <ProbeNumberField
          label="Plate center Y offset"
          value={props.geometry.plateCenterOffsetYmm}
          onCommit={(plateCenterOffsetYmm) =>
            props.onGeometry({ ...props.geometry, plateCenterOffsetYmm })
          }
        />
        <ProbeNumberField
          label="Side probe drop"
          value={props.geometry.sideDropMm}
          onCommit={(sideDropMm) => props.onGeometry({ ...props.geometry, sideDropMm })}
        />
      </div>
      <div style={rowStyle}>
        <ProbeNumberField
          label="Side clearance"
          value={props.geometry.sideClearanceMm}
          onCommit={(sideClearanceMm) => props.onGeometry({ ...props.geometry, sideClearanceMm })}
        />
      </div>
    </>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 6 };
