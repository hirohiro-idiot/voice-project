# voice-project

A browser-based audio feature extraction research app.

The long-term goal is to pair an audio file with matching text, extract vowel and consonant characteristics, and build reusable voice presets for future speech synthesis.

## Current Features

- Upload WAV, MP3, M4A, and other browser-supported audio files
- Enter matching transcript text for the uploaded audio
- Draw waveform, spectrogram, and MFCC visualizations
- Show duration, sample rate, channel count, RMS loudness, and estimated F0
- Estimate signal-based segmentation boundaries from silence, RMS drops, MFCC changes, and spectral changes
- Manually annotate waveform ranges while listening to the audio
- Label character, phoneme, vowel, consonant, and custom research intervals
- Extract per-annotation RMS, F0, MFCC mean, spectral centroid, and estimated F1/F2/F3 formants
- Export manual annotations as `annotations.json`
- Export label-grouped manual preset data for `presets/manual/`
- Split Japanese transcript text into simple mora units
- Align estimated boundaries to mora count with candidate-prioritized interpolation
- Extract per-segment RMS, ZCR, spectral centroid, estimated F0, and MFCC mean values
- Export experiment JSON and Markdown from the browser
- Keep research output folders for vowels, consonants, speakers, and experiment cards

## Implemented Structure

```text
.
|-- index.html
|-- styles.css
|-- app.js
|-- manual_annotation.js
|-- audio_only.js
|-- boundary_debug.js
|-- tools/
|   `-- generate_experiment.py
|-- presets/
|   |-- vowels/
|   |-- consonants/
|   |-- manual/
|   |-- segments/
|   `-- speakers/
|-- experiment_cards/
`-- README.md
```

## Usage

Open `index.html` in a browser and choose or drag-and-drop an audio file. Enter the matching transcript text, then review the generated analysis results.

For manual annotation, use the `Manual Annotation` section:

1. Play, stop, seek by 1 second, or change playback speed to 0.5x, 1x, or 2x.
2. Click once on the waveform to mark a start time, then click again to mark an end time.
3. Drag directly on the waveform to select a range.
4. Enter a label such as `mora:ko`, `k`, `o`, `vowel:a`, `consonant:k`, or `dakuten:g`.
5. Add the annotation, review its features, play the selected segment, edit it, or delete it.
6. Export `annotations.json` or grouped `presets/manual` JSON.

When `Prefer manual annotations` is enabled, exported experiment JSON treats manual ranges as the primary segmentation data while keeping automatic boundary detection available for comparison.

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

Manual browser exports write downloadable JSON files:

- `annotations.json`
- `presets_manual.json`, representing entries intended for `presets/manual/`

## Implementation Notes

Browser analysis uses the Web Audio API for decoding. FFT, Mel filterbank, MFCC calculation, RMS, zero-crossing rate, spectral centroid, F0 estimation, and signal-based text/audio alignment are implemented in JavaScript.

This is not speech recognition. It is a research tool for estimating phoneme/mora boundary candidates from the audio signal and making the result visible for iteration.

Manual annotations are intended to create higher-confidence reference intervals. They can be used for characters, phonemes, vowels, consonants, dakuten transitions, or any custom label needed by the research workflow.

## Boundary Estimation Algorithm

The current boundary pipeline separates audio-only candidate detection from transcript alignment.

1. Audio-only candidates are estimated first from the waveform.
2. Candidate scores prioritize RMS/silence, then spectral centroid change, MFCC delta, and F0 change.
3. MFCC deltas are smoothed with a moving average to avoid reacting to tiny within-phoneme changes.
4. Candidates must be local maxima and at least 200 ms apart.
5. Transcript-based initial boundaries are computed only as debug anchors.
6. Final boundaries are attracted to high-scoring nearby audio-only candidates instead of using equal division directly.
7. A debug table reports the initial position, pre-correction position, adopted candidate, reason, score, and final boundary.

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
