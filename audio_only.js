const audioOnlyToggle = document.querySelector("#audio-only-toggle");
const audioBoundaryTable = document.querySelector("#audio-boundary-table");
let lastAudioOnlyKey = "";
const MIN_BOUNDARY_DISTANCE = 0.2;
const RMS_ACTIVE_RATIO = 0.18;

function estimateFrameF0(samples, sampleRate, frame) {
  return estimateF0(samples, sampleRate, frame.startSample, frame.startSample + FFT_SIZE);
}

function movingAverage(values, radius = 2) {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, index - radius); i <= Math.min(values.length - 1, index + radius); i += 1) {
      sum += values[i];
      count += 1;
    }
    return sum / Math.max(1, count);
  });
}

function scoreAudioOnlyBoundaries(samples, sampleRate, duration) {
  const frames = createAnalysisFrames(samples, sampleRate);
  const rmsMax = Math.max(...frames.map((frame) => frame.rms), 1e-8);
  const centroidMax = Math.max(...frames.map((frame) => frame.spectralCentroid), 1e-8);
  const frameF0 = frames.map((frame) => estimateFrameF0(samples, sampleRate, frame));
  const rawMfccDelta = frames.map((frame, index) =>
    index === 0 ? 0 : Math.min(1, vdist(frames[index - 1].mfcc, frame.mfcc) / 60),
  );
  const smoothedMfccDelta = movingAverage(rawMfccDelta, 2);
  const candidates = [];

  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1];
    const current = frames[i];
    const activeEnough = Math.max(previous.rms, current.rms) >= rmsMax * RMS_ACTIVE_RATIO;
    const lowEnergy = 1 - Math.min(1, (previous.rms + current.rms) / 2 / rmsMax);
    const silence = previous.rms < rmsMax * 0.12 || current.rms < rmsMax * 0.12 ? 1 : 0;
    const silenceEntry = previous.rms >= rmsMax * 0.18 && current.rms < rmsMax * 0.12 ? 1 : 0;
    const silenceExit = previous.rms < rmsMax * 0.12 && current.rms >= rmsMax * 0.18 ? 1 : 0;
    const silenceScore = Math.max(silence, silenceEntry, silenceExit);
    const centroidScore = activeEnough ? Math.abs(current.spectralCentroid - previous.spectralCentroid) / centroidMax : 0;
    const mfccScore = activeEnough ? smoothedMfccDelta[i] : 0;
    const prevF0 = frameF0[i - 1];
    const curF0 = frameF0[i];
    const f0Score = activeEnough && prevF0 && curF0 ? Math.min(1, Math.abs(curF0 - prevF0) / Math.max(prevF0, curF0)) : 0;
    const score = silenceScore * 0.55 + centroidScore * 0.18 + mfccScore * 0.18 + f0Score * 0.09;
    const type = silenceScore >= 0.8 ? "silence" : mfccScore >= centroidScore ? "mfcc" : "spectral";
    candidates.push({ time: current.startTime, score, type, activeEnough, silenceScore, rmsScore: silenceScore || lowEnergy, centroidScore, mfccScore, f0Score, isPeak: false });
  }

  for (let i = 1; i < candidates.length - 1; i += 1) {
    candidates[i].isPeak = candidates[i].score >= candidates[i - 1].score && candidates[i].score >= candidates[i + 1].score && candidates[i].score >= 0.34 && (candidates[i].activeEnough || candidates[i].type === "silence");
  }

  const peaks = candidates.filter((candidate) => candidate.isPeak && candidate.time > 0.04 && candidate.time < duration - 0.04).sort((a, b) => b.score - a.score);
  const selected = [];
  for (const peak of peaks.filter((candidate) => candidate.type === "silence")) {
    if (selected.every((candidate) => Math.abs(candidate.time - peak.time) >= MIN_BOUNDARY_DISTANCE)) selected.push(peak);
  }
  for (const peak of peaks.filter((candidate) => candidate.type !== "silence")) {
    if (selected.every((candidate) => Math.abs(candidate.time - peak.time) >= MIN_BOUNDARY_DISTANCE)) selected.push(peak);
  }
  return selected.sort((a, b) => a.time - b.time);
}

function strokeBoundary(ctx, x, top, bottom, type, isFinal = false) {
  const colors = { silence: "#dc2626", mfcc: "#2563eb", spectral: "#9333ea", final: "#111827" };
  ctx.strokeStyle = isFinal ? colors.final : colors[type] || colors.spectral;
  ctx.lineWidth = isFinal ? 3 : 2;
  ctx.setLineDash(isFinal ? [] : [5, 5]);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTypedBoundaryOverlay(canvas, boundaries) {
  if (!currentAudio || !audioOnlyToggle.checked) return;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const left = 58;
  const top = 42;
  const plotWidth = width - 82;
  const plotHeight = height - 86;
  const duration = currentAudio.duration || 1;
  ctx.save();
  ctx.font = "700 13px system-ui, sans-serif";
  boundaries.forEach((candidate, index) => {
    const x = left + (candidate.time / duration) * plotWidth;
    strokeBoundary(ctx, x, top, top + plotHeight, candidate.type, false);
    strokeBoundary(ctx, x, top, top + plotHeight, candidate.type, true);
    ctx.fillStyle = candidate.type === "silence" ? "#dc2626" : candidate.type === "mfcc" ? "#2563eb" : "#9333ea";
    ctx.fillText(`${index + 1}:${candidate.score.toFixed(2)}`, x + 4, top + 18);
  });
  ctx.restore();
}

function drawAudioOnlyBoundaries(boundaries) {
  if (!currentAudio || !audioOnlyToggle.checked) return;
  redrawBase();
  drawTypedBoundaryOverlay(canvases.waveform, boundaries);
  drawTypedBoundaryOverlay(canvases.spectrogram, boundaries);
}

function renderAudioOnlyTable(boundaries) {
  if (!boundaries.length) {
    audioBoundaryTable.innerHTML = '<tr><td colspan="8">No strong audio-only candidates detected.</td></tr>';
    return;
  }
  audioBoundaryTable.innerHTML = boundaries
    .map(
      (candidate, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${candidate.time.toFixed(3)} s</td>
          <td>${candidate.score.toFixed(3)}</td>
          <td>${candidate.type}</td>
          <td>${candidate.rmsScore.toFixed(3)}</td>
          <td>${candidate.centroidScore.toFixed(3)}</td>
          <td>${candidate.mfccScore.toFixed(3)}</td>
          <td>${candidate.f0Score.toFixed(3)}</td>
        </tr>
      `,
    )
    .join("");
}

function updateAudioOnlyMode() {
  if (!currentAudio) return;
  const key = `${currentAudio.fileName}:${currentAudio.duration}:${audioOnlyToggle.checked}`;
  if (key === lastAudioOnlyKey) return;
  lastAudioOnlyKey = key;
  if (!audioOnlyToggle.checked) {
    redrawBase();
    return;
  }
  const boundaries = scoreAudioOnlyBoundaries(currentAudio.samples, currentAudio.sampleRate, currentAudio.duration);
  renderAudioOnlyTable(boundaries);
  drawAudioOnlyBoundaries(boundaries);
}

audioOnlyToggle.addEventListener("change", () => { lastAudioOnlyKey = ""; updateAudioOnlyMode(); });
transcriptInput.addEventListener("input", () => { lastAudioOnlyKey = ""; setTimeout(updateAudioOnlyMode, 0); });

setInterval(updateAudioOnlyMode, 500);
