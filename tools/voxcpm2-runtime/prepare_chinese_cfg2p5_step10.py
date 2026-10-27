"""Prepare four guarded cross-language trials; no models, audio changes or ASR."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

REPO=Path('D:/CodexWorkplace/asmr_director')
FOLLOWUP=Path('I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27')
QA=FOLLOWUP/'chinese-cfg2p5-step10'
TARGETS=[{'id':'chinese-rest','text':'先坐下来休息一下吧，我给你倒杯温水。'},
         {'id':'chinese-comfort','text':'今天已经很努力了，剩下的事情明天再慢慢想，好吗？'}]
ROLE_SPECS=[
    {'role':'yukinoshita','short_id':'yukino','label':'雪之下','seed':43,'gain_db':-6,
     'template':FOLLOWUP/'parameter-sweep/guarded-yukino-cfg2p5-step10.json',
     'anchor':FOLLOWUP/'parameter-sweep/generation/audio/yukino-cfg2p5-step10/japanese-paragraph/take-001/receipt.json',
     'preview':FOLLOWUP/'reference-refinement/source-previews/yukino25-gain-minus6.wav',
     'package_receipt':FOLLOWUP/'parameter-sweep/package-receipt.json',
     'source':Path('H:/comfyui/output/sd2素材/干音/1163516765-1-160.mp4'),
     'expected_input_sha':'9819886cfaac52273dbf3aec2a4b008691b36c7af5e196df5139e1fcf863bd3f'},
    {'role':'yuigahama','short_id':'yui','label':'由比滨','seed':42,'gain_db':0,
     'template':FOLLOWUP/'yui-reference-02/guarded-yui-reference-02.json',
     'anchor':FOLLOWUP/'yui-reference-02/generation/audio/yui-reference-02/japanese-paragraph/take-001/receipt.json',
     'preview':FOLLOWUP/'yui-reference-02/source-previews/yui-reference-02.wav',
     'package_receipt':FOLLOWUP/'yui-reference-02/package-receipt.json',
     'source':Path('H:/comfyui/output/sd2素材/干音/由比滨25s-02.MP3'),
     'expected_input_sha':'a1440c9b9184286a683ed9612f9b2b34fcb171f2fda525e8505b37fe33609ecb'},
]


def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()


def identity(path):return {'path':str(path),'bytes':Path(path).stat().st_size,'sha256':sha(path)}


def save(path,value):
    with path.open('x',encoding='utf-8',newline='\n') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    names=['manifest.json','design.json','preparation.json','run_guarded_asr.py']
    names += [f"guarded-{r['short_id']}-{t['id']}.json" for t in TARGETS for r in ROLE_SPECS]
    if any((QA/n).exists() for n in names):raise FileExistsError('Preparation exists; refusing overwrite')
    QA.mkdir(parents=True,exist_ok=True)
    roles={};templates={};protected={};runtime=None;profile=None
    for spec in ROLE_SPECS:
        template=read(spec['template']);anchor=read(spec['anchor']);request=anchor['request'];ref=template['references'][0]
        assert len(template['references'])==1 and (template['seed'],template['cfg'],template['timesteps'])==(spec['seed'],2.5,10)
        assert ref['mode']=='combined' and ref['promptText']==request['reference']['promptText']
        assert Path(ref['path'])==Path(request['reference']['file']['path'])
        input_id=identity(Path(ref['path']));assert input_id['sha256']==request['reference']['file']['sha256']==spec['expected_input_sha']
        assert request['parameters']=={'steps':600,'timesteps':10,'cfg':2.5,'temperature':1,'n_gpu_layers':0,'low_vram':True}
        assert anchor['status']=='complete' and anchor['exit_code']==0
        if runtime is None:runtime=request['files'];profile=request['profile']
        else:assert runtime==request['files'] and profile==request['profile']
        role={'role':spec['role'],'short_id':spec['short_id'],'label':spec['label'],'seed':spec['seed'],'cfg':2.5,'timesteps':10,
              'reference_gain_db':spec['gain_db'],'reference':ref,'input':input_id,'input_metrics':request['reference']['metrics'],
              'sourcePreviewPath':str(spec['preview']),'source_preview':identity(spec['preview']),
              'source':identity(spec['source']),'anchor_receipt':identity(spec['anchor']),'template':identity(spec['template']),
              'baseline_package_receipt':identity(spec['package_receipt'])}
        roles[spec['role']]=role;templates[spec['role']]=template
        for key in ('input','source_preview','source','anchor_receipt','template','baseline_package_receipt'):
            protected[spec['role']+'/'+key]=role[key]
    assert identity(Path(profile['path']))==profile
    protected['profile']=profile
    cases=[]
    for target in TARGETS:
        for spec in ROLE_SPECS:
            role=roles[spec['role']];template=templates[spec['role']];manifest=deepcopy(template);manifest['texts']=[target]
            compare=deepcopy(manifest);compare['texts']=template['texts'];assert compare==template
            case_id=f"{spec['short_id']}-{target['id']}";manifest_path=QA/f'guarded-{case_id}.json';save(manifest_path,manifest)
            take=QA/'generation/audio'/role['reference']['id']/target['id']/'take-001'
            cases.append({'id':case_id,'role':spec['role'],'role_label':spec['label'],'target':target,'seed':spec['seed'],'cfg':2.5,'timesteps':10,
                          'reference_id':role['reference']['id'],'reference':role['reference'],'input':role['input'],
                          'sourcePreviewPath':role['sourcePreviewPath'],'manifest':identity(manifest_path),
                          'guard_evidence_directory':str(QA/f'guard-{case_id}'),'expected_take_directory':str(take),
                          'expected_generated_wav':str(take/'generated.wav'),'status':'prepared_not_generated'})
    asr_template=FOLLOWUP/'yui-reference-02-sentences/run_guarded_asr.py'
    wrapper=asr_template.read_text(encoding='utf-8')
    assert wrapper.count("'--language', 'ja'")==1
    wrapper=wrapper.replace('Offline Japanese ASR','Offline Chinese ASR').replace("'--language', 'ja'","'--language', 'zh'")
    with (QA/'run_guarded_asr.py').open('x',encoding='utf-8',newline='\n') as f:f.write(wrapper)
    asr_script=REPO/'tools/voxcpm2-runtime/transcribe_reference_listening.py'
    asr_source=asr_script.read_text(encoding='utf-8')
    assert "parser.add_argument('--language', default='ja')" in asr_source
    assert 'language=args.language, beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=True' in asr_source
    asr={'language':'zh','beam_size':5,'temperature':0,'condition_on_previous_text':False,'vad_filter':True,
         'script':identity(asr_script),'guard_wrapper':identity(QA/'run_guarded_asr.py'),'guard_wrapper_template':identity(asr_template),
         'output':str(QA/'generated-asr.json'),'evidence_directory':str(QA/'generated-asr-guard'),
         'note':'Chinese recognition is forced as requested; ASR mismatch or possible mixed-language failure is retained without TTS retries. It cannot establish voice similarity or exclude mixed speech by itself.'}
    master={'version':1,'master_is_executable':False,'case_count':4,'roles':roles,'targets':TARGETS,'cases':cases,
            'execution_note':'Run each guarded manifest serially. Role seeds differ; this index must not be passed to the model runner.'}
    save(QA/'manifest.json',master)
    design={**master,'experiment_date_local':'2026-10-28','status':'prepared_not_generated',
            'fixed':{'cfg':2.5,'timesteps':10,'mode':'combined','parameters':{'steps':600,'timesteps':10,'cfg':2.5,'temperature':1,'n_gpu_layers':0,'low_vram':True}},
            'runtime_assets_from_accepted_anchor':runtime,'profile':profile,'generated_asr':asr,
            'generation_output_root':str(QA/'generation'),'guard':{'sample_interval_ms':50,'allow_low_start':True,'running_floor_bytes':1610612736,'shared_runtime_lock':str(Path('D:/CodexWorkplace/asmr_director_runtime/locks/voxcpm2-generation.lock'))},
            'artifact_root':'I:/AI/asmr_director/artifacts/voice-listening/japanese-160-192/chinese-cfg2p5-step10',
            'changed':'Only target text changes from each accepted role anchor. Audio, Japanese prompt, seed and generation controls are unchanged.',
            'no_automatic_redraw':True,'no_reference_processing':True,'source_asr_reused':True,'source_asr_rerun':False,
            'subjective_assessment':'awaiting generation and user listening','all_initial_results_retained':True}
    save(QA/'design.json',design)
    after={k:identity(Path(v['path'])) for k,v in protected.items()};assert after==protected
    report={'status':'prepared_not_generated','prepared_at':datetime.now(timezone.utc).isoformat(),'sources_before':protected,'sources_after':after,
            'all_source_input_profile_old_audio_hashes_preserved':True,'all_manifests_changed_text_only':True,'manifest_count':4,
            'manifests':[r['manifest'] for r in cases],'master':identity(QA/'manifest.json'),'design':identity(QA/'design.json'),'generated_asr':asr,
            'script':identity(Path(__file__)),'tts_calls':0,'asr_calls':0,'audio_conversions':0,
            'notes':['Preparation does not execute models. Root must confirm the independent review before GPU execution.',
                     'No normalization, pitch/EQ processing, Japanese prompt translation, target rewrite or seed change.']}
    save(QA/'preparation.json',report)
    print(json.dumps({'status':report['status'],'design':str(QA/'design.json'),'cases':[{k:r[k] for k in ('id','role','reference_id','seed','manifest','expected_take_directory')} for r in cases],'asr_language':'zh'},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
