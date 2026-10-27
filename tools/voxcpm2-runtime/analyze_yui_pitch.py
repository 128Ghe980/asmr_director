"""Low-memory CPU pitch description; no model imports or audio-file writes."""
from datetime import datetime, timezone
import csv
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np

FOLLOWUP=Path('I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27')
OUT=FOLLOWUP/'yui-low-register'
FF=Path('D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
SR=16000
N,HOP=800,160
MIN_LAG,MAX_LAG=20,200
SUPPORT=N-MAX_LAG
FFT_N=2048
PROFILES={'strict':{'cmndf':.10,'nsdf':.90,'agreement':.04,'relative_energy_db':-25},
          'default':{'cmndf':.15,'nsdf':.85,'agreement':.06,'relative_energy_db':-30},
          'loose':{'cmndf':.20,'nsdf':.80,'agreement':.10,'relative_energy_db':-35}}
COMMANDS=[]


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    return h.hexdigest()


def identity(path):
    return {'path':str(path),'bytes':Path(path).stat().st_size,'sha256':sha(path)}


def db(power):
    return 10*math.log10(max(float(power),1e-30))


def decode(path):
    cmd=[str(FF),'-nostdin','-hide_banner','-threads','1','-filter_threads','1','-loglevel','error',
         '-i',str(path),'-map','0:a:0','-af','aresample=16000:filter_size=64:phase_shift=10:cutoff=0.97',
         '-ar','16000','-ac','1','-c:a','pcm_f32le','-f','f32le','pipe:1']
    r=subprocess.run(cmd,capture_output=True,timeout=45,creationflags=subprocess.CREATE_NO_WINDOW)
    COMMANDS.append({'command':cmd,'exit_code':r.returncode,'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr':r.stderr.decode('utf-8','replace')})
    if r.returncode:raise RuntimeError(COMMANDS[-1]['stderr'])
    return np.frombuffer(r.stdout,dtype='<f4')


def interp(values,index):
    a,b,c=values[index-1:index+2]
    den=a-2*b+c
    offset=float(np.clip(.5*(a-c)/den,-.5,.5)) if abs(den)>1e-15 else 0.
    return index+offset


def frames(audio):
    rows=[]
    lags=np.arange(MAX_LAG+1)
    win=np.hanning(N)
    freq=np.fft.rfftfreq(FFT_N,1/SR)
    hf=(freq>=4000)&(freq<7500); total=(freq>=80)&(freq<7500); flat=(freq>=500)&(freq<7500)
    for start in range(0,len(audio)-N+1,HOP):
        x=audio[start:start+N].astype(np.float64)
        x-=x.mean()
        power=float(np.mean(x*x))
        spec=np.fft.rfft(x,FFT_N)
        # Fixed-support YIN difference, unlike the varying-overlap NSDF below.
        cross=np.fft.irfft(np.conj(np.fft.rfft(x[:SUPPORT],FFT_N))*spec,FFT_N)[:MAX_LAG+1]
        cumulative=np.r_[0.,np.cumsum(x*x)]
        difference=np.maximum(cumulative[SUPPORT]+cumulative[lags+SUPPORT]-cumulative[lags]-2*cross,0.)
        cmndf=np.ones(MAX_LAG+1)
        running=np.cumsum(difference[1:])
        cmndf[1:]=np.divide(difference[1:]*lags[1:],running,out=np.ones(MAX_LAG),where=running>1e-20)
        auto=np.fft.irfft(np.conj(spec)*spec,FFT_N)[:MAX_LAG+1]
        energy=cumulative[N-lags]+cumulative[N]-cumulative[lags]
        nsdf=np.divide(2*auto,energy,out=np.zeros_like(auto),where=energy>1e-20)
        valleys=np.flatnonzero((cmndf[1:-1]<=cmndf[:-2])&(cmndf[1:-1]<cmndf[2:]))+1
        valleys=valleys[(valleys>=MIN_LAG)&(valleys<MAX_LAG)]
        peaks=np.flatnonzero((nsdf[1:-1]>nsdf[:-2])&(nsdf[1:-1]>=nsdf[2:]))+1
        peaks=peaks[(peaks>=MIN_LAG)&(peaks<MAX_LAG)&(nsdf[peaks]>0)]
        if len(peaks):
            strong=peaks[nsdf[peaks]>=.9*nsdf[peaks].max()]
            pn=int(strong[0]); fn=SR/interp(nsdf,pn); quality=float(nsdf[pn])
        else:pn=0;fn=0.;quality=0.
        weighted=np.abs(np.fft.rfft(x*win,FFT_N))**2
        high=float(weighted[hf].sum()/(weighted[total].sum()+1e-30))
        band=weighted[flat]
        flatness=float(np.exp(np.mean(np.log(band+1e-30)))/(np.mean(band)+1e-30))
        row={'start_seconds':start/SR,'center_seconds':(start+N/2)/SR,'energy_dbfs':db(power),
             'nsdf_f0_hz':fn,'nsdf_peak':quality,'high_4k_7p5k_fraction':high,'spectral_flatness_500_7500':flatness}
        for label,p in PROFILES.items():
            eligible=valleys[cmndf[valleys]<p['cmndf']]
            py=int(eligible[0]) if len(eligible) else (int(valleys[np.argmin(cmndf[valleys])]) if len(valleys) else 0)
            fy=SR/interp(cmndf,py) if py else 0.
            score=float(cmndf[py]) if py else 1.
            agreement=abs(math.log2(fy/fn)) if fy>0 and fn>0 else 99.
            # A much stronger double-period is a warning, not a forced octave fix.
            octave=False
            if py and 2*py<MAX_LAG:
                candidates=np.arange(max(MIN_LAG,2*py-2),min(MAX_LAG,2*py+3))
                longer=int(candidates[np.argmin(cmndf[candidates])])
                octave=bool(cmndf[longer]<score*.35 and score-cmndf[longer]>.002 and nsdf[longer]>nsdf[py]+.002)
            reasons=[]
            if not 85<fy<760:reasons.append('range_boundary_or_no_candidate')
            if score>=p['cmndf']:reasons.append('weak_yin_periodicity')
            if quality<p['nsdf']:reasons.append('weak_nsdf_periodicity')
            if agreement>math.log2(1+p['agreement']):reasons.append('yin_nsdf_disagree')
            if high>.55 and flatness>.20:reasons.append('hf_noise_proxy')
            if octave:reasons.append('possible_octave_ambiguity')
            row[label]={'f0_hz':fy,'yin_cmndf':score,'yin_nsdf_octaves_difference':agreement,'possible_octave_ambiguity':octave,'reasons':reasons}
        rows.append(row)
    p95=float(np.percentile([r['energy_dbfs'] for r in rows],95))
    for row in rows:
        for label,p in PROFILES.items():
            floor=max(-60.,p95+p['relative_energy_db'])
            if row['energy_dbfs']<floor:row[label]['reasons'].append('low_energy')
            row[label]['accepted']=not row[label]['reasons']
    return rows,p95


def describe(rows,label,duration,reference_q25=None):
    selected=[r for r in rows if r[label]['accepted']]
    values=np.array([r[label]['f0_hz'] for r in selected])
    result={'reliable_frames':len(values),'total_frames':len(rows),'reliable_fraction_of_frames':len(values)/len(rows),
            'reliable_voiced_seconds_by_hop':len(values)*HOP/SR,'reliable_fraction_of_full_duration':len(values)*HOP/SR/duration,
            'f0_hz_quantiles':{f'p{p}':float(np.percentile(values,p)) for p in (10,25,50,75,90)} if len(values) else None}
    rejects={}
    for row in rows:
        for reason in row[label]['reasons']:rejects[reason]=rejects.get(reason,0)+1
    result['rejection_counts_nonexclusive']=rejects
    if reference_q25 is not None:
        result['reference_p25_hz']=reference_q25
        result['fraction_below_reference_p25']=float(np.mean(values<reference_q25)) if len(values) else None
        result['seconds_below_reference_p25_by_hop']=int(np.count_nonzero(values<reference_q25))*HOP/SR
        runs=[];first=None
        for i,row in enumerate(rows+[None]):
            low=row is not None and row[label]['accepted'] and row[label]['f0_hz']<reference_q25
            if low and first is None:first=i
            elif not low and first is not None:
                count=i-first
                if count>=12:
                    span=rows[first:i]
                    runs.append({'start_seconds':span[0]['center_seconds']-.005,'end_seconds':span[-1]['center_seconds']+.005,
                                 'duration_seconds_by_hop':count*.01,'median_f0_hz':float(np.median([r[label]['f0_hz'] for r in span]))})
                first=None
        result['continuous_low_runs_at_least_120ms']=runs
    return result


def calibrate():
    tests=[]
    t=np.arange(round(.60*SR))/SR
    types={'pure':[1,0,0,0],'harmonic':[1,.5,.25,.1],'second_dominant':[.3,1,.2,.1],
           'weak_fundamental':[.05,1,.05,.1],'missing_fundamental':[0,1,.5,.25],
           'second_only':[0,1,0,0]}
    for f in (100,180,250,350,500):
        for kind,amps in types.items():
            expected=f*2 if kind=='second_only' else f
            if expected>750:continue
            phases=[0,.37,1.13,2.07]
            base=sum(a*np.sin(2*np.pi*f*(k+1)*t+phases[k]) for k,a in enumerate(amps))
            base=base*.4/max(np.max(np.abs(base)),1e-12)
            for gain in (1.,.1,.01):
                rows,_=frames((base*gain).astype(np.float32))
                vals=np.array([r['default']['f0_hz'] for r in rows if r['default']['accepted']])
                errors=np.abs(1200*np.log2(vals/expected)) if len(vals) else np.array([])
                tests.append({'kind':kind,'nominal_fundamental_hz':f,'observable_expected_f0_hz':expected,'gain':gain,
                              'accepted_fraction':len(vals)/len(rows),'median_estimated_hz':float(np.median(vals)) if len(vals) else None,
                              'median_absolute_error_cents':float(np.median(errors)) if len(vals) else None,
                              'accepted_with_error_over_100cents':int(np.count_nonzero(errors>100)),'accepted_frames':len(vals),
                              'octave_error_frames':int(np.count_nonzero((errors>1100)&(errors<1300)))})
    basic=[r for r in tests if r['kind'] in ('pure','harmonic','second_dominant','missing_fundamental','second_only')]
    stressed=[r for r in tests if r['kind']=='weak_fundamental']
    return {'tests':tests,'basic_accepted_frames':sum(r['accepted_frames'] for r in basic),
            'basic_errors_over_100cents':sum(r['accepted_with_error_over_100cents'] for r in basic),
            'basic_octave_errors':sum(r['octave_error_frames'] for r in basic),'weak_fundamental_accepted_frames':sum(r['accepted_frames'] for r in stressed),
            'weak_fundamental_errors_over_100cents':sum(r['accepted_with_error_over_100cents'] for r in stressed),
            'notes':['All signals have3 gain levels spanning40dB. Same harmonic mixture has multiple fixed phases.',
                     'Second-only signal has actual period1/(2f), so expected pitch is2f; missing-fundamental case includes harmonics2,3,4.',
                     'Synthetic tests are calibration, not a validation set for real breathy speech. YIN/NSDF share periodicity information and are not independent estimators.']}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    OUT.mkdir(parents=True,exist_ok=True)
    if (OUT/'pitch-analysis.json').exists():raise FileExistsError('Refusing overwrite')
    calibrations=calibrate()
    cases=[('reference',FOLLOWUP/'yui-reference-02/references/yui-reference-02.wav'),
           ('paragraph',FOLLOWUP/'yui-reference-02/generation/audio/yui-reference-02/japanese-paragraph/take-001/generated.wav')]
    cases += [(key,FOLLOWUP/f'yui-reference-02-sentences/generation/audio/yui-reference-02/{key}/take-001/generated.wav') for key in ('greeting','invitation','concern','shy','comfort')]
    records=[]; thresholds={}
    for key,path in cases:
        ident=identity(path);audio=decode(path);rows,p95=frames(audio);duration=len(audio)/SR
        stats={label:describe(rows,label,duration,thresholds.get(label)) for label in PROFILES}
        if key=='reference':
            thresholds={label:stats[label]['f0_hz_quantiles']['p25'] for label in PROFILES}
            stats={label:describe(rows,label,duration,thresholds[label]) for label in PROFILES}
        csvpath=OUT/(key+'-frames.csv')
        columns=['start_seconds','center_seconds','energy_dbfs','nsdf_f0_hz','nsdf_peak','high_4k_7p5k_fraction','spectral_flatness_500_7500']
        for label in PROFILES:columns += [label+'_'+k for k in ('f0_hz','yin_cmndf','yin_nsdf_octaves_difference','possible_octave_ambiguity','accepted','reasons')]
        with csvpath.open('x',encoding='utf-8',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=columns);writer.writeheader()
            for row in rows:
                flat={k:v for k,v in row.items() if k not in PROFILES}
                for label in PROFILES:
                    flat.update({label+'_'+k:';'.join(v) if isinstance(v,list) else v for k,v in row[label].items()})
                writer.writerow(flat)
        record={'id':key,'input':ident,'input_sha_unchanged':sha(path)==ident['sha256'],'analysis_samples':len(audio),'duration_seconds':duration,
                'frame_energy_p95_dbfs':p95,'energy_thresholds_dbfs':{k:max(-60.,p95+p['relative_energy_db']) for k,p in PROFILES.items()},
                'profiles':stats,'frame_csv':identity(csvpath)}
        records.append(record)
        print(json.dumps({'id':key,'default':stats['default'],'strict_p25':stats['strict']['f0_hz_quantiles'],'loose_p25':stats['loose']['f0_hz_quantiles']},ensure_ascii=False),flush=True)
    report={'status':'complete','created_at':datetime.now(timezone.utc).isoformat(),'method':{'analysis_sample_rate':SR,'frame_ms':50,'hop_ms':10,'lag_search_f0_range_hz':[80,800],
            'accepted_f0_range_hz':[85,760],'fixed_yin_support_samples':SUPPORT,'fft_size':FFT_N,'zero_padding_at_least_2N_minus1':FFT_N>=2*N-1,
            'yin':'Fixed600-sample difference and cumulative mean normalized difference; first local valley below threshold.',
            'nsdf':'Full rectangular800-sample overlapping-normalized autocorrelation; first positive peak at least90% of greatest peak.',
            'dc_removal':True,'window_for_pitch':'rectangular; Hann used only for noise proxy spectrum','profiles':PROFILES,
            'hf_noise_rejection':'4-7.5k energy fraction>0.55 AND500-7500Hz flatness>0.20','octave_handling':'Flag/reject markedly stronger double-period; no forced pitch correction or smoothing.',
            'low_runs':'Consecutive accepted low frames by10ms hop, at least120ms, interrupted by any rejected/high frame. Boundaries are frame centers±5ms.',
            'agreement_is_internal_not_independent':True},'self_calibration':calibrations,'reference_p25_hz_by_profile':thresholds,'files':records,
            'source_script':identity(Path(__file__)),'numpy_version':np.__version__,'commands':COMMANDS,'audio_files_written':0,'tts_calls':0,'asr_calls':0,'subjective_listening_performed':False,
            'limitations':['F0 is pitch of reliably periodic frames, not bass spectral energy, vocal timbre, loudness, or subjective similarity.',
                           'Different texts and sentence endings confound comparisons; overlapping frames are not independent observations.',
                           'Low/breathy phonation may be rejected, so report coverage with distributions; unvoiced frames do not have an F0.',
                           'Shared YIN/NSDF periodicity evidence can still have octave errors; calibration and sensitivity are reported without claiming clinical or phonetic ground truth.']}
    with (OUT/'pitch-analysis.json').open('x',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2,allow_nan=False)
    print(json.dumps({'report':str(OUT/'pitch-analysis.json'),'calibration':{k:v for k,v in calibrations.items() if k not in ('tests','notes')}},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
