const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const statusPill = document.querySelector("#status-pill");
const canvases = {
  waveform: document.querySelector("#waveform-canvas"),
  spectrogram: document.querySelector("#spectrogram-canvas"),
  mfcc: document.querySelector("#mfcc-canvas"),
};

const meta = {
  fileName: document.querySelector("#file-name"),
  duration: document.querySelector("#duration"),
  sampleRate: document.querySelector("#sample-rate"),
  channels: document.querySelector("#channels"),
};

const FFT_SIZE = 2048;
const HOP_SIZE = 512;
const MEL_BANDS = 40;
const MFCC_COUNT = 20;

function setStatus(text, state = "") {
  statusPill.textContent = text;
  statusPill.className = `status-pill ${state}`.trim();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

function mixToMono(buffer) {
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return mono;
}

function drawAxes(ctx, width, height, title, xLabel = "Time", yLabel = "") {
  ctx.fillStyle = "#fbfcfb";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#dbe1dc";
  ctx.lineWidth = 1;
  for (let x = 64; x < width - 20; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x, height - 42);
    ctx.stroke();
  }
  for (let y = 44; y < height - 42; y += 56) {
    ctx.beginPath();
    ctx.moveTo(58, y);
    ctx.lineTo(width - 22, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#16211f";
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillText(title, 58, 28);
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillStyle = "#5d6965";
  ctx.fillText(xLabel, width - 74, height - 14);
  if (yLabel) ctx.fillText(yLabel, 10, 34);
}

function drawWaveform(samples, sampleRate) {
  const canvas = canvases.waveform;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  drawAxes(ctx, width, height, "Waveform", "Time", "Amplitude");

  const left = 58;
  const top = 42;
  const plotWidth = width - 82;
  const plotHeight = height - 86;
  const mid = top + plotHeight / 2;

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x < plotWidth; x += 1) {
    const start = Math.floor((x / plotWidth) * samples.length);
    const end = Math.max(start + 1, Math.floor(((x + 1) / plotWidth) * samples.length));
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i += 1) {
      min = Math.min(min, samples[i]);
      max = Math.max(max, samples[i]);
    }
    ctx.moveTo(left + x, mid - max * (plotHeight / 2));
    ctx.lineTo(left + x, mid - min * (plotHeight / 2));
  }
  ctx.stroke();

  ctx.fillStyle = "#5d6965";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(`${(samples.length / sampleRate).toFixed(2)} s`, width - 92, height - 42);
}

function hannWindow(size) {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

function fftMagnitudes(frame) {
  const n = frame.length;
  const real = Float64Array.from(frame);
  const imag = new Float64Array(n);

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + len / 2] * wReal - imag[i + j + len / 2] * wImag;
        const vImag = real[i + j + len / 2] * wImag + imag[i + j + len / 2] * wReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + len / 2] = uReal - vReal;
        imag[i + j + len / 2] = uImag - vImag;

        const nextReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextReal;
      }
    }
  }

  const bins = n / 2;
  const magnitudes = new Float32Array(bins);
  for (let i = 0; i < bins; i += 1) {
    magnitudes[i] = Math.sqrt(real[i] ** 2 + imag[i] ** 2);
  }
  return magnitudes;
}

function createFrames(samples) {
  const window = hannWindow(FFT_SIZE);
  const frames = [];
  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP_SIZE) {
    const frame = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i += 1) {
      frame[i] = samples[start + i] * window[i];
    }
    frames.push(fftMagnitudes(frame));
  }
  return frames.length ? frames : [fftMagnitudes(samples.slice(0, FFT_SIZE))];
}

function valueToColor(value, palette = "magma") {
  const v = Math.max(0, Math.min(1, value));
  if (palette === "mfcc") {
    const r = Math.round(35 + 210 * v);
    const g = Math.round(50 + 120 * (1 - Math.abs(v - 0.5) * 2));
    const b = Math.round(95 + 145 * (1 - v));
    return [r, g, b];
  }
  const r = Math.round(20 + 235 * v);
  const g = Math.round(16 + 135 * Math.sqrt(v));
  const b = Math.round(55 + 65 * (1 - v));
  return [r, g, b];
}

