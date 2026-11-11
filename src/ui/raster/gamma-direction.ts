// Which way an image's Gamma moves the midtones (ADR-671 Amendment 1).
//
// The engrave-stage tone curve raises each level to 1/gamma
// (core/raster/luma-adjust.ts), so a higher gamma lightens the midtones, as
// Levels does in Photoshop and GIMP. LightBurn's Shape Properties Gamma runs
// the other way, so a value copied from a LightBurn guide burns the opposite
// of what it asked for. Every field that edits the value says so.

export const IMAGE_GAMMA_DIRECTION_HINT =
  "Higher gamma lightens midtones, lower darkens them (as in Photoshop and GIMP Levels). LightBurn's Gamma runs the other way: there, higher darkens.";
