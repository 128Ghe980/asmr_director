"""Verify the rendered artifact independently of render-time assertions."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly


def verify(root):
    manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    clips = manifest['clips']
    dimensions = {}
    for dimension in ('sources', 'methods', 'scenes', 'modes'):
        ids = [item['id'] for item in manifest[dimension]]
        assert ids and len(ids) == len(set(ids)), f'Invalid {dimension} IDs'
        dimensions[dimension] = ids
    expected = set(itertools.product(*dimensions.values()))
    assert len(clips) == len(expected)
    keys = [(c['source'], c['method'], c['scene'], c['mode']) for c in clips]
    assert len(keys) == len(set(keys))
    assert set(keys) == expected, 'Rendered clips must cover every manifest combination'
    meter = pyln.Meter(48000)
    target = {s['id']: s['matched_target_lufs'] for s in manifest['sources']}
    report = dict(files=len(clips), dimensions={key: len(ids) for key, ids in dimensions.items()}, max_true_peak_dbtp=-999., max_matched_error_lu=0., max_stereo_ild_change_db=0., max_scaling_residual=0., checked_hashes=0, sources=[])
    loaded = {}
    for clip in clips:
        path = root/clip['file']
        assert path.resolve().is_relative_to(root.resolve())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == clip['sha256']
        x, rate = sf.read(path, always_2d=True)
        assert rate == 48000 and x.shape[1] == 2 and np.isfinite(x).all()
        assert abs(len(x)/rate-clip['duration']) < 1/rate
        assert np.max(abs(x)) < 1
        peak = 20*np.log10(np.max(abs(resample_poly(x, 4, 1, axis=0))))
        report['max_true_peak_dbtp'] = max(report['max_true_peak_dbtp'], float(peak))
        if clip['mode'] == 'matched' and clip['scene'] != 'tour':
            error = abs(meter.integrated_loudness(x)-target[clip['source']])
            report['max_matched_error_lu'] = max(report['max_matched_error_lu'], float(error))
        if clip['scene'] != 'tour':
            loaded[clip['source'], clip['method'], clip['scene'], clip['mode']] = x
        report['checked_hashes'] += 1
    for key, original in loaded.items():
        if key[-1] != 'natural':
            continue
        if 'matched' not in dimensions['modes']:
            continue
        other = loaded[key[:-1]+('matched',)]
        assert original.shape == other.shape
        scale = np.sum(original*other)/np.sum(original**2)
        residual = float(np.max(abs(other-original*scale)))
        report['max_scaling_residual'] = max(report['max_scaling_residual'], residual)
        power = np.sum(original**2, axis=0)
        if np.min(power) > 1e-14:  # hard-left baseline intentionally has a silent right channel
            ild1 = 10*np.log10(power[0]/power[1])
            power2 = np.sum(other**2, axis=0)
            ild2 = 10*np.log10(power2[0]/power2[1])
            report['max_stereo_ild_change_db'] = max(report['max_stereo_ild_change_db'], float(abs(ild2-ild1)))
    for source in manifest['sources']:
        assert hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() == source['source_sha256']
        assert hashlib.sha256((root/source['prepared_file']).read_bytes()).hexdigest() == source['prepared_sha256']
        report['sources'].append(dict(id=source['id'], input_unchanged=True, prepared_sha256=source['prepared_sha256']))
    assert report['max_true_peak_dbtp'] <= -1.98
    assert report['max_matched_error_lu'] < .1
    assert report['max_scaling_residual'] < 2e-5
    assert report['max_stereo_ild_change_db'] < .001
    evidence_key = 'room_evidence' if isinstance(manifest.get('room_evidence'), list) else 'refinement_room_evidence'
    evidence = manifest.get(evidence_key)
    assert isinstance(evidence, list) and evidence, 'Missing room evidence'
    rooms = {}
    for row in evidence:
        rooms.setdefault(row.get('method', 'room'), {})[row['scene']] = row['direct_to_reflected_db']
    for method, room in rooms.items():
        assert all(np.isfinite(value) for value in room.values()), f'Non-finite room evidence: {method}'
        if {'ear', 'front', 'far'}.issubset(dimensions['scenes']):
            assert {'ear', 'front', 'far'}.issubset(room), f'Incomplete room evidence: {method}'
            assert room['ear'] > room['front'] > room['far'], f'Unexpected distance trend: {method}'
    report[evidence_key] = evidence
    if 'refinement_room_evidence' in manifest:
        report['refinement_room_evidence'] = manifest['refinement_room_evidence']
    report['status'] = 'technical_checks_passed_listening_pending'
    (root/'verification.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    verify(parser.parse_args().output)
