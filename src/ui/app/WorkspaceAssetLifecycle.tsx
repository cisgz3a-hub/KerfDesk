import { useLayoutEffect, useRef } from 'react';
import { startPagedAssetReconciliation } from '../import/paged-asset-startup';
import { watchPagedRasterOwnership } from '../import/paged-raster-ownership-watch';

/** Project storage belongs to the admitted workspace, not the licence window. */
export function WorkspaceAssetLifecycle(): null {
  const reconciled = useRef(false);
  // The root mounts this before App: observe ownership before its mount effects.
  useLayoutEffect(() => {
    if (!reconciled.current) {
      reconciled.current = true;
      startPagedAssetReconciliation();
    }
    return watchPagedRasterOwnership();
  }, []);
  return null;
}
