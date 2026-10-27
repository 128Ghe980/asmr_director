"""Read-only waveform/processing-chain diagnosis. Writes JSON, never audio or models."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np

ROOT = Path('I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27')
OUT = ROOT / 'input-clarity/diagnosis.json'
FF = Path('D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
FILTER = 'pan=mono|c0=0.5*c0+0.5*c1,aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97'
COMMANDS = []
BANDS = [(0,4000),(4000,6000),(6000,7000),(7000,7500),(7500,8000),(8000,12000),(12000,20000),(20000,22050)]


def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))


def sha(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024), b''):
            h.update(b)
    return h.hexdigest()


def identity(p):
    return {'path':str(p),'bytes':Path(p).stat().st_size,'sha256':sha(p)}


def run(args, data=None):
    cmd = [str(FF),'-nostdin','-hide_banner','-threads','1','-filter_threads','1','-loglevel','error',*args]
    p = subprocess.run(cmd,input=data,capture_output=True,timeout=60,creationflags=subprocess.CREATE_NO_WINDOW)
    COMMANDS.append({'command':cmd,'exit_code':p.returncode,'stdin_sha256':hashlib.sha256(data).hexdigest() if data else None,
                     'stdout_sha256':hashlib.sha256(p.stdout).hexdigest(),'stderr':p.stderr.decode('utf-8','replace')})
    if p.returncode:
        raise RuntimeError(COMMANDS[-1]['stderr'])
    return p.stdout


def decode(p, channels, extra=()):
    return np.frombuffer(run(['-i',str(p),'-map','0:a:0',*extra,'-c:a','pcm_f32le','-f','f32le','pipe:1']),dtype='<f4').reshape(-1,channels)


def process(a, rate, filt=None, codec='pcm_f32le'):
    cmd=['-f','f32le','-ar',str(rate),'-ac',str(a.shape[1]),'-i','pipe:0']
    if filt:
        cmd += ['-af',filt]
    return run(cmd+['-c:a',codec,'-f',{'pcm_f32le':'f32le','pcm_s16le':'s16le','pcm_s24le':'s24le'}[codec],'pipe:1'],a.astype('<f4').tobytes())


def db(a, power=False):
    return (10 if power else 20)*math.log10(float(a)) if a>0 else None


def stats(a,rate):
    a=a.astype(np.float64)
    return {'frames':len(a),'channels':a.shape[1],'sample_rate':rate,'duration_seconds':len(a)/rate,
            'rms_dbfs':db(np.mean(a*a),True),'peak_dbfs':db(np.max(np.abs(a))),
            'samples_at_or_above_fullscale':int(np.count_nonzero(np.abs(a)>=1))}


def compare(a,b):
    assert a.shape==b.shape
    a,b=a.astype(np.float64),b.astype(np.float64)
    gain=float(np.sum(a*b)/np.sum(a*a))
    err=b-a*gain
    return {'exact_samples':bool(np.array_equal(a,b)),'fit_gain_db':db(gain),
            'max_abs_residual':float(np.max(np.abs(err))),'residual_rms_dbfs':db(np.mean(err*err),True),
            'max_abs_difference':float(np.max(np.abs(a-b)))}


def spectrum(a,rate,masks):
    n=round(.04*rate); hop=round(.02*rate); win=np.hanning(n)
    freq=np.fft.rfftfreq(n,1/rate); weights=np.full(len(freq),2.); weights[[0,-1]]=1
    band_masks=[(freq>=lo)&(freq<hi) for lo,hi in BANDS]
    powers=[]
    for start in range(0,len(a)-n+1,hop):
        z=np.abs(np.fft.rfft(a[start:start+n]*win))**2*weights/(n*np.sum(win*win))
        powers.append([z[m].sum() for m in band_masks])
    powers=np.array(powers)
    result={}
    for group,mask in masks.items():
        sums=powers[mask].sum(axis=0); total=float(sums.sum())
        result[group]={'frames':int(mask.sum()),'bands':{f'{lo}-{hi}':{'power':float(p),'fraction':float(p/total) if total else None} for (lo,hi),p in zip(BANDS,sums)},
                       'above_8k_fraction':float(sums[5:].sum()/total) if total else None}
    return result


def main():
    if OUT.exists():
        raise FileExistsError('Refusing to overwrite existing diagnosis')
    prep=read(ROOT/'yukino-length/preparation.json')
    base=next(r for r in prep['references'] if r['id'].endswith('25p10s'))
    variants=read(ROOT/'reference-refinement/reference-variants.json')
    variant=next(r for r in variants['references'] if r['id']=='yukino25-gain-minus6')
    paths={'original_model':Path(base['model']['path']),'original_preview':Path(base['source_preview']['path']),
           'minus6_model':Path(variant['model']['path']),'minus6_preview':Path(variant['source_preview']['path']),
           'shared_source_float':Path(prep['source_prefix_float']['path']),
           'old_opening_float':Path(prep['previous_float_source']['path'])}
    before={k:identity(p) for k,p in paths.items()}
    data={k:decode(p,1 if k.endswith('model') else 2) for k,p in paths.items()}
    source=data['shared_source_float'][:1106910]
    fresh=decode(prep['source']['path'],2,('-vn','-t','26.2','-ar','44100','-ac','2'))[:len(data['shared_source_float'])]
    prefix={'fresh_source_decode_equals_retained_float':bool(np.array_equal(fresh,data['shared_source_float'])),
            'old_6p85s_equals_same_prefix':bool(np.array_equal(source[:len(data['old_opening_float'])],data['old_opening_float'])),
            'source_current':identity(prep['source']['path'])}
    del fresh
    converted=np.frombuffer(process(source,44100,FILTER),dtype='<f4').reshape(-1,1)[:401600]
    model_pcm=process(converted,16000,f"volume={base['model_static_gain']:.15g}:precision=double",'pcm_s16le')
    model_replica=np.frombuffer(model_pcm,dtype='<i2').astype(np.float32).reshape(-1,1)/32768
    gain_float=np.frombuffer(process(data['original_model'],16000,'volume=-6dB:precision=double'),dtype='<f4').reshape(-1,1)
    gain_pcm=process(gain_float,16000,codec='pcm_s16le')
    gain_replica=np.frombuffer(gain_pcm,dtype='<i2').astype(np.float32).reshape(-1,1)/32768
    reproducibility={'original_model_from_shared_float':compare(data['original_model'],model_replica),
                     'minus6_model_from_original':compare(data['minus6_model'],gain_replica),
                     'original_to_minus6_model':compare(data['original_model'],data['minus6_model']),
                     'original_to_minus6_preview':compare(data['original_preview'],data['minus6_preview']),
                     'shared_float_to_original_preview':compare(source,data['original_preview'])}
    preview=data['minus6_preview'].astype(np.float64); mid=preview.mean(axis=1); side=(preview[:,0]-preview[:,1])*.5
    n=1764; hop=882
    frame_power=np.array([np.mean(mid[s:s+n]**2) for s in range(0,len(mid)-n+1,hop)])
    p95=np.percentile(frame_power,95)
    masks={'all':np.ones(len(frame_power),bool),'energy_active':frame_power>=p95*10**(-25/10),'energy_quiet':frame_power<=p95*10**(-40/10)}
    spectra={k:spectrum(a,rate,masks) for k,a,rate in [
        ('preview_left',preview[:,0],44100),('preview_right',preview[:,1],44100),('preview_mid',mid,44100),('preview_side',side,44100),
        ('model',data['minus6_model'][:,0].astype(np.float64),16000)]}
    channel_info={'left_right_correlation':float(np.corrcoef(preview[:,0],preview[:,1])[0,1]),
                  'side_to_mid_power_db':db(np.mean(side*side)/np.mean(mid*mid),True),
                  'mono_average_vs_average_channel_power_db':db(np.mean(mid*mid)/np.mean(preview*preview),True),
                  'bands':{}}
    common_response={}
    gain_difference=base['model_static_gain_db']-base['preview_static_gain_db']
    for band in spectra['preview_mid']['all']['bands']:
        m=spectra['preview_mid']['energy_active']['bands'][band]['power']
        lr=(spectra['preview_left']['energy_active']['bands'][band]['power']+spectra['preview_right']['energy_active']['bands'][band]['power'])/2
        channel_info['bands'][band]=db(m/lr,True) if lr else None
        x=spectra['model']['energy_active']['bands'][band]['power']
        if int(band.split('-')[1])<=8000:
            common_response[band]=db(x/m,True)-gain_difference if x and m else None
    frequencies=[1000,4000,6000,7000,7400,7500,7600,7700,7800,7900,8100,8200,8500,9000,10000]
    tone=np.concatenate([.1*np.sin(2*np.pi*f*np.arange(13230)/44100) for f in frequencies]).astype('<f4').reshape(-1,1)
    response=np.frombuffer(process(tone,44100,'aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97'),dtype='<f4')
    tone_response={str(f):db(np.mean(response[i*4800+1600:i*4800+3200].astype(np.float64)**2)/.005,True) for i,f in enumerate(frequencies)}
    package=read(ROOT/'parameter-sweep/package-receipt.json')
    delivered=package['references']['yukinoshita']
    delivery={}
    for key in ('source','original','matched','model_input'):
        if key in delivered:
            delivery[key]={**identity(delivered[key]['path']),'matches_package_sha256':sha(delivered[key]['path'])==delivered[key]['sha256']}
    delivery['actual_model_input_matches_minus6_model']=delivery['model_input']['sha256']==before['minus6_model']['sha256']
    delivery['original_preview_matches_minus6_preview']=delivery['original']['sha256']==before['minus6_preview']['sha256']
    report={'status':'measured','created_at':datetime.now(timezone.utc).isoformat(),'scope':'read-only audio/source diagnosis; no subjective audition or inference',
            'inputs':before,'current_hashes_unchanged':all(sha(p)==before[k]['sha256'] for k,p in paths.items()),
            'input_metrics':{k:stats(a,16000 if k.endswith('model') else 44100) for k,a in data.items()},
            'original_source_unchanged':prefix['source_current']['sha256']==prep['source']['sha256'],
            'prefix_verification':prefix,'reproducibility':reproducibility,
            'processing_chain':{'filter':FILTER,'model_initial_gain_db':base['model_static_gain_db'],'preview_initial_gain_db':base['preview_static_gain_db'],
                                'variant_gain_db':-6,'branch_initial_gain_difference_db':gain_difference,'denoise':False,'variant_filters':[variant['filter']],
                                'model_minus6_rms_minus_preview_minus6_rms_db':stats(data['minus6_model'],16000)['rms_dbfs']-stats(preview,44100)['rms_dbfs']},
            'stereo_to_mono':channel_info,'spectra':spectra,'band_response_compensated_for_known_gain_db':common_response,
            'resampler_synthetic_tone_response_db':tone_response,'delivery_reference_verification':delivery,
            'method':{'frame_seconds':.04,'hop_seconds':.02,'window':'Hann','frequency_resolution_hz':25,
                      'active_threshold_db_below_source_p95':25,'quiet_threshold_db_below_source_p95':40,
                      'thresholds_are_energy_proxies_not_speech_labels':True,'resampler_tones':'0.3s sine each, middle 0.1s RMS; RAM only; above Nyquist measures residual alias output'},
            'source_evidence':[identity(Path(__file__)),identity(Path('tools/voxcpm2-runtime/prepare_yukino_length_references.py')),
                               identity(Path('tools/voxcpm2-runtime/prepare_reference_refinements.py')),identity(ROOT/'yukino-length/preparation.json'),identity(ROOT/'reference-refinement/reference-variants.json')],
            'commands':COMMANDS,'audio_files_written':0,'model_runs':0,'subjective_listening_performed':False}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    with OUT.open('x',encoding='utf-8') as f:
        json.dump(report,f,ensure_ascii=False,indent=2,allow_nan=False)
    print(json.dumps({'report':str(OUT),'reproducibility':reproducibility,'stereo':channel_info,'above8k_active':spectra['preview_mid']['energy_active']['above_8k_fraction'],
                      'response':common_response,'synthetic_response':tone_response,'delivery':delivery},ensure_ascii=False))


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
