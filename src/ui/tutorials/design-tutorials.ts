import type { Tutorial } from './tutorial-types';
import { DRAWING_TUTORIALS } from './drawing-tutorials';
import { GEOMETRY_TUTORIALS } from './geometry-tutorials';
import { IMAGE_TUTORIALS } from './image-tutorials';
import { IMAGE_TOOL_TUTORIALS } from './image-tool-tutorials';
import { LAYOUT_TUTORIALS } from './layout-tutorials';
import { PROJECT_TUTORIALS } from './project-tutorials';
import { STUDIO_TUTORIALS } from './studio-tutorials';
import { STUDIO_TOOL_TUTORIALS } from './studio-tool-tutorials';
import { TEXT_TUTORIALS } from './text-tutorials';

export const DESIGN_TUTORIALS: readonly Tutorial[] = [
  ...PROJECT_TUTORIALS,
  ...DRAWING_TUTORIALS,
  ...TEXT_TUTORIALS,
  ...STUDIO_TUTORIALS,
  ...STUDIO_TOOL_TUTORIALS,
  ...IMAGE_TUTORIALS,
  ...IMAGE_TOOL_TUTORIALS,
  ...GEOMETRY_TUTORIALS,
  ...LAYOUT_TUTORIALS,
];
