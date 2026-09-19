"""Independent artifact checks for long D trajectories and held endpoint audio."""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve

from render import FS, Profile, digest, prepare_source, room_ir


def verify(root):
    manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    p = manifest['provenance']
    original = json.loads(Path(p['reference_manifest']).read_text(encoding='utf-8'))
    assert digest(p['reference_manifest']) == p['reference_manifest_sha256']
    for filename,key in [('render.py','renderer_sha256'),('near_field.py','nearfield_sha256')]:
        assert digest(Path(__file__).with_name(filename)) == original['provenance'][key] == p['code_sha256'][filename]
    source = manifest['sources'][0]
    dry = prepare_source(source['path'],0,None)
    duration = len(dry)/FS
    assert duration == source['prepared_duration'] and duration >= 12
    asr = json.loads((root/'source-asr-evidence.json').read_text(encoding='utf-8'))
    assert asr['record']['sha256'].lower() == digest(source['path'])
    coverage = asr['record']['ordered_clause_coverage']
    clause_count = coverage['total_count']
    assert asr['record']['passed'] and coverage['all_covered_in_order']
    assert clause_count > 0 and coverage['covered_count']==clause_count
    assert not asr['record']['unexpected_repeated_12grams']
    if 'asr_clause_count' in source: assert source['asr_clause_count']==clause_count
    if 'generation_manifest' in p: assert digest(p['generation_manifest'])==p['generation_manifest_sha256']
    assert manifest['transcript']==asr['source_text']
    profile = Profile(p['hrtf_path'])
    gain = 10**(source['natural_headroom_gain_db']/20)
    reports = []
    reference_azimuth = None
    for method in manifest['methods']:
        tr = method['trajectory']
        times = np.asarray(tr['times_s'])
        azimuth = np.asarray(tr['azimuth_unwrapped_deg'])
        r = np.asarray(tr['distance_m'])
        assert times.shape == azimuth.shape == r.shape
        assert times[0]==0 and times[-1]==duration and np.all(np.diff(times)>0)
        assert max(np.diff(times))<=.10000001
        assert azimuth[0]==90 and azimuth[-1]==450 and np.all(np.diff(azimuth)>=-1e-10)
        if reference_azimuth is None: reference_azimuth = azimuth
        np.testing.assert_array_equal(azimuth,reference_azimuth)
        coordinates = np.column_stack([2+r*np.cos(np.deg2rad(azimuth)),2+r*np.sin(np.deg2rad(azimuth))])
        clearance = float(np.minimum(coordinates,6-coordinates).min())
        assert clearance >= .25-1e-10
        if method['id']=='spiral':
            assert abs(r[0]-1.75)<1e-12 and abs(r[-1]-.18)<1e-12
            assert np.all(np.diff(r)<=1e-12)
            np.testing.assert_allclose(r[times>=duration*.78],.18)
        else:
            np.testing.assert_array_equal(r,np.full_like(r,method['radius_m']))
        clip = next(c for c in manifest['clips'] if c['method']==method['id'] and c['mode']=='natural')
        actual,rate = sf.read(root/clip['file'],always_2d=True)
        assert rate == FS and len(actual)==len(dry)+round(.65*FS)
        residuals = []
        for radius,region in [(r[0],slice(0,round(1.3*FS))),(r[-1],slice(round((duration-2.4)*FS),None))]:
            h = room_ir(profile,90,float(radius))
            expected = np.column_stack([fftconvolve(dry,ear) for ear in h])
            expected = np.pad(expected,((0,1),(0,0)))
            expected[-720:] *= np.linspace(1,0,720)[:,None]
            error = float(np.max(abs(actual[region]-gain*expected[region])))
            assert error < 2e-7, 'Held portion no longer matches the original D convolution'
            residuals.append(error)
        reports.append(dict(method=method['id'],keyframes=len(times),wall_clearance_m=clearance,
            min_radius_m=float(min(r)),max_radius_m=float(max(r)),
            max_angular_speed_deg_s=float(max(np.diff(azimuth)/np.diff(times))),
            endpoint_d_reference_residuals=residuals))
    report = dict(status='passed',original_d_code_unchanged=True,source_duration_s=duration,
        source_asr_covered_clauses=clause_count,source_text_unchanged=True,trajectory_checks=reports)
    (root/'motion-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('output',type=Path)
    verify(parser.parse_args().output)
