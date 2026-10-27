"""Prepare the CFG 2 / 20-step Chinese comparison without running models."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

from prepare_chinese_cfg2p5_step10 import FOLLOWUP, identity, read, save

OLD = FOLLOWUP / 'chinese-reference-only-cfg2p5-step10'
QA = FOLLOWUP / 'chinese-reference-only-cfg2-step20'


def main():
    design = deepcopy(read(OLD / 'design.json'))
    protected = {}
    for role in design['roles'].values():
        for key in ('input', 'source_preview', 'source', 'anchor_receipt', 'template', 'baseline_package_receipt'):
            value = role[key]
            assert identity(Path(value['path'])) == value
            protected[role['role'] + '/' + key] = value
        assert role['reference']['mode'] == 'reference_only' and 'promptText' not in role['reference']
        role.update(cfg=2.0, timesteps=20)
    assert identity(Path(design['profile']['path'])) == design['profile']
    protected['profile'] = design['profile']
    protected['previous_design'] = identity(OLD / 'design.json')
    protected['previous_selection'] = identity(OLD / 'selection.json')
    for row in read(OLD / 'selection.json')['selections']:
        value = identity(Path(row['generated']['path']))
        assert value == row['generated']
        protected['previous_output/' + row['id']] = value
    QA.mkdir(parents=True, exist_ok=False)
    for row in design['cases']:
        old_manifest = read(row['manifest']['path'])
        manifest = deepcopy(old_manifest)
        assert (manifest['cfg'], manifest['timesteps']) == (2.5, 10)
        assert manifest['references'][0]['mode'] == 'reference_only'
        assert 'promptText' not in manifest['references'][0]
        manifest.update(cfg=2.0, timesteps=20)
        restored = deepcopy(manifest)
        restored.update(cfg=2.5, timesteps=10)
        assert restored == old_manifest
        manifest_path = QA / Path(row['manifest']['path']).name
        save(manifest_path, manifest)
        take = QA / 'generation/audio' / row['reference_id'] / row['target']['id'] / 'take-001'
        row.update(cfg=2.0, timesteps=20, manifest=identity(manifest_path),
            guard_evidence_directory=str(QA / ('guard-' + row['id'])),
            expected_take_directory=str(take), expected_generated_wav=str(take / 'generated.wav'),
            status='prepared_not_generated')
    wrapper = OLD / 'run_guarded_asr.py'
    wrapper_text = wrapper.read_text(encoding='utf-8')
    assert "'--language', 'zh'" in wrapper_text
    with (QA / 'run_guarded_asr.py').open('x', encoding='utf-8', newline='\n') as f:
        f.write(wrapper_text)
    design['fixed'].update(cfg=2.0, timesteps=20)
    design['fixed']['parameters'].update(cfg=2.0, timesteps=20)
    design['generated_asr'].update(guard_wrapper=identity(QA / 'run_guarded_asr.py'),
        guard_wrapper_template=identity(wrapper), output=str(QA / 'generated-asr.json'),
        evidence_directory=str(QA / 'generated-asr-guard'))
    design.update(generation_output_root=str(QA / 'generation'),
        artifact_root='I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/chinese-reference-only-cfg2-step20',
        changed='Change CFG 2.5 -> 2.0 and timesteps 10 -> 20 only. Same complete audio inputs, gain branches, seeds, Chinese targets and reference_only mode; no prompt text/audio.',
        previous_reference_only_design=protected['previous_design'],
        reference_ids_are_stable_routing_ids=True,
        comparison_is_two_parameter_change=True)
    master = {key: design[key] for key in ('version', 'master_is_executable', 'case_count', 'roles', 'targets', 'cases', 'execution_note')}
    save(QA / 'manifest.json', master)
    save(QA / 'design.json', design)
    after = {key: identity(Path(value['path'])) for key, value in protected.items()}
    assert after == protected
    report = {'status': 'prepared_not_generated', 'prepared_at': datetime.now(timezone.utc).isoformat(),
        'sources_before': protected, 'sources_after': after,
        'all_source_input_profile_old_audio_hashes_preserved': True,
        'only_changes_from_previous_manifests': ['cfg: 2.5 -> 2.0', 'timesteps: 10 -> 20'],
        'manifest_count': 4, 'manifests': [row['manifest'] for row in design['cases']],
        'master': identity(QA / 'manifest.json'), 'design': identity(QA / 'design.json'),
        'script': identity(Path(__file__)), 'generated_asr': design['generated_asr'],
        'tts_calls': 0, 'asr_calls': 0, 'audio_conversions': 0}
    save(QA / 'preparation.json', report)
    print(json.dumps({'status': report['status'], 'design': str(QA / 'design.json'),
        'manifest_count': 4, 'cfg': 2.0, 'timesteps': 20, 'mode': 'reference_only', 'asr_language': 'zh'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
