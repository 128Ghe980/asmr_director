"""Cross-artifact checks: original D was retained, source radiation reaches walls."""
import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from render import Profile, digest
from refine_room import refined_ir
from source_geometry import GeometryProfile


def verify(out):
    manifest = json.loads((out/'manifest.json').read_text(encoding='utf-8'))
    provenance = manifest['provenance']
    reference_file = Path(provenance['reference_manifest'])
    assert digest(reference_file) == provenance['reference_manifest_sha256']
    reference = json.loads(reference_file.read_text(encoding='utf-8'))
    guard = provenance['common_guard_delay_samples']
    checks = []
    for source in manifest['sources']:
        for scene in ('ear','front','far'):
            query = dict(source=source['id'],method='room',scene=scene,mode='natural')
            def match(clip):
                return all(clip[k]==v for k,v in query.items())
            old_clip = next(c for c in reference['clips'] if match(c))
            new_clip = next(c for c in manifest['clips'] if match(c))
            old_path = reference_file.parent/old_clip['file']
            assert digest(old_path) == old_clip['sha256']
            original,_ = sf.read(old_path,always_2d=True)
            new,_ = sf.read(out/new_clip['file'],always_2d=True)
            assert np.max(abs(new[:guard])) < 2e-7
            shifted = new[guard:]
            assert shifted.shape == original.shape
            gain = np.sum(shifted*original)/np.sum(original**2)
            error = float(np.max(abs(shifted-gain*original)))
            assert error < 2e-6, 'Original D changed beyond common delay/gain/PCM quantization'
            checks.append(dict(**query,reference_gain=gain,max_residual=error))
    profile = Profile(provenance['hrtf_path'])
    geometry = GeometryProfile(profile)
    radiation = []
    for room_refined in (False,True):
        kwargs = dict(room_refined=room_refined,source_geometry=True,voice=True,return_components=True)
        _,front,early_front,late_front = refined_ir(profile,geometry,45,.35,yaw_offset_deg=0,**kwargs)
        _,turned,early_turned,late_turned = refined_ir(profile,geometry,45,.35,yaw_offset_deg=110,**kwargs)
        assert np.sum(turned**2) < np.sum(front**2)
        assert np.max(abs(early_turned-early_front)) > 1e-6
        assert np.max(abs(late_turned-late_front)) > 1e-6
        # The room must not be just the same response times a volume scalar.
        fit = np.sum(early_turned*early_front)/np.sum(early_front**2)
        relative = np.linalg.norm(early_turned-fit*early_front)/np.linalg.norm(early_turned)
        assert relative > .05
        kwargs['voice'] = False
        a = refined_ir(profile,geometry,45,.35,yaw_offset_deg=0,**kwargs)[0]
        b = refined_ir(profile,geometry,45,.35,yaw_offset_deg=110,**kwargs)[0]
        np.testing.assert_array_equal(a,b)
        radiation.append(dict(room_refined=room_refined,direct_turn_gain_db=float(10*np.log10(np.sum(turned**2)/np.sum(front**2))),
                              reflection_non_scalar_residual=float(relative),brush_unchanged_by_yaw=True))
    report = dict(status='passed',original_d_checks=checks,radiation_checks=radiation,
                  reference_manifest_unchanged=True)
    (out/'refinement-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output',type=Path)
    verify(parser.parse_args().output)
