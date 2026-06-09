const audioOnlyToggle = document.querySelector("#audio-only-toggle");
const audioBoundaryTable = document.querySelector("#audio-boundary-table");
let lastAudioOnlyKey = "";

function estimateFrameF0(samples, sampleRate, frame) {
  return estimateF0(samples, sampleRate, frame.startSample, frame.startSample + FFT_SIZE);
}

function scoreAudioOnlyBoundaries(samples, sampleRate, duration) {
  const frames = createAnalysisFrames(samples, sampleRate);
  const rmsMax = Math.max(...frames.map((frame) => frame.rms), 1e-8);
  const centroidMax = Math.max(...frames.map((frame) => frame.spectralCentroid), 1e-8);
  const frameF0 = frames.map((frame) => estimateFrameF0(samples, sampleRate, frame));
  const candidates = [];

  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1];
    const current = frames[i];
    const lowEnergy = 1 - Math.min(1, (previous.rms + current.rms) / 2 / rmsMax);
    const silence = previous.rms < rmsMax * 0.12 || current.rms < rmsMax * 0.12 ? 1 : 0;
    const rmsScore = Math.max(lowEnergy, silence);
    const centroidScore = Math.abs(current.spectralCentroid - previous.spectralCentroid) / centroidMax;
    const mfccScore = Math.min(1, vdist(previous.mfcc, current.mfcc) / 60);
    const prevF0 = frameF0[i - 1];
    const curF0 = frameF0[i];
    const f0Score = prevF0 && curF0 ? Math.min(1, Math.abs(curF0 - prevF0) / Math.max(prevF0, curF0)) : 0;
    const score = rmsScore * 0.45 + centroidScore * 0.25 + mfccScore * 0.2 + f0Score * 0.1;
    candidates.push({ time: current.startTime, score, rmsScore, centroidScore, mfccScore, f0Score, isPeak: false });
  }

  for (let i = 1; i < candidates.length - 1; i += 1) {
    candidates[i].isPeak = candidates[i].score >= candidates[i - 1].score && candidates[i].score >= candidates[i + 1].score && candidates[i].score >= 0.3;
  }

  const peaks = candidates
    .filter((candidate) => candidate.isPeak && candidate.time > 0.04 && candidate.time < duration - 0.04)
    .sort((a, b) => b.score - a.score);
  const selected = [];
  for (const peak of peaks) {
    if (selected.every((candidate) => Math.abs(candidate.time - peak.time) >= 0.08)) selected.push(peak);
  }
  return selected.sort((a, b) => a.time - b.time);
}

function drawAudioOnlyBoundaries(boundaries) {
  if (!currentAudio || !audioOnlyToggle.checked) return;
  redrawBase();
  const pseudoSegments = boundaries.map((candidate, index) => ({ startTime: candidate.time, endTime: candidate.time, label: String(index + 1) }));
  const times = [0, ...boundaries.map((candidate) => candidate.time), currentAudio.duration];
  drawBoundaryOverlay(canvases.waveform, times, pseudoSegments);
  drawBoundaryOverlay(canvases.spectrogram, times, pseudoSegments);
}

function renderAudioOnlyTable(boundaries) {
  if (!boundaries.length) {
    audioBoundaryTable.innerHTML = '<tr><td colspan="7">No strong audio-only candidates detected.</td></tr>';
    return;
  }
  audioBoundaryTable.innerHTML = boundaries
    .map(
      (candidate, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${candidate.time.toFixed(3)} s</td>
          <td>${candidate.score.toFixed(3)}</td>
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
