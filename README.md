# voice-project

A static web app that accepts an audio file and generates its waveform, spectrogram, and MFCC visualization in the browser.

## Features

- Upload WAV, MP3, M4A, and other browser-supported audio files
- Draw a waveform
- Generate an STFT-based spectrogram
- Generate MFCCs with a Mel filterbank and DCT
- Download each visualization as a PNG
- Run analysis entirely in the browser with no server-side processing

## Usage

Open `index.html` in a browser and choose or drag-and-drop an audio file.

To preview with a local server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Structure

```text
.
|-- index.html
|-- styles.css
|-- app.js
`-- README.md
```

## Implementation Notes

All analysis runs in the browser. Audio decoding uses the Web Audio API, and FFT, Mel filterbank, and MFCC calculation are implemented in JavaScript.
