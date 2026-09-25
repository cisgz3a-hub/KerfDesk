"""Build meerk40t's own Ruida byte stream for the same two-layer job KerfDesk encodes in
_explore-rd-dump.test.ts (TWO_LAYER), using rdjob.RDJob's writer API in the order
RuidaDriver.plot_start / _move use it (driver.py L165-304, L541-567 @7e82652f).
Coordinates are native µm, as meerk40t's Ruida view uses (dpi = uM_PER_INCH)."""
import json, sys
import m40t
from meerk40t.core.cutcode.linecut import LineCut
r = m40t.rdjob

def build(layers, magic=0x88):
    job = r.RDJob(magic=magic)
    queue = []
    for L in layers:
        settings = {'speed': L['speed_mm_s'], 'power': L['power_pct'] * 10, 'line_color': L['color']}
        pts = L['points']
        segs = list(zip(pts, pts[1:]))
        for (a, b) in segs:
            queue.append(LineCut(a, b, settings=settings))
    job.write_header(queue)
    native = [0, 0]
    first = True
    last_settings = None
    cur_power = None
    power = None
    for q in queue:
        s = q.settings
        if s is not last_settings:
            job.write_settings(s)
            last_settings = s
            power_dirty = True
        start = q.start
        if first or tuple(native) != tuple(start):
            # _move(start, cut=False)
            job.jump(start[0], start[1], start[0] - native[0], start[1] - native[1])
            native = list(start)
            first = False
        # _move(end, cut=True): power/speed dirty handling (on_value = 1.0)
        power = s['power']
        if power != cur_power:
            job.max_power_1(power / 10.0)
            job.min_power_1(power / 10.0)
            cur_power = power
        end = q.end
        job.mark(end[0], end[1], end[0] - native[0], end[1] - native[1])
        native = list(end)
    job.write_tail()
    return job.get_contents()

TWO_LAYER = [
    {'speed_mm_s': 50.0, 'power_pct': 20.0, 'color': 0x0000FF,  # meerk40t packs color as int; red in low byte
     'points': [(10000, 10000), (20000, 10000), (20000, 20000), (10000, 20000), (10000, 10000)]},
    {'speed_mm_s': 5.0, 'power_pct': 80.0, 'color': 0xFF0000,
     'points': [(50000, 10000), (60000, 30000)]},
]

if __name__ == '__main__':
    raw = build(TWO_LAYER)
    sw = r.encode_bytes(raw, magic=0x88)
    json.dump({'m40tTwoLayer': sw.hex()}, open(sys.argv[1], 'w'), indent=2)
    print('wrote', len(sw), 'bytes')
