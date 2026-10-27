"""Read-only audio measurements for reference refinement; no model imports."""
from datetime import datetime, timezone
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys

import numpy as np


QA = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
OUT = QA / "reference-refinement/diagnosis"
FF = Path("D:/CodexWorkplace/asmr_director_runtime/engines/gpt-sovits/env-comfyui-clone/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe")
COMMANDS = []
BANDS = [(0, 200), (200, 1000), (1000, 4000), (4000, 6000), (6000, 7500),
         (7500, 8000), (8000, 12000), (12000, 20000)]


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024*1024), b""):
            h.update(block)
    return h.hexdigest()


def run(args):
    command = [str(FF), "-nostdin", "-hide_banner", *args]
    result = subprocess.run(command, capture_output=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    COMMANDS.append({"command": command, "exit_code": result.returncode,
                     "stderr": result.stderr.decode("utf-8", "replace")})
    if result.returncode:
        raise RuntimeError(COMMANDS[-1]["stderr"])
    return result


def db(value, power=False):
    return (10 if power else 20)*math.log10(float(value)) if value > 0 else None


def inventory():
    length = read(QA / "yukino-length/preparation.json")
    previous = read(QA / "yukinoshita-diagnosis/final_outputs.json")
    cases = [
        ("yukino-6p85-reference", "reference", "yukino", Path("I:/AI/asmr_director/runtime/voice-references/japanese-characters/yukinoshita-160-v2/reference.wav"), 16000, 1),
        ("yukino-6p85-preview", "preview", "yukino", Path(previous["source_preview_pcm24"]["path"]), 44100, 2),
        ("yui-12p64-reference", "reference", "yui", Path("I:/AI/asmr_director/runtime/voice-references/japanese-characters/yuigahama-192-mp3/reference.wav"), 16000, 1),
        ("yui-12p64-preview", "preview", "yui", QA / "yui-mp3-original-44100-stereo.wav", 44100, 2),
    ]
    for label, row in zip(("17p30", "25p10"), length["references"]):
        cases += [(f"yukino-{label}-reference", "reference", "yukino", Path(row["model"]["path"]), 16000, 1),
                  (f"yukino-{label}-preview", "preview", "yukino", Path(row["source_preview"]["path"]), 44100, 2)]
    for label, role, path in [
        ("yukino-6p85-output", "yukino", QA / "japanese-generation/audio/yukinoshita-160-v2-combined/japanese-paragraph/take-001/receipt.json"),
        ("yukino-17p30-output", "yukino", QA / "yukino-length/generation/audio/yukinoshita-160-17p30s-combined/japanese-paragraph/take-001/receipt.json"),
        ("yukino-25p10-output", "yukino", QA / "yukino-length/generation/audio/yukinoshita-160-25p10s-combined/japanese-paragraph/take-001/receipt.json"),
        ("yui-12p64-output", "yui", QA / "japanese-generation/audio/yuigahama-192-mp3-full-combined/japanese-paragraph/take-001/receipt.json"),
    ]:
        receipt = read(path)
        if receipt["status"] != "complete":
            raise ValueError("Expected completed native output")
        cases.append((label, "output", role, Path(receipt["output"]["path"]), 48000, 1))
    return cases


def analyze(case):
    identifier, kind, role, path, rate, channels = case
    before = sha(path)
    decoded = run(["-loglevel", "error", "-i", str(path), "-map", "0:a:0", "-ar", str(rate),
                   "-ac", str(channels), "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"])
    stereo = np.frombuffer(decoded.stdout, dtype="<f4").reshape(-1, channels)
    mono = stereo.astype(np.float64).mean(axis=1)
    peak = float(np.max(np.abs(stereo)))
    rms = float(np.sqrt(np.mean(stereo.astype(np.float64)**2)))
    loud_result = run(["-loglevel", "info", "-i", str(path), "-map", "0:a:0", "-af",
                       "loudnorm=I=-23:TP=-1:LRA=11:print_format=json", "-f", "null", "NUL"])
    loud = json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', loud_result.stderr.decode("utf-8", "replace"), re.S)[-1])
    window_len, hop = round(rate*.032), round(rate*.016)
    nfft = 1 << (window_len-1).bit_length()
    window = np.hanning(window_len)
    frequencies = np.fft.rfftfreq(nfft, 1/rate)
    weights = np.ones(len(frequencies))*2
    weights[0] = weights[-1] = 1
    divisor = nfft * np.sum(window**2)
    starts = np.arange(0, len(mono)-window_len+1, hop)
    frame_power = np.array([np.mean(mono[s:s+window_len]**2) for s in starts])
    p95 = float(np.percentile(frame_power, 95))
    active_threshold, quiet_threshold = p95*10**(-25/10), p95*10**(-40/10)
    masks = {"all": np.ones(len(starts), dtype=bool), "energy_active": frame_power >= active_threshold,
             "energy_quiet": frame_power <= quiet_threshold}
    masks["intermediate"] = ~(masks["energy_active"] | masks["energy_quiet"])
    band_power = np.zeros((len(starts), len(BANDS)))
    total_power = np.zeros(len(starts))
    common_power = np.zeros(len(starts))
    high_power = np.zeros(len(starts))
    sfm = np.zeros(len(starts))
    for i, start in enumerate(starts):
        spectrum = np.abs(np.fft.rfft(mono[start:start+window_len]*window, nfft))**2*weights/divisor
        total_power[i] = float(spectrum.sum())
        common_power[i] = float(spectrum[frequencies < 7500].sum())
        high_power[i] = float(spectrum[(frequencies >= 4000) & (frequencies < 7500)].sum())
        for j, (lo, hi) in enumerate(BANDS):
            band_power[i,j] = spectrum[(frequencies >= lo) & (frequencies < hi)].sum()
        s = spectrum[(frequencies >= 4000) & (frequencies < 7500)]
        sfm[i] = float(np.exp(np.mean(np.log(s+1e-30)))/(np.mean(s)+1e-30)) if total_power[i] else 0
    ratios = np.divide(high_power, common_power, out=np.zeros_like(high_power), where=common_power>0)
    masks["hf_rich_active_proxy"] = masks["energy_active"] & (ratios >= .3)
    groups = {}
    for name, mask in masks.items():
        sums = band_power[mask].sum(axis=0)
        total = float(total_power[mask].sum())
        common = float(common_power[mask].sum())
        count = int(mask.sum())
        groups[name] = {"frame_count": count, "fraction_of_frames": count/len(starts),
                        "mono_rms_dbfs": db(float(frame_power[mask].mean()), True) if count else None,
                        "spectral_power_rms_dbfs": db(total/count, True) if count else None,
                        "high_4k_7p5k_fraction_of_0_7p5k": float(high_power[mask].sum()/common) if common else None,
                        "high_4k_7p5k_rms_dbfs": db(float(high_power[mask].mean()), True) if count else None,
                        "high_band_flatness_median": float(np.median(sfm[mask])) if count else None,
                        "bands": {f"{lo}-{hi}Hz": {"fraction_of_total": float(value/total) if total else None,
                                                     "rms_dbfs": db(value/count, True) if count else None}
                                  for (lo,hi),value in zip(BANDS,sums)}}
    silent = np.all(stereo == 0, axis=1)
    edges = np.flatnonzero(np.diff(np.r_[False,silent,False].astype(np.int8)))
    zero_runs = [{"start_seconds":a/rate,"end_seconds":b/rate,"duration_seconds":(b-a)/rate}
                 for a,b in zip(edges[::2],edges[1::2]) if b-a>=round(.2*rate)]
    with (OUT/(identifier+"-frames.csv")).open("x", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["start_seconds","rms_dbfs","group","high_4k_7p5k_fraction","high_band_rms_dbfs","high_band_flatness"])
        for i,start in enumerate(starts):
            group = "active" if masks["energy_active"][i] else "quiet" if masks["energy_quiet"][i] else "intermediate"
            writer.writerow([round(float(start)/rate,6),db(frame_power[i],True),group,float(ratios[i]),db(high_power[i],True),float(sfm[i])])
    return {"id":identifier,"kind":kind,"role":role,"path":str(path),"sha256":before,
            "unchanged":sha(path)==before,"frames":len(stereo),"rate":rate,"channels":channels,"duration_seconds":len(stereo)/rate,
            "peak_dbfs":db(peak),"rms_dbfs":db(rms),"peak":peak,
            "samples_at_or_above_full_scale":int(np.count_nonzero(np.abs(stereo)>=1)),
            "samples_at_pcm16_rails":int(np.count_nonzero((stereo<=-1)|(stereo>=32767/32768))) if channels==1 else None,
            "exact_zero_sample_fraction":float(silent.mean()),"zero_runs_at_least_200ms":zero_runs,
            "loudness":{"integrated_lufs":float(loud["input_i"]),"true_peak_dbtp":float(loud["input_tp"]),"lra":float(loud["input_lra"])},
            "energy_frame_p95_dbfs":db(p95,True),"active_threshold_dbfs":db(active_threshold,True),
            "quiet_threshold_dbfs":db(quiet_threshold,True),"groups":groups}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True,exist_ok=True)
    if (OUT/"diagnosis.json").exists():
        raise FileExistsError("Refusing to overwrite diagnosis evidence")
    rows=[]
    for case in inventory():
        rows.append(analyze(case))
        print(json.dumps({"event":"measured","id":case[0]},ensure_ascii=False),flush=True)
    result={"measured_at":datetime.now(timezone.utc).isoformat(),"script":{"path":str(Path(__file__)),"sha256":sha(__file__)},
            "method":{"window_ms":32,"hop_ms":16,"spectra":"Hann-window FFT power; channel arithmetic average for stereo spectra",
                      "active":"frame RMS >= per-file frame RMS p95 minus 25 dB","quiet":"frame RMS <= p95 minus 40 dB",
                      "hf_rich_proxy":"active frame with >=30% 4-7.5kHz energy within 0-7.5kHz; not a phoneme label",
                      "limitations":["Energy groups are not ASR/VAD or voiced/unvoiced phoneme annotations.",
                                     "High-frequency energy and flatness may be normal fricatives; neither establishes noise or denoising artifacts.",
                                     "Null dB values can mean exact digital silence; do not interpret as measured zero dB.",
                                     "Native outputs have different prosody/durations, so ratios are descriptive, not a controlled phoneme comparison.",
                                     "Source previews have different sample rates; use 0-7.5kHz common-band ratios for source/model comparison."]},
            "files":rows,"commands":COMMANDS,"input_audio_unchanged":all(row['unchanged'] for row in rows),
            "generated_or_modified_audio_files":0,"tts_runs":0,"asr_runs":0,"gpu_runs":0}
    with (OUT/"diagnosis.json").open("x",encoding="utf-8",newline="\n") as f:
        json.dump(result,f,ensure_ascii=False,indent=2,allow_nan=False);f.write("\n")
    print(json.dumps({"event":"complete","path":str(OUT/"diagnosis.json"),"count":len(rows)}),flush=True)


if __name__=="__main__":
    main()
