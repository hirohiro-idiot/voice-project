# Experiment 001

## Input

- Audio: sample_auto.wav
- Text: aiueo
- Duration: 1.400 s
- Sample rate: 16000 Hz
- RMS: 0.34426
- Estimated F0: 55.0 Hz
- Estimated boundary count: 9
- Mora count: 5

## Analysis Images

- Waveform: `waveform.png`
- Spectrogram: `spectrogram.png`
- MFCC: `mfcc.png`

## Segment Features

| # | Token | Label | Start | End | RMS | ZCR | Centroid | F0 | MFCC mean first 5 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | a | a | 0.000 | 0.220 | 0.38846 | 0.0538 | 488.0 | 444.4 | -207.24, 68.45, 26.76, -15.95, -36.33 |
| 2 | i | i | 0.220 | 0.500 | 0.34429 | 0.0544 | 565.7 | 275.9 | -552.62, -0.00, 0.00, -0.00, 0.00 |
| 3 | u | u | 0.500 | 0.780 | 0.34419 | 0.0644 | 652.1 | 333.3 | -552.62, -0.00, 0.00, -0.00, 0.00 |
| 4 | e | e | 0.780 | 1.060 | 0.34409 | 0.0329 | 395.0 | 333.3 | -552.62, -0.00, 0.00, -0.00, 0.00 |
| 5 | o | o | 1.060 | 1.400 | 0.31253 | 0.0431 | 498.9 | 246.2 | -552.62, -0.00, 0.00, -0.00, 0.00 |

## Notes

- This is signal-based segmentation, not speech recognition.
- Boundaries are inferred from silence, RMS drops, MFCC change, and spectral change.
- When boundary count and mora count differ, candidate boundaries are aligned to mora count with balance constraints.
