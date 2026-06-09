# voice-project

A browser-based audio feature extraction research app.

The long-term goal is to pair an audio file with matching text, extract vowel and consonant characteristics, and build reusable voice presets for future speech synthesis.

## Current Features

- Upload WAV, MP3, M4A, and other browser-supported audio files
- Enter matching transcript text for the uploaded audio
- Draw waveform, spectrogram, and MFCC visualizations
- Show duration, sample rate, channel count, RMS loudness, and estimated F0
- Split the full audio evenly by transcript character count as a first alignment baseline
- Extract per-segment RMS, estimated F0, and MFCC mean values
- Export experiment JSON and Markdown from the browser
- Keep research output folders for vowels, consonants, speakers, and experiment cards

## Implemented Structure

```text
.
|-- index.html
|-- styles.css
|-- app.js
|-- tools/
|   `-- generate_experiment.py
|-- presets/
|   |-- vowels/
|   |-- consonants/
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

- `presets/vowels/*.json`
- `experiment_cards/Experiment_001.md`

## Implementation Notes

Browser analysis uses the Web Audio API for decoding. FFT, Mel filterbank, MFCC calculation, RMS, F0 estimation, and simple text/audio alignment are implemented in JavaScript.

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
