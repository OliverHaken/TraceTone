"""Generate golden fixtures from the v.16 reference implementation.

Run:  /Users/Alexander/miniforge3/envs/mae223/bin/python tests/gen_fixtures.py
(any Python 3 with numpy works)
"""
import json
import os
import tempfile
import types

import numpy as np

from load_reference import load

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures')
ref = load()


def P(x, y, mode='line', curv=1.0, polarity=1):
    return dict(x=float(x), y=float(y), mode=mode, curv=float(curv), polarity=polarity)


POINT_SETS = {
    'lines': [P(0, 0), P(0.5, 1), P(1, -0.5), P(2, 0.3)],
    'curves': [P(0, 0, 'curve', 0), P(0.3, 1, 'curve', 1), P(0.7, -0.4, 'curve', 2.5, -1),
               P(1.2, 0.8, 'curve', 5), P(1.6, -1, 'curve', 5, -1), P(2, 0)],
    'mixed_big': [P(0, -3), P(0.1, 12, 'curve', 1.7), P(0.15, -7.5), P(0.2, 2, 'curve', 3.3, -1), P(0.4, 0)],
    'coincident': [P(0, 0), P(0.5, 1), P(0.5, -1), P(1, 0)],
    'single': [P(0.5, 1)],
    'empty': [],
}

AUDIO_CASES = [
    dict(name='lines_plain', pts='lines', end_x=0.25, pitch=1.0, fm_rate=0.0, fm_depth=0.0),
    dict(name='curves_fm', pts='curves', end_x=0.3, pitch=1.5, fm_rate=5.0, fm_depth=0.3),
    dict(name='big_fm_deep', pts='mixed_big', end_x=0.2, pitch=0.7, fm_rate=12.5, fm_depth=0.9),
    dict(name='fast_fm', pts='curves', end_x=1.0, pitch=4.0, fm_rate=3.0, fm_depth=0.5),
    dict(name='tiny', pts='lines', end_x=0.01, pitch=4.0, fm_rate=0.0, fm_depth=0.0),
]

MIDI_CASES = [(220.0, 1.0), (330.0, 0.3), (27.5, 2.0), (5000.0, 0.001), (13.75, 20.0), (261.63, 0.5)]


def eval_cases():
    t = np.concatenate([np.linspace(-0.2, 2.2, 481), [0, 0.3, 0.5, 0.7, 1, 1.2, 1.6, 2]])
    return [dict(name=k, pts=v, t=t.tolist(), y=ref.eval_curve(v, t).tolist()) for k, v in POINT_SETS.items()]


def audio_ns(case):
    return types.SimpleNamespace(pts=POINT_SETS[case['pts']], end_x=case['end_x'], duration=2.0, cycle=False,
                                 freq=220.0, pitch=case['pitch'], fm_rate=case['fm_rate'],
                                 fm_depth=case['fm_depth'])


def load_case(data):
    """Run App.load_sound on `data` with a minimal fake self; return the resulting state."""
    lib = tempfile.mkdtemp()
    ref.LIB = lib
    with open(os.path.join(lib, 'case.json'), 'w') as f:
        json.dump(data, f)
    slider = lambda: types.SimpleNamespace(value=0)
    ns = types.SimpleNamespace(pts=[], sel=set(), uid=0, curv=1.0, snapshot=lambda: None,
                               dur_s=slider(), end_s=slider(), pitch_s=slider(), rate_s=slider(),
                               depth_s=slider(), freq_s=slider(), cycle_sw=slider(),
                               update_labels=lambda: None, update_polarity_button=lambda: None,
                               graph=types.SimpleNamespace(fit=lambda: None))
    ns.new_pt = lambda *a, **k: ref.App.new_pt(ns, *a, **k)
    ref.App.load_sound(ns, 'case')
    pts = [dict(x=p['x'], y=p['y'], mode='curve' if p['mode'] == 'curve' else 'line', curv=p['curv'],
                polarity=p['polarity']) for p in ns.pts]
    return dict(points=pts, duration=ns.duration, end_x=ns.end_x, pitch=ns.pitch, fm_rate=ns.fm_rate,
                fm_depth=ns.fm_depth, curv=ns.curv, cycle=ns.cycle, freq=ns.freq)


LOAD_CASES = [
    ('normal', dict(points=[dict(id=4, x=0.0, y=0.0, mode='line', curv=1, polarity=1),
                            dict(id=7, x=1.5, y=-2.5, mode='curve', curv=2.0, polarity=-1),
                            dict(id=2, x=0.75, y=1.25, mode='curve', curv=4.5, polarity=1)],
                    duration=1.75, end_x=1.5, pitch=1.25, fm_rate=6.5, fm_depth=0.4, curv=2.0, cycle=False,
                    freq=330.0)),
    ('minimal', dict(points=[dict(x=0, y=1), dict(x=1, y=-1)])),
    ('out_of_range', dict(points=[dict(x='0.5', y='2', mode='weird', curv=9, polarity=-3),
                                  dict(x=0.1, y=-1e3, curv=-2, polarity=0)],
                          duration=9, end_x=99, pitch=0.01, fm_rate=-3, fm_depth=2, curv=7, freq=5000,
                          cycle=True)),
    ('point_curv_missing', dict(points=[dict(x=0, y=0, mode='curve'), dict(x=1, y=1)], curv=4)),
    ('nulls', dict(points=[dict(x=0.2, y=0.1)], duration=None, end_x=None, pitch=None, freq='abc')),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'eval_curve.json'), 'w') as f:
        json.dump(eval_cases(), f)

    meta = []
    for case in AUDIO_CASES:
        y = ref.App.build_audio(audio_ns(case))
        np.asarray(y, dtype='<f8').tofile(os.path.join(OUT, case['name'] + '.f64'))
        ref.write_wav(os.path.join(OUT, case['name'] + '.wav'), y)
        ref.write_aiff(os.path.join(OUT, case['name'] + '.aiff'), y)
        meta.append(dict(case, points=POINT_SETS[case['pts']], length=len(y)))
    with open(os.path.join(OUT, 'audio_cases.json'), 'w') as f:
        json.dump(meta, f, indent=1)

    midi = []
    for i, (freq, dur) in enumerate(MIDI_CASES):
        path = os.path.join(OUT, 'midi_%d.mid' % i)
        ref.write_midi(path, freq, dur)
        midi.append(dict(file=os.path.basename(path), freq=freq, duration=dur))
    with open(os.path.join(OUT, 'midi_cases.json'), 'w') as f:
        json.dump(midi, f, indent=1)

    with open(os.path.join(OUT, 'load_cases.json'), 'w') as f:
        json.dump([dict(name=n, input=d, expected=load_case(d)) for n, d in LOAD_CASES], f, indent=1)
    print('fixtures written to', OUT)


if __name__ == '__main__':
    main()
