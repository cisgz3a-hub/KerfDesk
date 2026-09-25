"""Load meerk40t's real ruida/rdjob.py (rev 7e82652f) with the numpy-only raster module stubbed."""
import sys, types
UP = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/upstream/meerk40t'
sys.path.insert(0, UP)
stub = types.ModuleType('meerk40t.core.cutcode.rastercut')
class RasterCut:  # only used for isinstance() checks in rdjob
    pass
stub.RasterCut = RasterCut
sys.modules['meerk40t.core.cutcode.rastercut'] = stub
import meerk40t.ruida.rdjob as rdjob  # noqa: E402
