from __future__ import annotations

import json
import math
import sys
import wave
from pathlib import Path

MAX_AUDIO_SECONDS = 30
FRAME_SIZE = 512
HOP_SIZE = 160
SMALL_KANA = {"\u3083", "\u3085", "\u3087", "\u30e3", "\u30e5", "\u30e7"}
STANDALONE_MORA = {"\u3063", "\u30c3", "\u30fc"}
TOKEN_LABELS = {
    "\u3042": "a",
    "\u3044": "i",
    "\u3046": "u",
    "\u3048": "e",
    "\u304a": "o",
    "\u30a2": "a",
    "\u30a4": "i",
    "\u30a6": "u",
    "\u30a8": "e",
    "\u30aa": "o",
}


def read_wav(path: Path) -> tuple[list[float], int, int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())
    if width != 2:
        raise ValueError("Only 16-bit PCM WAV files are supported by this helper.")
    ints = [int.from_bytes(frames[i : i + 2], "little", signed=True) / 32768 for i in range(0, len(frames), 2)]
    return [sum(ints[i : i + channels]) / channels for i in range(0, len(ints), channels)], sample_rate, channels


def rms(samples: list[float]) -> float:
    return math.sqrt(sum(sample * sample for sample in samples) / len(samples)) if samples else 0


def zcr(samples: list[float]) -> float:
    if len(samples) < 2:
        return 0
    crossings = sum(1 for i in range(1, len(samples)) if (samples[i - 1] >= 0 > samples[i]) or (samples[i - 1] < 0 <= samples[i]))
    return crossings / (len(samples) - 1)


