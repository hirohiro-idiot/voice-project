from __future__ import annotations

import json
import math
import sys
import wave
from pathlib import Path


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

    ints = [
        int.from_bytes(frames[i : i + 2], "little", signed=True) / 32768
        for i in range(0, len(frames), 2)
    ]
    mono = []
    for i in range(0, len(ints), channels):
        mono.append(sum(ints[i : i + channels]) / channels)
    return mono, sample_rate, channels


def rms(samples: list[float]) -> float:
    if not samples:
        return 0
    return math.sqrt(sum(sample * sample for sample in samples) / len(samples))


def estimate_f0(samples: list[float], sample_rate: int) -> float | None:
    data = samples[: int(sample_rate * 1.5)]
    if len(data) < sample_rate * 0.03 or rms(data) < 0.005:
        return None

    min_lag = max(1, sample_rate // 500)
    max_lag = min(sample_rate // 50, len(data) - 1)
    best_corr = float("-inf")
    correlations = {}
    for lag in range(min_lag, max_lag + 1):
        corr = sum(data[i] * data[i + lag] for i in range(len(data) - lag)) / (len(data) - lag)
        correlations[lag] = corr
        if corr > best_corr:
            best_corr = corr
    if best_corr <= 0:
        return None
    threshold = best_corr * 0.82
    for lag in range(min_lag + 1, max_lag):
        if (
            correlations[lag] >= threshold
            and correlations[lag] >= correlations[lag - 1]
            and correlations[lag] >= correlations[lag + 1]
        ):
            return sample_rate / lag
    return None


def dft_magnitudes(samples: list[float], size: int = 512) -> list[float]:
    frame = samples[:size] + [0.0] * max(0, size - len(samples))
    windowed = [
        sample * (0.5 - 0.5 * math.cos((2 * math.pi * index) / (size - 1)))
        for index, sample in enumerate(frame[:size])
    ]
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
            weight = (k - bins[band]) / max(1, bins[band + 1] - bins[band])
            energy += magnitudes[k] * magnitudes[k] * weight
        for k in range(bins[band + 1], bins[band + 2]):
            weight = (bins[band + 2] - k) / max(1, bins[band + 2] - bins[band + 1])
            energy += magnitudes[k] * magnitudes[k] * weight
        energies.append(math.log(max(energy, 1e-12)))

    return [
        sum(energies[n] * math.cos(math.pi * k * (n + 0.5) / bands) for n in range(bands))
        for k in range(coeffs)
    ]


def tokenize(text: str) -> list[dict[str, str]]:
    return [{"token": char, "label": TOKEN_LABELS.get(char, char.lower())} for char in text if not char.isspace()]


def build_experiment(audio_path: Path, text: str) -> dict:
    samples, sample_rate, channels = read_wav(audio_path)
    duration = len(samples) / sample_rate
    tokens = tokenize(text)
    if not tokens:
        raise ValueError("Transcript must contain at least one non-space character.")
    segments = []
    for index, item in enumerate(tokens):
        start = duration * index / len(tokens)
        end = duration * (index + 1) / len(tokens)
        segment_samples = samples[int(start * sample_rate) : int(end * sample_rate)]
        segments.append(
            {
                "index": index + 1,
                "token": item["token"],
                "label": item["label"],
                "startTime": start,
                "endTime": end,
                "rms": rms(segment_samples),
                "estimatedF0": estimate_f0(segment_samples, sample_rate),
                "mfccMean": mfcc_mean(segment_samples, sample_rate),
                "controls": {
                    "pitchShift": 0,
                    "speedRatio": 1,
                    "gainDb": 0,
                    "formantShift": 0,
                },
            }
        )

    return {
        "schemaVersion": 1,
        "input": {"audioFile": audio_path.name, "transcript": text, "tokens": tokens},
        "audio": {
            "duration": duration,
            "sampleRate": sample_rate,
            "channels": channels,
            "rms": rms(samples),
            "estimatedF0": estimate_f0(samples, sample_rate),
        },
        "segments": segments,
    }


def write_outputs(experiment: dict, root: Path) -> None:
    vowels = root / "presets" / "vowels"
    cards = root / "experiment_cards"
    vowels.mkdir(parents=True, exist_ok=True)
    cards.mkdir(parents=True, exist_ok=True)

    for segment in experiment["segments"]:
        name = f"{segment['index']:03d}_{segment['label']}.json"
        (vowels / name).write_text(json.dumps(segment, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Experiment 001",
        "",
        "## Input",
        "",
        f"- Audio: {experiment['input']['audioFile']}",
        f"- Text: {experiment['input']['transcript']}",
        f"- Duration: {experiment['audio']['duration']:.3f} s",
        f"- Sample rate: {experiment['audio']['sampleRate']} Hz",
        f"- RMS: {experiment['audio']['rms']:.5f}",
        f"- Estimated F0: {experiment['audio']['estimatedF0']:.1f} Hz"
        if experiment["audio"]["estimatedF0"] is not None
        else "- Estimated F0: -",
        "",
        "## Segment Features",
        "",
        "| # | Token | Label | Start | End | RMS | F0 | MFCC mean first 5 |",
        "|---|---|---|---:|---:|---:|---:|---|",
    ]
    for segment in experiment["segments"]:
        f0 = "-" if segment["estimatedF0"] is None else f"{segment['estimatedF0']:.1f}"
        mfcc = ", ".join(f"{value:.2f}" for value in segment["mfccMean"][:5])
        lines.append(
            f"| {segment['index']} | {segment['token']} | {segment['label']} | "
            f"{segment['startTime']:.3f} | {segment['endTime']:.3f} | "
            f"{segment['rms']:.5f} | {f0} | {mfcc} |"
        )
    (cards / "Experiment_001.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python tools/generate_experiment.py audio.wav text")
        raise SystemExit(2)
    root = Path(__file__).resolve().parents[1]
    experiment = build_experiment(Path(sys.argv[1]), sys.argv[2])
    write_outputs(experiment, root)
    print(json.dumps({"audio": experiment["audio"], "segments": len(experiment["segments"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
