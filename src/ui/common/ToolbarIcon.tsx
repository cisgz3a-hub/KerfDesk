import box from 'lucide-static/icons/box.svg?raw';
import brush from 'lucide-static/icons/brush.svg?raw';
import camera from 'lucide-static/icons/camera.svg?raw';
import eye from 'lucide-static/icons/eye.svg?raw';
import fileCode from 'lucide-static/icons/file-code-2.svg?raw';
import fileDown from 'lucide-static/icons/file-down.svg?raw';
import filePlus from 'lucide-static/icons/file-plus-2.svg?raw';
import folderOpen from 'lucide-static/icons/folder-open.svg?raw';
import imageDown from 'lucide-static/icons/image-down.svg?raw';
import imagePlus from 'lucide-static/icons/image-plus.svg?raw';
import keyboard from 'lucide-static/icons/keyboard.svg?raw';
import save from 'lucide-static/icons/save.svg?raw';
import saveAll from 'lucide-static/icons/save-all.svg?raw';
import scanLine from 'lucide-static/icons/scan-line.svg?raw';
import squareDashedPointer from 'lucide-static/icons/square-dashed-mouse-pointer.svg?raw';
import typeIcon from 'lucide-static/icons/type.svg?raw';
import wandSparkles from 'lucide-static/icons/wand-sparkles.svg?raw';
import type { CommandId } from '../commands/command-registry';

export type ToolbarIconKey = CommandId | 'shortcuts';

const TOOLBAR_ICONS: Partial<Readonly<Record<ToolbarIconKey, string>>> = {
  'file.new': filePlus,
  'file.open': folderOpen,
  'file.save': save,
  'file.save-as': saveAll,
  'file.import-svg': fileCode,
  'file.import-image': imagePlus,
  'tools.add-text': typeIcon,
  'tools.registration-jig': scanLine,
  'tools.camera': camera,
  'tools.place-board': squareDashedPointer,
  'tools.box-generator': box,
  'tools.trace-image': wandSparkles,
  'tools.edit-image': brush,
  'tools.convert-to-bitmap': imageDown,
  'file.save-gcode': fileDown,
  'window.toggle-preview': eye,
  shortcuts: keyboard,
};

export function ToolbarIcon(props: { readonly icon: ToolbarIconKey }): JSX.Element | null {
  const svg = TOOLBAR_ICONS[props.icon];
  if (svg === undefined) return null;
  // Every string is a pinned lucide-static build asset, never user-provided markup.
  return (
    <span
      className="lf-toolbar-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
