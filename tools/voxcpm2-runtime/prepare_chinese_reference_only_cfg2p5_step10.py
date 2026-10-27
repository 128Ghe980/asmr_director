"""Prepare the requested reference-only correction without running any model."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

from prepare_chinese_cfg2p5_step10 import FOLLOWUP, identity, read, save

OLD = FOLLOWUP / 'chinese-cfg2p5-step10'
QA = FOLLOWUP / 'chinese-reference-only-cfg2p5-step10'


def main():
    old_design = read(OLD / 'design.json')
    design = deepcopy(old_design)
    protected = {}
    for role in design['roles'].values():
        for key in ('input', 'source_preview', 'source', 'anchor_receipt', 'template', 'baseline_package_receipt'):
            value = role[key]
            assert identity(Path(value['path'])) == value
            protected[role['role'] + '/' + key] = value
        assert role['reference']['mode'] == 'combined'
        role['reference']['mode'] = 'reference_only'
        del role['reference']['promptText']
    assert identity(Path(design['profile']['path'])) == design['profile']
    protected['profile'] = design['profile']
    protected['previous_design'] = identity(OLD / 'design.json')
    protected['previous_selection'] = identity(OLD / 'selection.json')
    for row in read(OLD / 'selection.json')['selections']:
        protected['previous_output/' + row['id']] = identity(Path(row['generated']['path']))
        assert protected['previous_output/' + row['id']] == row['generated']
    QA.mkdir(parents=True, exist_ok=False)
    for row in design['cases']:
        old_manifest = read(row['manifest']['path'])
        manifest = deepcopy(old_manifest)
        ref = manifest['references'][0]
        assert ref['mode'] == 'combined' and ref['promptText']
        ref['mode'] = 'reference_only'
        del ref['promptText']
        restored = deepcopy(manifest)
        restored['references'][0] = old_manifest['references'][0]
        assert restored == old_manifest
        assert {k: v for k, v in ref.items() if k != 'mode'} == {
            k: v for k, v in old_manifest['references'][0].items() if k not in ('mode', 'promptText')}
        manifest_path = QA / Path(row['manifest']['path']).name
        save(manifest_path, manifest)
        take = QA / 'generation/audio' / row['reference_id'] / row['target']['id'] / 'take-001'
        row.update(reference=ref, manifest=identity(manifest_path),
                   guard_evidence_directory=str(QA / ('guard-' + row['id'])),
                   expected_take_directory=str(take), expected_generated_wav=str(take / 'generated.wav'),
                   status='prepared_not_generated')
    wrapper = OLD / 'run_guarded_asr.py'
    wrapper_text = wrapper.read_text(encoding='utf-8')
    assert "'--language', 'zh'" in wrapper_text and "'--language', 'ja'" not in wrapper_text
    with (QA / 'run_guarded_asr.py').open('x', encoding='utf-8', newline='\n') as f:
        f.write(wrapper_text)
    design['fixed']['mode'] = 'reference_only'
    design['generated_asr'].update(guard_wrapper=identity(QA / 'run_guarded_asr.py'),
        guard_wrapper_template=identity(wrapper), output=str(QA / 'generated-asr.json'),
        evidence_directory=str(QA / 'generated-asr-guard'))
    design.update(generation_output_root=str(QA / 'generation'),
        artifact_root='I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/chinese-reference-only-cfg2p5-step10',
        changed='Correct the previous mistaken combined method: reference_only with promptText removed. Same Chinese targets, input audio, seeds and all generation parameters.',
        previous_combined_design=protected['previous_design'], prompt_text_used=False, prompt_audio_used=False,
        expected_prompt_cli_arguments=[], source_asr_reused=False,
        no_automatic_redraw=True, all_initial_results_retained=True)
    master = {key: design[key] for key in ('version', 'master_is_executable', 'case_count', 'roles', 'targets', 'cases', 'execution_note')}
    save(QA / 'manifest.json', master)
    save(QA / 'design.json', design)
    after = {key: identity(Path(value['path'])) for key, value in protected.items()}
    assert after == protected
    report = {'status': 'prepared_not_generated', 'prepared_at': datetime.now(timezone.utc).isoformat(),
        'sources_before': protected, 'sources_after': after,
        'all_source_input_profile_old_audio_hashes_preserved': True,
        'only_changes_from_previous_manifests': ['reference.mode: combined -> reference_only', 'remove reference.promptText'],
        'manifest_count': 4, 'manifests': [row['manifest'] for row in design['cases']],
        'master': identity(QA / 'manifest.json'), 'design': identity(QA / 'design.json'),
        'script': identity(Path(__file__)), 'generated_asr': design['generated_asr'],
        'tts_calls': 0, 'asr_calls': 0, 'audio_conversions': 0}
    save(QA / 'preparation.json', report)
    print(json.dumps({'status': report['status'], 'design': str(QA / 'design.json'),
        'manifests': [row['manifest']['path'] for row in design['cases']], 'mode': 'reference_only', 'asr_language': 'zh'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
