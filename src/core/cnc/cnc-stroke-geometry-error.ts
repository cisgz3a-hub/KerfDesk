/** A trusted stroke could not be represented; its centreline is never a filled fallback. */
export class CncStrokeGeometryError extends Error {
  constructor(objectId: string, pathIndex: number) {
    super(
      `V-carve could not represent the stroke geometry of object "${objectId}", path ${pathIndex + 1}. ` +
        'Adjust its scale or stroke geometry before generating output.',
    );
    this.name = 'CncStrokeGeometryError';
  }
}