function drawHeatmap(canvas, matrix, title, palette = "magma") {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  drawAxes(ctx, width, height, title, "Time", "Frequency");

  const left = 58;
  const top = 42;
  const plotWidth = width - 82;
  const plotHeight = height - 86;
  const rows = matrix[0].length;
  const cols = matrix.length;
  let min = Infinity;
  let max = -Infinity;

  for (const column of matrix) {
    for (const value of column) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  const image = ctx.createImageData(plotWidth, plotHeight);
  for (let y = 0; y < plotHeight; y += 1) {
    const row = Math.floor((1 - y / plotHeight) * (rows - 1));
    for (let x = 0; x < plotWidth; x += 1) {
      const col = Math.floor((x / plotWidth) * (cols - 1));
      const normalized = (matrix[col][row] - min) / (max - min || 1);
      const [r, g, b] = valueToColor(normalized, palette);
      const idx = (y * plotWidth + x) * 4;
      image.data[idx] = r;
      image.data[idx + 1] = g;
      image.data[idx + 2] = b;
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, left, top);
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel) {
  return 700 * (10 ** (mel / 2595) - 1);
}

function melFilterbank(sampleRate, binCount) {
  const minMel = hzToMel(0);
  const maxMel = hzToMel(sampleRate / 2);
  const points = Array.from({ length: MEL_BANDS + 2 }, (_, i) =>
    melToHz(minMel + ((maxMel - minMel) * i) / (MEL_BANDS + 1)),
  );
  const bins = points.map((hz) => Math.floor(((FFT_SIZE + 1) * hz) / sampleRate));
  return Array.from({ length: MEL_BANDS }, (_, m) => {
    const filter = new Float32Array(binCount);
    for (let k = bins[m]; k < bins[m + 1]; k += 1) {
      filter[k] = (k - bins[m]) / Math.max(1, bins[m + 1] - bins[m]);
    }
    for (let k = bins[m + 1]; k < bins[m + 2]; k += 1) {
      filter[k] = (bins[m + 2] - k) / Math.max(1, bins[m + 2] - bins[m + 1]);
    }
    return filter;
  });
}

function computeMfcc(frames, sampleRate) {
  const filters = melFilterbank(sampleRate, frames[0].length);
  return frames.map((magnitudes) => {
    const melEnergies = filters.map((filter) => {
      let energy = 0;
      for (let i = 0; i < filter.length; i += 1) {
        energy += (magnitudes[i] ** 2) * filter[i];
      }
      return Math.log(Math.max(energy, 1e-12));
    });

    return Array.from({ length: MFCC_COUNT }, (_, k) => {
      let sum = 0;
      for (let n = 0; n < MEL_BANDS; n += 1) {
        sum += melEnergies[n] * Math.cos((Math.PI * k * (n + 0.5)) / MEL_BANDS);
      }
      return sum;
    });
  });
}

function normalizeSpectrogram(frames) {
  return frames.map((magnitudes) =>
    Array.from(magnitudes, (value) => 20 * Math.log10(Math.max(value, 1e-8))),
  );
}

function padShortAudio(samples) {
  if (samples.length >= FFT_SIZE) return samples;
  const padded = new Float32Array(FFT_SIZE);
  padded.set(samples);
  return padded;
}

async function analyzeFile(file) {
  setStatus("Loading", "busy");
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const samples = padShortAudio(mixToMono(audioBuffer));

  meta.fileName.textContent = file.name;
  meta.duration.textContent = formatDuration(audioBuffer.duration);
  meta.sampleRate.textContent = `${audioBuffer.sampleRate.toLocaleString()} Hz`;
  meta.channels.textContent = String(audioBuffer.numberOfChannels);

  setStatus("Analyzing", "busy");
  await new Promise((resolve) => setTimeout(resolve, 20));
  drawWaveform(samples, audioBuffer.sampleRate);
  const frames = createFrames(samples);
  drawHeatmap(canvases.spectrogram, normalizeSpectrogram(frames), "Spectrogram", "magma");
  drawHeatmap(canvases.mfcc, computeMfcc(frames, audioBuffer.sampleRate), "MFCC", "mfcc");

  await audioContext.close();
  setStatus("Complete", "done");
}

function handleFiles(files) {
  const file = files?.[0];
  if (!file) return;
  analyzeFile(file).catch((error) => {
    console.error(error);
    setStatus("Error", "busy");
    alert(`Could not analyze this file: ${error.message}`);
  });
}

fileInput.addEventListener("change", (event) => handleFiles(event.target.files));

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  handleFiles(event.dataTransfer.files);
});

document.querySelectorAll(".download-button").forEach((button) => {
  button.addEventListener("click", () => {
    const canvas = document.querySelector(`#${button.dataset.canvas}`);
    const link = document.createElement("a");
    link.download = `${button.dataset.canvas.replace("-canvas", "")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });
});

drawAxes(canvases.waveform.getContext("2d"), canvases.waveform.width, canvases.waveform.height, "Waveform");
drawAxes(
  canvases.spectrogram.getContext("2d"),
  canvases.spectrogram.width,
  canvases.spectrogram.height,
  "Spectrogram",
);
drawAxes(canvases.mfcc.getContext("2d"), canvases.mfcc.width, canvases.mfcc.height, "MFCC");
