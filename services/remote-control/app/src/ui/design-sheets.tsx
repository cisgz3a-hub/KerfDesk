import { useEffect, useState } from 'react';
import { controller } from '../core/controller';
import { selectionBox } from '../core/scene';
import { canEdit, store } from '../core/store';
import type { TextDetails } from '../core/types';
import { useApp } from './hooks';
import { Icon, type IconName } from './icons';
import { Banner, NumberField, Segmented, Sheet, Toggle } from './primitives';

const close = () => store.set({ sheet: null });

function bedCenter(): { x: number; y: number } {
  const bed = store.get().scene?.bed;
  return bed === undefined ? { x: 50, y: 50 } : { x: bed.widthMm / 2, y: bed.heightMm / 2 };
}

export function PropertiesSheet() {
  const selection = useApp((state) => state.selection);
  const artwork = useApp((state) => state.workspace?.artwork ?? []);
  const operations = useApp((state) => state.workspace?.operations ?? []);
  const editable = useApp(canEdit);
  const sharing = useApp((state) => state.workspace?.permissions?.artworkSharingEnabled === true);
  const [lock, setLock] = useState(true);
  const box = selectionBox(selection, artwork);
  const items = artwork.filter((item) => selection.includes(item.id));
  const single = items.length === 1 ? items[0] : undefined;
  const operationId = items.every((item) => item.operationId === items[0]?.operationId)
    ? items[0]?.operationId
    : undefined;
  if (box === null)
    return (
      <Sheet title="Properties" onClose={close}>
        <p className="muted">Select artwork on the canvas first.</p>
      </Sheet>
    );
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const resize = (nextWidth: number | null, nextHeight: number | null) => {
    let w = nextWidth ?? width;
    let h = nextHeight ?? height;
    if (lock && width > 0 && height > 0) {
      if (nextWidth !== null) h = (height * w) / width;
      else w = (width * h) / height;
    }
    void controller.scale(selection, box, {
      minX: box.minX,
      minY: box.minY,
      maxX: box.minX + w,
      maxY: box.minY + h,
    });
  };
  return (
    <Sheet
      title={single === undefined ? `${items.length} items` : labelFor(single.type)}
      onClose={close}
    >
      <div className="grid-2">
        <NumberField
          label="X"
          unit="mm"
          value={box.minX}
          disabled={!editable}
          onCommit={(x) => void controller.move(selection, x - box.minX, 0)}
        />
        <NumberField
          label="Y"
          unit="mm"
          value={box.minY}
          disabled={!editable}
          onCommit={(y) => void controller.move(selection, 0, y - box.minY)}
        />
        <NumberField
          label="Width"
          unit="mm"
          min={0.01}
          max={100000}
          value={width}
          disabled={!editable}
          onCommit={(w) => resize(w, null)}
        />
        <NumberField
          label="Height"
          unit="mm"
          min={0.01}
          max={100000}
          value={height}
          disabled={!editable}
          onCommit={(h) => resize(null, h)}
        />
      </div>
      <Toggle label="Keep proportions" checked={lock} onChange={setLock} disabled={!editable} />
      <RotateRow ids={selection} disabled={!editable} />
      {operations.length > 0 && controller.designControl() ? (
        <label className="field">
          <span>Layer</span>
          <select
            className="select"
            value={operationId ?? ''}
            disabled={!editable}
            onChange={(event) =>
              void controller.write(
                'assign_artwork_to_operation',
                { artworkIds: selection, operationId: event.target.value },
                { success: 'Moved to layer.' },
              )
            }
          >
            {operationId === undefined ? <option value="">Mixed</option> : null}
            {operations.map((operation, index) => (
              <option key={operation.id} value={operation.id}>
                {operation.name ?? `Layer ${index + 1}`} · {operation.type}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {single?.type === 'text' ? (
        sharing ? (
          <TextEditor artworkId={single.id} disabled={!editable} />
        ) : (
          <Banner tone="info">Turn on artwork sharing on the PC to edit this text here.</Banner>
        )
      ) : null}
    </Sheet>
  );
}

function RotateRow({ ids, disabled }: { ids: string[]; disabled: boolean }) {
  return (
    <div className="field">
      <span>Rotate</span>
      <div className="btn-row">
        {[-90, -15, 15, 90].map((angle) => (
          <button
            key={angle}
            type="button"
            className="btn btn-soft"
            disabled={disabled}
            onClick={() => void controller.rotate(ids, angle)}
          >
            {angle > 0 ? `+${angle}°` : `${angle}°`}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextEditor({ artworkId, disabled }: { artworkId: string; disabled: boolean }) {
  const fonts = useApp((state) => state.fonts);
  const revision = useApp((state) => state.workspace?.revision);
  const [details, setDetails] = useState<TextDetails | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    let live = true;
    void controller.readText(artworkId).then(
      (value) => {
        if (!live) return;
        setDetails(value);
        setText((current) => (current === '' ? value.text : current));
      },
      () => setDetails(null),
    );
    return () => {
      live = false;
    };
  }, [artworkId, revision]);
  if (details === null) return <div className="skeleton" style={{ height: 120 }} />;
  const patch = (value: Record<string, unknown>) =>
    controller.write('update_text', { artworkId, patch: value });
  return (
    <div className="stack">
      <label className="field">
        <span>Text</span>
        <textarea
          className="textarea"
          value={text}
          disabled={disabled}
          maxLength={4096}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || text.trim() === '' || text === details.text}
        onClick={() => void patch({ text })}
      >
        Update text
      </button>
      <label className="field">
        <span>Font</span>
        <select
          className="select"
          value={details.fontId}
          disabled={disabled}
          onChange={(event) => void patch({ fontId: event.target.value })}
        >
          {fonts.map((font) => (
            <option key={font.id} value={font.id}>
              {font.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <NumberField
          label="Size"
          unit="mm"
          min={0.1}
          max={1000}
          value={details.fontSizeMm}
          disabled={disabled}
          onCommit={(fontSizeMm) => void patch({ fontSizeMm })}
        />
        <NumberField
          label="Line height"
          unit="×"
          min={0.1}
          max={20}
          value={details.lineHeight}
          disabled={disabled}
          onCommit={(lineHeight) => void patch({ lineHeight })}
        />
      </div>
      <Segmented
        label="Alignment"
        value={details.alignment}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
        ]}
        onChange={(alignment) => void patch({ alignment })}
      />
    </div>
  );
}

export function TextSheet({ at }: { at?: { x: number; y: number } }) {
  const fonts = useApp((state) => state.fonts);
  const start = at ?? bedCenter();
  const [text, setText] = useState('');
  const [fontId, setFontId] = useState('');
  const [size, setSize] = useState(10);
  const [width, setWidth] = useState(120);
  const [pos, setPos] = useState(start);
  const add = async () => {
    const result = await controller.write('add_text', {
      xMm: pos.x,
      yMm: pos.y,
      widthMm: width,
      text,
      fontSizeMm: size,
      ...(fontId === '' ? {} : { fontId }),
    });
    if (result !== null) close();
  };
  return (
    <Sheet
      title="Add text"
      onClose={close}
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={text.trim() === ''}
          onClick={() => void add()}
        >
          <Icon name="plus" /> Add text
        </button>
      }
    >
      <label className="field">
        <span>Text</span>
        <textarea
          className="textarea"
          autoFocus
          value={text}
          maxLength={4096}
          placeholder="Your text"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Font</span>
        <select
          className="select"
          value={fontId}
          onChange={(event) => setFontId(event.target.value)}
        >
          <option value="">Default</option>
          {fonts.map((font) => (
            <option key={font.id} value={font.id}>
              {font.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <NumberField label="Size" unit="mm" min={0.1} max={1000} value={size} onCommit={setSize} />
        <NumberField
          label="Max width"
          unit="mm"
          min={1}
          max={100000}
          value={width}
          onCommit={setWidth}
        />
        <NumberField label="X" unit="mm" value={pos.x} onCommit={(x) => setPos({ ...pos, x })} />
        <NumberField label="Y" unit="mm" value={pos.y} onCommit={(y) => setPos({ ...pos, y })} />
      </div>
    </Sheet>
  );
}

export function ShapeSheet({ shape }: { shape: 'rect' | 'ellipse' }) {
  const center = bedCenter();
  const [box, setBox] = useState({ x: center.x - 25, y: center.y - 25, w: 50, h: 50 });
  const add = async () => {
    const result = await controller.write(shape === 'rect' ? 'add_rectangle' : 'add_ellipse', {
      xMm: box.x,
      yMm: box.y,
      widthMm: box.w,
      heightMm: box.h,
    });
    if (result !== null) close();
  };
  return (
    <Sheet
      title={shape === 'rect' ? 'Add rectangle' : 'Add ellipse'}
      onClose={close}
      footer={
        <button type="button" className="btn btn-primary" onClick={() => void add()}>
          Add
        </button>
      }
    >
      <div className="grid-2">
        <NumberField label="X" unit="mm" value={box.x} onCommit={(x) => setBox({ ...box, x })} />
        <NumberField label="Y" unit="mm" value={box.y} onCommit={(y) => setBox({ ...box, y })} />
        <NumberField
          label="Width"
          unit="mm"
          min={0.01}
          max={100000}
          value={box.w}
          onCommit={(w) => setBox({ ...box, w })}
        />
        <NumberField
          label="Height"
          unit="mm"
          min={0.01}
          max={100000}
          value={box.h}
          onCommit={(h) => setBox({ ...box, h })}
        />
      </div>
    </Sheet>
  );
}

const ARRANGE: { action: string; label: string; icon: IconName }[] = [
  { action: 'align_left', label: 'Left', icon: 'align' },
  { action: 'align_center', label: 'Center', icon: 'align' },
  { action: 'align_right', label: 'Right', icon: 'align' },
  { action: 'align_top', label: 'Top', icon: 'align' },
  { action: 'align_middle', label: 'Middle', icon: 'align' },
  { action: 'align_bottom', label: 'Bottom', icon: 'align' },
  { action: 'distribute_horizontal', label: 'Space across', icon: 'pan' },
  { action: 'distribute_vertical', label: 'Space down', icon: 'pan' },
  { action: 'mirror_horizontal', label: 'Flip across', icon: 'mirror' },
  { action: 'mirror_vertical', label: 'Flip down', icon: 'mirror' },
  { action: 'group', label: 'Group', icon: 'group' },
  { action: 'ungroup', label: 'Ungroup', icon: 'group' },
];
export function ArrangeSheet() {
  const selection = useApp((state) => state.selection);
  return (
    <Sheet title="Arrange" onClose={close}>
      <p className="note" style={{ marginTop: 0 }}>
        Alignment uses the last selected item as its reference.
      </p>
      <div className="grid-3">
        {ARRANGE.map((item) => (
          <button
            key={item.action}
            type="button"
            className="btn btn-soft"
            style={{ flexDirection: 'column', minHeight: 64, gap: 4, fontSize: 13 }}
            disabled={
              selection.length === 0 ||
              (item.action.startsWith('align') && selection.length < 2) ||
              (item.action.startsWith('distribute') && selection.length < 3)
            }
            onClick={() =>
              void controller.write('arrange_artwork', {
                artworkIds: selection,
                action: item.action,
              })
            }
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function labelFor(type: string): string {
  return (
    {
      text: 'Text',
      shape: 'Shape',
      'imported-svg': 'Vector artwork',
      'raster-image': 'Image',
      'traced-image': 'Traced image',
    }[type] ?? 'Artwork'
  );
}

export { ImportSheet } from './import-sheet';
