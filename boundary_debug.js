const boundaryDebugTable = document.querySelector("#boundary-debug-table");
const FINAL_MIN_SEGMENT = 0.08;

function scoreFinalCandidate(candidate, initial, averageSegment) {
  const distance = Math.abs(candidate.time - initial);
  const proximity = Math.max(0, 1 - distance / Math.max(averageSegment * 1.35, 0.24));
  const acoustic = candidate.score;
  const silenceBonus = candidate.type === "silence" ? 0.22 : 0;
  const mfccBonus = candidate.type === "mfcc" ? 0.08 : 0;
  return acoustic * 0.68 + proximity * 0.22 + silenceBonus + mfccBonus;
}

function chooseCandidateForBoundary(candidates, initial, chosen, averageSegment) {
  const searchRadius = Math.max(averageSegment * 1.6, 0.32);
  const ranked = candidates
    .filter((candidate) => Math.abs(candidate.time - initial) <= searchRadius)
    .filter((candidate) => chosen.every((time) => Math.abs(time - candidate.time) >= MIN_BOUNDARY_DISTANCE))
    .map((candidate) => ({ candidate, finalScore: scoreFinalCandidate(candidate, initial, averageSegment) }))
    .sort((a, b) => b.finalScore - a.finalScore);
  return ranked[0] || null;
}

function repairFinalBoundaries(boundaries, duration) {
  const repaired = [0];
  for (let i = 1; i < boundaries.length - 1; i += 1) {
    const remaining = boundaries.length - 1 - i;
    const min = repaired[i - 1] + FINAL_MIN_SEGMENT;
    const max = duration - FINAL_MIN_SEGMENT * remaining;
    repaired.push(Math.max(min, Math.min(max, boundaries[i])));
  }
  repaired.push(duration);
  return repaired;
}

function alignBoundariesToAudioCandidates(candidates, moraCount, duration) {
  if (moraCount <= 0) return { boundaries: [0, duration], debug: [] };
  if (moraCount === 1) return { boundaries: [0, duration], debug: [] };
  const averageSegment = duration / moraCount;
  const chosenTimes = [];
  const debug = [];
  const raw = [0];
  for (let slot = 1; slot < moraCount; slot += 1) {
    const initial = (duration * slot) / moraCount;
    const selected = chooseCandidateForBoundary(candidates, initial, chosenTimes, averageSegment);
    const preCorrection = selected ? selected.candidate.time : initial;
    chosenTimes.push(preCorrection);
    raw.push(preCorrection);
    debug.push({
      index: slot,
      initial,
      preCorrection,
      candidateTime: selected?.candidate.time ?? null,
      candidateType: selected?.candidate.type ?? "fallback",
      reason: selected ? `${selected.candidate.type} candidate attracted by acoustic score` : "fallback: no strong nearby audio-only candidate",
      score: selected?.candidate.score ?? 0,
      finalScore: selected?.finalScore ?? 0,
    });
  }
  raw.push(duration);
  const repaired = repairFinalBoundaries(raw, duration);
  debug.forEach((item, index) => { item.final = repaired[index + 1]; });
  return { boundaries: repaired, debug };
}

function renderBoundaryDebug(debug) {
  if (!debug.length) {
    boundaryDebugTable.innerHTML = '<tr><td colspan="7">No final internal boundaries.</td></tr>';
    return;
  }
  boundaryDebugTable.innerHTML = debug.map((item) => `
    <tr>
      <td>${item.index}</td>
      <td>${item.initial.toFixed(3)} s</td>
      <td>${item.preCorrection.toFixed(3)} s</td>
      <td>${item.candidateTime == null ? "-" : `${item.candidateType} @ ${item.candidateTime.toFixed(3)} s`}</td>
      <td>${item.final.toFixed(3)} s</td>
      <td>${item.reason}</td>
      <td>${item.score.toFixed(3)} / ${item.finalScore.toFixed(3)}</td>
    </tr>`).join("");
}

function drawTranscriptInitialBoundaries(duration, moraCount) {
  if (!currentAudio || moraCount <= 1) return;
  const boundaries = Array.from({ length: moraCount - 1 }, (_, index) => (duration * (index + 1)) / moraCount);
  for (const canvas of [canvases.waveform, canvases.spectrogram]) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const left = 58;
    const top = 42;
    const plotWidth = width - 82;
    const plotHeight = height - 86;
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    for (const time of boundaries) {
      const x = left + (time / duration) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotHeight);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFinalBoundaries(boundaries) {
  if (!currentAudio) return;
  for (const canvas of [canvases.waveform, canvases.spectrogram]) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const left = 58;
    const top = 42;
    const plotWidth = width - 82;
    const plotHeight = height - 86;
    const duration = currentAudio.duration || 1;
    ctx.save();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 4;
    for (const time of boundaries.slice(1, -1)) {
      const x = left + (time / duration) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + plotHeight);
      ctx.stroke();
    }
    ctx.restore();
  }
}

const originalUpdateResearchOutputs = updateResearchOutputs;
updateResearchOutputs = function updateResearchOutputsWithDebug() {
  if (!currentAudio) return originalUpdateResearchOutputs();
  const tokens = tokenizeTranscript(transcriptInput.value);
  if (!tokens.length) {
    renderBoundaryDebug([]);
    return originalUpdateResearchOutputs();
  }
  const candidates = scoreAudioOnlyBoundaries(currentAudio.samples, currentAudio.sampleRate, currentAudio.duration);
  const aligned = alignBoundariesToAudioCandidates(candidates, tokens.length, currentAudio.duration);
  const originalAlign = alignBoundariesToMora;
  alignBoundariesToMora = function useAudioCandidateBoundaries() { return aligned.boundaries; };
  originalUpdateResearchOutputs();
  alignBoundariesToMora = originalAlign;
  renderBoundaryDebug(aligned.debug);
  redrawBase();
  drawAudioOnlyBoundaries(candidates);
  drawTranscriptInitialBoundaries(currentAudio.duration, tokens.length);
  drawFinalBoundaries(aligned.boundaries);
};
