"""Decode KerfDesk .rd bytes with meerk40t's real RDJob (rdjob.py @7e82652f) and report
(1) meerk40t's description of every command and (2) the speed/power meerk40t's job model
attaches to the cuts it plots (what its emulator would hand to a laser driver)."""
import json, sys
import m40t
r = m40t.rdjob

class Identity:
    def transform_point(self, p):
        return p

class FakeDriver:
    def __init__(self):
        self.plots = []
        self.started = 0
    def plot(self, plot):
        self.plots.append(plot)
    def plot_start(self):
        self.started += 1

def decode(hexstr, magic=0x88):
    data = bytes.fromhex(hexstr)
    lines = []
    drv = FakeDriver()
    job = r.RDJob(driver=drv, units_to_device_matrix=Identity(), channel=lines.append, magic=magic)
    job.write_blob(data, magic=magic)
    while job.buffer:
        try:
            job.execute()
        except Exception as e:  # report, keep going
            lines.append(f'!! {type(e).__name__}: {e}')
    plots = []
    for p in drv.plots:
        pts = list(p.plot)
        plots.append({'settings': dict(p.settings), 'points': [tuple(t) for t in pts]})
    return lines, plots, drv.started, job

if __name__ == '__main__':
    dump = json.load(open(sys.argv[1]))
    keys = sys.argv[2:] or [k for k in dump if isinstance(dump[k], str)]
    for key in keys:
        print(f'===== {key}')
        lines, plots, started, job = decode(dump[key])
        for l in lines:
            print('  ', l)
        print('  -- plots handed to driver (meerk40t job model):')
        for p in plots:
            print('    settings=', p['settings'], 'points=', p['points'])
        print('  -- driver.plot_start calls:', started, ' final job.power=', job.power, ' job.speed=', job.speed,
              ' power1_min/max=', job.power1_min, job.power1_max)
