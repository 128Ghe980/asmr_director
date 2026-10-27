import argparse
import ctypes
import json
import os
from pathlib import Path
import sys
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
parser = argparse.ArgumentParser()
parser.add_argument('--language', default='ja')
parser.add_argument('--output', required=True)
parser.add_argument('inputs', nargs='+')
args = parser.parse_args()
lib = Path(sys.prefix) / 'Lib/site-packages/torch/lib'
os.environ['PATH'] = str(lib) + os.pathsep + os.environ['PATH']
dll_scope = os.add_dll_directory(str(lib))
for name in ['cublasLt64_12.dll', 'cublas64_12.dll', 'cudnn64_9.dll']:
    ctypes.WinDLL(str(lib / name))
from faster_whisper import WhisperModel
started = time.time()
print('Loading offline Whisper large-v3 int8_float16', flush=True)
model = WhisperModel('D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/GPT-SoVITS/tools/asr/models/faster-whisper-large-v3', device='cuda', compute_type='int8_float16', cpu_threads=2, num_workers=1, local_files_only=True)
results = {'model':'faster-whisper-large-v3', 'compute':'cuda/int8_float16', 'language':args.language, 'files':[]}
for source in args.inputs:
    segments, info = model.transcribe(source, language=args.language, beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=True)
    rows = [{'start':round(s.start,3),'end':round(s.end,3),'text':s.text,'avg_logprob':round(s.avg_logprob,4),'no_speech_prob':round(s.no_speech_prob,4)} for s in segments]
    result = {'path':source,'segments':rows,'text':''.join(s['text'] for s in rows).strip()}
    results['files'].append(result)
    results['elapsedSeconds'] = round(time.time()-started,2)
    Path(args.output).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False),flush=True)
