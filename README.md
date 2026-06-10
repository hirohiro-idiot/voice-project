# voice-project

A browser-based audio feature extraction research app.

The long-term goal is to pair an audio file with matching text, extract vowel and consonant characteristics, and build reusable voice presets for future speech synthesis.

## Current Features

- Upload WAV, MP3, M4A, and other browser-supported audio files
- Enter matching transcript text for the uploaded audio
- Draw waveform, spectrogram, and MFCC visualizations
- Show duration, sample rate, channel count, RMS loudness, and estimated F0
- Estimate signal-based segmentation boundaries from silence, RMS drops, MFCC changes, and spectral changes
- Split Japanese transcript text into simple mora units
- Align estimated boundaries to mora count with candidate-prioritized interpolation
- Extract per-segment RMS, ZCR, spectral centroid, estimated F0, and MFCC mean values
- Export experiment JSON and Markdown from the browser
- Keep research output folders for vowels, consonants, speakers, segments, and experiment cards

## Implemented Structure

```text
.
|-- index.html
|-- styles.css
|-- app.js
|-- audio_only.js
|-- boundary_debug.js
|-- tools/
|   `-- generate_experiment.py
|-- presets/
|   |-- vowels/
|   |-- consonants/
|   |-- segments/
|   `-- speakers/
|-- experiment_cards/
`-- README.md
```

## Usage

Open `index.html` in a browser and choose or drag-and-drop an audio file. Enter the matching transcript text, then review the generated analysis results.

To preview with a local server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Local Experiment Export

For 16-bit PCM WAV files, the helper script can write preset JSON and an experiment card into the repository folders:

```bash
python tools/generate_experiment.py sample.wav aiueo
```

The script writes:

- `presets/segments/*.json`
- `experiment_cards/Experiment_001.md`

## Implementation Notes

Browser analysis uses the Web Audio API for decoding. FFT, Mel filterbank, MFCC calculation, RMS, zero-crossing rate, spectral centroid, F0 estimation, and signal-based text/audio alignment are implemented in JavaScript.

This is not speech recognition. It is a research tool for estimating phoneme/mora boundary candidates from the audio signal and making the result visible for iteration.

## Boundary Estimation Algorithm

The current boundary pipeline separates audio-only candidate detection from transcript alignment.

1. Audio-only candidates are estimated first from the waveform.
2. Candidate scores prioritize RMS/silence, then spectral centroid change, MFCC delta, and F0 change.
3. MFCC deltas are smoothed with a moving average to avoid reacting to tiny within-phoneme changes.
4. Candidates must be local maxima and at least 200 ms apart.
5. Transcript-based initial boundaries are computed only as debug anchors.
6. Final boundaries are attracted to high-scoring nearby audio-only candidates instead of using equal division directly.
7. The attraction score combines acoustic score, proximity to the transcript anchor, and bonuses for silence/MFCC boundaries.
8. A debug table reports the initial position, pre-correction position, adopted candidate, reason, score, and final boundary.

Visualization colors:

- Red: audio-only candidate
- Blue: transcript-based initial boundary
- Black: final boundary

The preset schema already reserves neutral controls for future natural speech synthesis:

- `pitchShift`
- `speedRatio`
- `gainDb`
- `formantShift`

## Roadmap

- Phase1: Waveform, spectrogram, and MFCC visualization
- Phase2: Vowel feature extraction
- Phase3: Consonant feature extraction
- Phase4: Voice preset generation
- Phase5: Speech resynthesis