def estimate_f0(samples: list[float], sample_rate: int) -> float | None:
    data = samples[: int(sample_rate * 1.5)]
    if len(data) < sample_rate * 0.03 or rms(data) < 0.005:
        return None
    min_lag = max(1, sample_rate // 500)
    max_lag = min(sample_rate // 50, len(data) - 1)
    correlations = {}
    best = float("-inf")
    for lag in range(min_lag, max_lag + 1):
        corr = sum(data[i] * data[i + lag] for i in range(len(data) - lag)) / (len(data) - lag)
        correlations[lag] = corr
        best = max(best, corr)
    if best <= 0:
        return None
    threshold = best * 0.82
    for lag in range(min_lag + 1, max_lag):
        if correlations[lag] >= threshold and correlations[lag] >= correlations[lag - 1] and correlations[lag] >= correlations[lag + 1]:
            return sample_rate / lag
    return None


def dft_magnitudes(samples: list[float], size: int = FRAME_SIZE) -> list[float]:
    frame = samples[:size] + [0.0] * max(0, size - len(samples))
    windowed = [sample * (0.5 - 0.5 * math.cos((2 * math.pi * index) / (size - 1))) for index, sample in enumerate(frame[:size])]
    magnitudes = []
    for k in range(size // 2):
        real = 0.0
        imag = 0.0
        for n, sample in enumerate(windowed):
            angle = 2 * math.pi * k * n / size
            real += sample * math.cos(angle)
            imag -= sample * math.sin(angle)
        magnitudes.append(math.sqrt(real * real + imag * imag))
    return magnitudes


def spectral_centroid(magnitudes: list[float], sample_rate: int) -> float:
    total = sum(magnitudes)
    return sum((index * sample_rate / FRAME_SIZE) * value for index, value in enumerate(magnitudes)) / total if total > 0 else 0


def hz_to_mel(hz: float) -> float:
    return 2595 * math.log10(1 + hz / 700)


def mel_to_hz(mel: float) -> float:
    return 700 * (10 ** (mel / 2595) - 1)


def mfcc_mean(samples: list[float], sample_rate: int, bands: int = 20, coeffs: int = 13) -> list[float]:
    magnitudes = dft_magnitudes(samples)
    min_mel = hz_to_mel(0)
    max_mel = hz_to_mel(sample_rate / 2)
    mel_points = [mel_to_hz(min_mel + (max_mel - min_mel) * i / (bands + 1)) for i in range(bands + 2)]
    bins = [min(len(magnitudes) - 1, int((len(magnitudes) * 2 + 1) * hz / sample_rate)) for hz in mel_points]
    energies = []
    for band in range(bands):
        energy = 0.0
        for k in range(bins[band], bins[band + 1]):
            energy += magnitudes[k] * magnitudes[k] * (k - bins[band]) / max(1, bins[band + 1] - bins[band])
        for k in range(bins[band + 1], bins[band + 2]):
            energy += magnitudes[k] * magnitudes[k] * (bins[band + 2] - k) / max(1, bins[band + 2] - bins[band + 1])
        energies.append(math.log(max(energy, 1e-12)))
    return [sum(energies[n] * math.cos(math.pi * k * (n + 0.5) / bands) for n in range(bands)) for k in range(coeffs)]


def frame_features(samples: list[float], sample_rate: int) -> list[dict]:
    frames = []
    for start in range(0, max(1, len(samples) - FRAME_SIZE + 1), HOP_SIZE):
        frame = samples[start : start + FRAME_SIZE]
        mags = dft_magnitudes(frame)
        frames.append({"start": start / sample_rate, "center": (start + FRAME_SIZE / 2) / sample_rate, "rms": rms(frame), "zcr": zcr(frame), "centroid": spectral_centroid(mags, sample_rate), "mfcc": mfcc_mean(frame, sample_rate)})
    return frames or [{"start": 0, "center": len(samples) / sample_rate / 2, "rms": rms(samples), "zcr": zcr(samples), "centroid": spectral_centroid(dft_magnitudes(samples), sample_rate), "mfcc": mfcc_mean(samples, sample_rate)}]


def vector_distance(a: list[float], b: list[float]) -> float:
    length = min(len(a), len(b))
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(length)) / length) if length else 0


def score_boundaries(frames: list[dict], duration: float) -> list[dict]:
    rms_max = max([frame["rms"] for frame in frames] + [1e-8])
    centroid_max = max([frame["centroid"] for frame in frames] + [1e-8])
    candidates = [{"time": 0.0, "score": 1.0, "is_peak": True}]
    for index in range(1, len(frames)):
        prev = frames[index - 1]
        cur = frames[index]
        low_energy = 1 - min(1, (prev["rms"] + cur["rms"]) / 2 / rms_max)
        silence = 1 if prev["rms"] < rms_max * 0.12 or cur["rms"] < rms_max * 0.12 else 0
        rms_drop = max(0, prev["rms"] - cur["rms"]) / rms_max
        mfcc_delta = vector_distance(prev["mfcc"], cur["mfcc"]) / 80
        centroid_delta = abs(cur["centroid"] - prev["centroid"]) / centroid_max
        score = low_energy * 0.35 + silence * 0.25 + rms_drop * 0.15 + mfcc_delta * 0.15 + centroid_delta * 0.1
        candidates.append({"time": cur["start"], "score": score, "is_peak": False})
    for index in range(1, len(candidates) - 1):
        candidates[index]["is_peak"] = candidates[index]["score"] >= candidates[index - 1]["score"] and candidates[index]["score"] >= candidates[index + 1]["score"] and candidates[index]["score"] > 0.28
    candidates.append({"time": duration, "score": 1.0, "is_peak": True})
    return [candidate for candidate in candidates if 0 <= candidate["time"] <= duration]


def align_boundaries(candidates: list[dict], mora_count: int, duration: float) -> list[float]:
    if mora_count <= 0:
        return [0, duration]
    min_segment = max(0.04, duration / mora_count * 0.35)
    usable = [{**candidate, "score": candidate["score"] + (0.18 if candidate["is_peak"] else 0)} for candidate in candidates if min_segment < candidate["time"] < duration - min_segment]
    chosen = []
    for slot in range(1, mora_count):
        target = duration * slot / mora_count
        width = duration / mora_count
        ranked = sorted(usable, key=lambda item: item["score"] - abs(item["time"] - target) / width * 0.32, reverse=True)
        pick = None
        for candidate in ranked:
            times = sorted([item["time"] for item in chosen] + [candidate["time"]])
            if all(times[index] - times[index - 1] >= min_segment for index in range(1, len(times))):
                pick = candidate
                break
        chosen.append(pick or {"time": target, "score": 0, "is_peak": False, "interpolated": True})
    return [0.0] + sorted(item["time"] for item in chosen) + [duration]


def average(values: list[float]) -> float:
    values = [value for value in values if value is not None]
    return sum(values) / len(values) if values else 0


def split_mora(text: str) -> list[str]:
    mora: list[str] = []
    for char in (char for char in text if not char.isspace()):
        if char in SMALL_KANA and mora and mora[-1] not in STANDALONE_MORA:
            mora[-1] += char
        else:
            mora.append(char)
    return mora


def tokenize(text: str) -> list[dict[str, str]]:
    return [{"token": item, "label": TOKEN_LABELS.get(item, item.lower())} for item in split_mora(text)]


def build_experiment(audio_path: Path, text: str) -> dict:
    samples, sample_rate, channels = read_wav(audio_path)
    duration = len(samples) / sample_rate
    if duration > MAX_AUDIO_SECONDS:
        raise ValueError(f"Audio is {duration:.1f}s. Please use audio up to {MAX_AUDIO_SECONDS}s.")
    tokens = tokenize(text)
    if not tokens:
        raise ValueError("Transcript must contain at least one non-space character.")
    frames = frame_features(samples, sample_rate)
    candidates = score_boundaries(frames, duration)
    boundaries = align_boundaries(candidates, len(tokens), duration)
    segments = []
    for index, item in enumerate(tokens):
        start = boundaries[index]
        end = boundaries[index + 1]
        segment_samples = samples[int(start * sample_rate) : int(end * sample_rate)]
        segment_frames = [frame for frame in frames if start <= frame["center"] <= end]
        segments.append({"index": index + 1, "label": item["label"], "token": item["token"], "start_time": start, "end_time": end, "duration": end - start, "rms_mean": rms(segment_samples), "zcr_mean": average([frame["zcr"] for frame in segment_frames]), "spectral_centroid_mean": average([frame["centroid"] for frame in segment_frames]), "mfcc_mean": mfcc_mean(segment_samples, sample_rate), "f0_mean": estimate_f0(segment_samples, sample_rate), "controls": {"pitchShift": 0, "speedRatio": 1, "gainDb": 0, "formantShift": 0}})
    return {"schemaVersion": 1, "input": {"audioFile": audio_path.name, "transcript": text, "tokens": tokens}, "segmentation": {"method": "signal-boundary-candidates-with-mora-alignment", "estimatedBoundaryCount": sum(1 for candidate in candidates if candidate["is_peak"]) - 2, "moraCount": len(tokens), "boundaries": boundaries}, "audio": {"duration": duration, "sampleRate": sample_rate, "channels": channels, "rms": rms(samples), "estimatedF0": estimate_f0(samples, sample_rate)}, "segments": segments}


def write_outputs(experiment: dict, root: Path) -> None:
    segments_dir = root / "presets" / "segments"
    cards = root / "experiment_cards"
    segments_dir.mkdir(parents=True, exist_ok=True)
    cards.mkdir(parents=True, exist_ok=True)
    for segment in experiment["segments"]:
        name = f"{segment['index']:03d}_{segment['label']}.json"
        (segments_dir / name).write_text(json.dumps(segment, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Experiment 001", "", "## Input", "", f"- Audio: {experiment['input']['audioFile']}", f"- Text: {experiment['input']['transcript']}", f"- Duration: {experiment['audio']['duration']:.3f} s", f"- Sample rate: {experiment['audio']['sampleRate']} Hz", f"- RMS: {experiment['audio']['rms']:.5f}", f"- Estimated F0: {experiment['audio']['estimatedF0']:.1f} Hz" if experiment["audio"]["estimatedF0"] is not None else "- Estimated F0: -", f"- Estimated boundary count: {experiment['segmentation']['estimatedBoundaryCount']}", f"- Mora count: {experiment['segmentation']['moraCount']}", "", "## Analysis Images", "", "- Waveform: `waveform.png`", "- Spectrogram: `spectrogram.png`", "- MFCC: `mfcc.png`", "", "## Segment Features", "", "| # | Token | Label | Start | End | RMS | ZCR | Centroid | F0 | MFCC mean first 5 |", "|---|---|---|---:|---:|---:|---:|---:|---:|---|"]
    for segment in experiment["segments"]:
        f0 = "-" if segment["f0_mean"] is None else f"{segment['f0_mean']:.1f}"
        mfcc = ", ".join(f"{value:.2f}" for value in segment["mfcc_mean"][:5])
        lines.append(f"| {segment['index']} | {segment['token']} | {segment['label']} | {segment['start_time']:.3f} | {segment['end_time']:.3f} | {segment['rms_mean']:.5f} | {segment['zcr_mean']:.4f} | {segment['spectral_centroid_mean']:.1f} | {f0} | {mfcc} |")
    lines.extend(["", "## Notes", "", "- This is signal-based segmentation, not speech recognition.", "- Boundaries are inferred from silence, RMS drops, MFCC change, and spectral change.", "- When boundary count and mora count differ, candidate boundaries are aligned to mora count with balance constraints."])
    (cards / "Experiment_001.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python tools/generate_experiment.py audio.wav text")
        raise SystemExit(2)
    root = Path(__file__).resolve().parents[1]
    experiment = build_experiment(Path(sys.argv[1]), sys.argv[2])
    write_outputs(experiment, root)
    print(json.dumps({"audio": experiment["audio"], "segmentation": experiment["segmentation"], "segments": len(experiment["segments"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
