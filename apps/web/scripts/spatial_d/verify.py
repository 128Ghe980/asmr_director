"""Optional real-data regression against the approved four original-D WAVs.

This verifier may read the offline experiment as a frozen reference. The
production renderer and its dependencies never import tools/distance-listening.
All generated test media go under the explicit --output directory.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spatial_d import render as R
from spatial_d.core import Profile, room_ir


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    reference = args.reference.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    manifest = json.loads((reference/'manifest.json').read_text(encoding='utf-8'))
    root = Path(__file__).resolve().parents[4]
    originals = root/'tools/distance-listening'
    frozen = manifest['provenance']['code_sha256']
    for name in ('render.py', 'near_field.py', 'motion_convolution.py', 'long_motion.py'):
        if R.digest(originals/name) != frozen[name]:
            raise AssertionError('frozen original changed: '+name)
    sys.path.insert(0, str(originals))
    spec = importlib.util.spec_from_file_location('original_distance_reference', originals/'render.py')
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    source = Path(manifest['sources'][0]['path'])
    hrtf = Path(manifest['provenance']['hrtf_path'])
    assert R.digest(source) == manifest['sources'][0]['source_sha256']
    assert R.digest(hrtf) == manifest['provenance']['hrtf_sha256']
    prepared, _ = R.prepare_audio(source)
    old_prepared = old.prepare_source(source, 0, None)
    prep_error = float(np.max(np.abs(prepared-old_prepared)))
    assert prep_error < 1e-14
    profile, old_profile = Profile(hrtf), old.Profile(hrtf)
    impulse_records = []
    for az, radius in ((0, .18), (90, .18), (270, .35), (180, .5), (30, .8), (45, 1.75), (220, 1.4)):
        error = float(np.max(np.abs(room_ir(profile, az, radius)-old.room_ir(old_profile, az, radius))))
        assert error < 1e-14
        impulse_records.append(dict(azimuth_deg=az, distance_m=radius, max_abs_error=error))
    rows = []
    for method, distance, movement in (('orbit_near', 'very_close', 'orbit'), ('orbit_mid', 'mid', 'orbit'), ('orbit_far', 'far', 'orbit'), ('spiral', 'very_close', 'orbit_approach')):
        folder = output/method
        folder.mkdir()
        request = dict(version=1, inputWav=str(source), outputWav=str(folder/'output.wav'), outputJson=str(folder/'output.json'),
                       hrtfPath=str(hrtf), position=dict(pan=-1, distance=distance, movement=movement))
        request_path = folder/'request.json'
        request_path.write_text(json.dumps(request), encoding='utf-8')
        command = [sys.executable, '-B', str(Path(__file__).with_name('render.py')), '--request', str(request_path)]
        run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        (folder/'cli.log').write_text(run.stdout, encoding='utf-8')
        assert run.returncode == 0, run.stdout
        actual, rate = sf.read(request['outputWav'], always_2d=True)
        chosen = next(row for row in manifest['clips'] if row['method'] == method and row['mode'] == 'natural')
        expected_path = reference/chosen['file']
        assert R.digest(expected_path) == chosen['sha256']
        expected, expected_rate = sf.read(expected_path, always_2d=True)
        assert rate == expected_rate == 48000 and actual.shape == expected.shape
        error = float(np.max(np.abs(actual-expected)))
        assert error < 2e-7, (method, error)
        report = json.loads(Path(request['outputJson']).read_text(encoding='utf-8'))
        expected_route = next(row['trajectory'] for row in manifest['methods'] if row['id'] == method)
        for key in ('times_s', 'azimuth_unwrapped_deg', 'distance_m'):
            np.testing.assert_allclose(report['trajectory'][key], expected_route[key], atol=1e-12, rtol=0)
        rows.append(dict(method=method, command=command, duration=report['duration'], max_abs_error=error,
                         identical_pcm_samples=bool(np.array_equal(actual, expected)), output_sha256=report['sha256'],
                         reference_sha256=chosen['sha256'], true_peak_dbtp=report['true_peak_dbtp'],
                         headroom_gain=report['any_headroom_gain'], wall_seconds=report['wall_seconds']))
        print(json.dumps(rows[-1]), flush=True)
    result = dict(passed=True, reference=str(reference), reference_manifest_sha256=R.digest(reference/'manifest.json'),
                  preparation_max_abs_error=prep_error, original_code_sha256=frozen,
                  impulse_regressions=impulse_records, clips=rows)
    (output/'verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print('All original-D regressions passed.', flush=True)


if __name__ == '__main__':
    main()
