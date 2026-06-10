const manualAudio = document.querySelector("#manual-audio-player");
const playPauseButton = document.querySelector("#play-pause");
const stopAudioButton = document.querySelector("#stop-audio");
const backOneButton = document.querySelector("#back-one");
const forwardOneButton = document.querySelector("#forward-one");
const playbackRateSelect = document.querySelector("#playback-rate");
const manualCurrentTime = document.querySelector("#manual-current-time");
const manualSelection = document.querySelector("#manual-selection");
const manualLabelInput = document.querySelector("#manual-label");
const addAnnotationButton = document.querySelector("#add-annotation");
const clearSelectionButton = document.querySelector("#clear-selection");
const downloadAnnotationsButton = document.querySelector("#download-annotations");
const downloadManualPresetsButton = document.querySelector("#download-manual-presets");
const manualAnnotationTable = document.querySelector("#manual-annotation-table");
const manualPriorityToggle = document.querySelector("#manual-priority-toggle");

let manualAnnotations = [];
let selectionRange = null;
let pendingClickStart = null;
let dragState = null;
let activeSegmentStop = null;
let manualObjectUrl = null;
let lastManualFile = null;

function featureRms(samples, start, end) {
  if (typeof calculateRms === "function") return calculateRms(samples, start, end);
  return rms(samples, start, end);
}

function featureAverageMfcc(frames) {
  if (typeof averageMfcc === "function") return averageMfcc(frames);
  return avgMfcc(frames);
}

function waveformEventToTime(event) {
  if (!currentAudio) return 0;
  const canvas = canvases.waveform;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const x = (event.clientX - rect.left) * scaleX;
  const left = 58;
  const plotWidth = canvas.width - 82;
  const ratio = Math.max(0, Math.min(1, (x - left) / plotWidth));
  return ratio * currentAudio.duration;
}

function normalizeRange(startTime, endTime) {
  const start = Math.max(0, Math.min(startTime, endTime));
  const end = Math.min(currentAudio?.duration || 0, Math.max(startTime, endTime));
  if (end - start < 0.01) return null;
  return { startTime: start, endTime: end };
}

function formatSelection(range) {
  if (!range) return "Click or drag on the waveform";
  return `${range.startTime.toFixed(3)} s - ${range.endTime.toFixed(3)} s (${(range.endTime - range.startTime).toFixed(3)} s)`;
}

function setSelection(range) {
  selectionRange = range;
  manualSelection.textContent = formatSelection(range);
  drawManualAnnotations();
}

function drawManualRange(ctx, range, color, label = "", dashed = false) {
  if (!currentAudio || !range) return;
  const canvas = canvases.waveform;
  const left = 58;
  const top = 42;
  const plotWidth = canvas.width - 82;
  const plotHeight = canvas.height - 86;
  const x1 = left + (range.startTime / currentAudio.duration) * plotWidth;
  const x2 = left + (range.endTime / currentAudio.duration) * plotWidth;

  ctx.save();
  ctx.fillStyle = color.replace("1)", "0.14)");
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.fillRect(x1, top, Math.max(1, x2 - x1), plotHeight);
  ctx.strokeRect(x1, top, Math.max(1, x2 - x1), plotHeight);
  if (label) {
    ctx.fillStyle = color;
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.fillText(label, x1 + 4, top + 18);
  }
  ctx.restore();
}

function drawManualAnnotations() {
  if (!currentAudio) return;
  redrawBase();
  const ctx = canvases.waveform.getContext("2d");
  manualAnnotations.forEach((annotation) => {
    drawManualRange(
      ctx,
      annotation,
      annotation.source === "manual" ? "rgba(15, 118, 110, 1)" : "rgba(194, 65, 12, 1)",
      annotation.label,
      false,
    );
  });
  if (selectionRange) drawManualRange(ctx, selectionRange, "rgba(37, 99, 235, 1)", "selection", true);
}

function segmentFrames(startTime, endTime) {
  if (!currentAudio) return [];
  return createAnalysisFrames(currentAudio.samples, currentAudio.sampleRate).filter(
    (frame) => frame.centerTime >= startTime && frame.centerTime <= endTime,
  );
}

function estimateFormants(frames, sampleRate) {
  const bins = Math.floor(FFT_SIZE / 2);
  const averaged = new Array(bins).fill(0);
  for (const frame of frames) {
    for (let i = 0; i < bins; i += 1) averaged[i] += frame.magnitudes[i] || 0;
  }
  const scale = Math.max(1, frames.length);
  for (let i = 0; i < bins; i += 1) averaged[i] /= scale;

  const findPeak = (minHz, maxHz) => {
    const minBin = Math.max(1, Math.floor((minHz * FFT_SIZE) / sampleRate));
    const maxBin = Math.min(bins - 2, Math.ceil((maxHz * FFT_SIZE) / sampleRate));
    let bestBin = null;
    let bestValue = -Infinity;
    for (let i = minBin; i <= maxBin; i += 1) {
      const isPeak = averaged[i] >= averaged[i - 1] && averaged[i] >= averaged[i + 1];
      if (isPeak && averaged[i] > bestValue) {
        bestValue = averaged[i];
        bestBin = i;
      }
    }
    return bestBin == null ? null : (bestBin * sampleRate) / FFT_SIZE;
  };

  return {
    f1: findPeak(200, 1000),
    f2: findPeak(800, 3000),
    f3: findPeak(1800, 4500),
    method: "spectral-peak-estimate",
  };
}

function extractManualFeatures(label, startTime, endTime) {
  const startSample = Math.floor(startTime * currentAudio.sampleRate);
  const endSample = Math.min(currentAudio.samples.length, Math.floor(endTime * currentAudio.sampleRate));
  const samples = currentAudio.samples.slice(startSample, endSample);
  const padded = padShortAudio(samples);
  const frames = segmentFrames(startTime, endTime);
  const mfccMean = featureAverageMfcc(computeMfcc(createFrames(padded), currentAudio.sampleRate));
  const formants = estimateFormants(frames, currentAudio.sampleRate);

  return {
    id: `manual_${String(Date.now()).slice(-8)}_${manualAnnotations.length + 1}`,
    source: "manual",
    label,
    startTime,
    endTime,
    duration: endTime - startTime,
    rms: featureRms(currentAudio.samples, startSample, endSample),
    estimatedF0: estimateF0(currentAudio.samples, currentAudio.sampleRate, startSample, endSample),
    spectralCentroid: mean(frames.map((frame) => frame.spectralCentroid)),
    mfccMean,
    formants,
    presetPath: `presets/manual/${label.replace(/[^a-zA-Z0-9_-]+/g, "_")}.json`,
    controls: {
      pitchShift: 0,
      speedRatio: 1,
      gainDb: 0,
      formantShift: 0,
    },
  };
}

function renderManualAnnotations() {
  if (!manualAnnotations.length) {
    manualAnnotationTable.innerHTML =
      '<tr><td colspan="10">Upload audio, then click or drag on the waveform to create annotations.</td></tr>';
    return;
  }

  manualAnnotationTable.innerHTML = manualAnnotations
    .map(
      (annotation, index) => `
        <tr>
          <td><code>${escapeHtml(annotation.label)}</code></td>
          <td>${annotation.startTime.toFixed(3)} s</td>
          <td>${annotation.endTime.toFixed(3)} s</td>
          <td>${annotation.duration.toFixed(3)} s</td>
          <td>${annotation.rms.toFixed(5)}</td>
          <td>${formatHz(annotation.estimatedF0)}</td>
          <td>${annotation.spectralCentroid.toFixed(1)} Hz</td>
          <td>${["f1", "f2", "f3"].map((key) => annotation.formants[key] ? annotation.formants[key].toFixed(0) : "-").join(" / ")}</td>
          <td>${annotation.mfccMean.slice(0, 5).map((value) => value.toFixed(2)).join(", ")} ...</td>
          <td>
            <div class="annotation-actions">
              <button class="download-button" type="button" data-play-annotation="${index}">Play</button>
              <button class="download-button" type="button" data-edit-annotation="${index}">Edit</button>
              <button class="download-button" type="button" data-delete-annotation="${index}">Delete</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");
}

function createManualAnnotationPayload() {
  return {
    schemaVersion: 1,
    mode: manualPriorityToggle.checked ? "manual-priority" : "manual-annotation",
    input: {
      audioFile: currentAudio?.fileName || null,
      duration: currentAudio?.duration || null,
      sampleRate: currentAudio?.sampleRate || null,
    },
    annotations: manualAnnotations,
    presetDirectory: "presets/manual/",
  };
}

function createManualPresetPayload() {
  const presets = {};
  for (const annotation of manualAnnotations) {
    presets[annotation.label] = presets[annotation.label] || [];
    presets[annotation.label].push({
      label: annotation.label,
      sourceAudio: currentAudio?.fileName || null,
      startTime: annotation.startTime,
      endTime: annotation.endTime,
      duration: annotation.duration,
      rms: annotation.rms,
      estimatedF0: annotation.estimatedF0,
      spectralCentroid: annotation.spectralCentroid,
      mfccMean: annotation.mfccMean,
      formants: annotation.formants,
      controls: annotation.controls,
    });
  }
  return {
    schemaVersion: 1,
    directory: "presets/manual/",
    presets,
  };
}

function refreshManualAudioSource() {
  let sourceUrl = currentAudio?.sourceUrl;
  const sourceFile = lastManualFile || fileInput.files?.[0];
  if (!sourceUrl && sourceFile) {
    if (manualObjectUrl) URL.revokeObjectURL(manualObjectUrl);
    manualObjectUrl = URL.createObjectURL(sourceFile);
    sourceUrl = manualObjectUrl;
  }
  if (!sourceUrl || manualAudio.src === sourceUrl) return;
  manualAudio.src = sourceUrl;
  manualAudio.playbackRate = Number(playbackRateSelect.value);
  manualAnnotations = [];
  pendingClickStart = null;
  setSelection(null);
  renderManualAnnotations();
  updateManualTime();
}

function updateManualTime() {
  const current = manualAudio.currentTime || 0;
  const duration = currentAudio?.duration || manualAudio.duration || 0;
  manualCurrentTime.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
}

function playSelectedAnnotation(annotation) {
  if (!annotation || !manualAudio.src) return;
  activeSegmentStop = annotation.endTime;
  manualAudio.currentTime = annotation.startTime;
  manualAudio.play();
}

function syncManualPriorityExperiment() {
  if (!manualPriorityToggle.checked || !currentAudio || !manualAnnotations.length) return;
  currentExperiment = {
    schemaVersion: 1,
    goal: "Manual voice annotation dataset",
    input: {
      audioFile: currentAudio.fileName,
      transcript: transcriptInput.value,
    },
    audio: {
      duration: currentAudio.duration,
      sampleRate: currentAudio.sampleRate,
      channels: currentAudio.channels,
    },
    segmentation: {
      method: "manual-annotation",
      boundaries: [0, ...manualAnnotations.map((item) => item.startTime), ...manualAnnotations.map((item) => item.endTime), currentAudio.duration]
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort((a, b) => a - b),
    },
    annotations: manualAnnotations,
    presetDirectories: {
      manual: "presets/manual/",
      vowels: "presets/vowels/",
      consonants: "presets/consonants/",
      speakers: "presets/speakers/",
    },
  };
}

canvases.waveform.addEventListener("pointerdown", (event) => {
  if (!currentAudio) return;
  canvases.waveform.setPointerCapture(event.pointerId);
  const time = waveformEventToTime(event);
  dragState = { startTime: time, lastTime: time, moved: false };
});

canvases.waveform.addEventListener("pointermove", (event) => {
  if (!dragState || !currentAudio) return;
  const time = waveformEventToTime(event);
  dragState.lastTime = time;
  if (Math.abs(time - dragState.startTime) > 0.02) dragState.moved = true;
  if (dragState.moved) setSelection(normalizeRange(dragState.startTime, time));
});

canvases.waveform.addEventListener("pointerup", (event) => {
  if (!dragState || !currentAudio) return;
  const time = waveformEventToTime(event);
  if (dragState.moved) {
    setSelection(normalizeRange(dragState.startTime, time));
  } else if (pendingClickStart == null) {
    pendingClickStart = time;
    setSelection({ startTime: time, endTime: time + 0.01 });
  } else {
    setSelection(normalizeRange(pendingClickStart, time));
    pendingClickStart = null;
  }
  dragState = null;
});

playPauseButton.addEventListener("click", () => {
  refreshManualAudioSource();
  if (!manualAudio.src) return;
  if (manualAudio.paused) {
    manualAudio.play();
  } else {
    manualAudio.pause();
  }
});

stopAudioButton.addEventListener("click", () => {
  manualAudio.pause();
  manualAudio.currentTime = 0;
  activeSegmentStop = null;
  updateManualTime();
});

backOneButton.addEventListener("click", () => {
  manualAudio.currentTime = Math.max(0, manualAudio.currentTime - 1);
});

forwardOneButton.addEventListener("click", () => {
  manualAudio.currentTime = Math.min(currentAudio?.duration || manualAudio.duration || 0, manualAudio.currentTime + 1);
});

playbackRateSelect.addEventListener("change", () => {
  manualAudio.playbackRate = Number(playbackRateSelect.value);
});

manualAudio.addEventListener("play", () => {
  playPauseButton.textContent = "Pause";
});

manualAudio.addEventListener("pause", () => {
  playPauseButton.textContent = "Play";
});

manualAudio.addEventListener("timeupdate", () => {
  updateManualTime();
  if (activeSegmentStop != null && manualAudio.currentTime >= activeSegmentStop) {
    manualAudio.pause();
    activeSegmentStop = null;
  }
});

addAnnotationButton.addEventListener("click", () => {
  refreshManualAudioSource();
  const label = manualLabelInput.value.trim();
  if (!currentAudio || !selectionRange || !label) return;
  manualAnnotations.push(extractManualFeatures(label, selectionRange.startTime, selectionRange.endTime));
  manualAnnotations.sort((a, b) => a.startTime - b.startTime);
  manualLabelInput.value = "";
  pendingClickStart = null;
  setSelection(null);
  renderManualAnnotations();
  drawManualAnnotations();
  syncManualPriorityExperiment();
});

clearSelectionButton.addEventListener("click", () => {
  pendingClickStart = null;
  setSelection(null);
});

manualAnnotationTable.addEventListener("click", (event) => {
  const playIndex = event.target.dataset.playAnnotation;
  const editIndex = event.target.dataset.editAnnotation;
  const deleteIndex = event.target.dataset.deleteAnnotation;

  if (playIndex != null) playSelectedAnnotation(manualAnnotations[Number(playIndex)]);
  if (editIndex != null) {
    const index = Number(editIndex);
    const nextLabel = prompt("Edit label", manualAnnotations[index].label);
    if (nextLabel) {
      manualAnnotations[index].label = nextLabel.trim();
      manualAnnotations[index].presetPath = `presets/manual/${nextLabel.replace(/[^a-zA-Z0-9_-]+/g, "_")}.json`;
      renderManualAnnotations();
      drawManualAnnotations();
      syncManualPriorityExperiment();
    }
  }
  if (deleteIndex != null) {
    manualAnnotations.splice(Number(deleteIndex), 1);
    renderManualAnnotations();
    drawManualAnnotations();
    syncManualPriorityExperiment();
  }
});

downloadAnnotationsButton.addEventListener("click", () => {
  if (!manualAnnotations.length) return;
  downloadTextFile("annotations.json", JSON.stringify(createManualAnnotationPayload(), null, 2), "application/json");
});

downloadManualPresetsButton.addEventListener("click", () => {
  if (!manualAnnotations.length) return;
  downloadTextFile("presets_manual.json", JSON.stringify(createManualPresetPayload(), null, 2), "application/json");
});

manualPriorityToggle.addEventListener("change", syncManualPriorityExperiment);
fileInput.addEventListener("change", (event) => {
  lastManualFile = event.target.files?.[0] || null;
});
dropZone.addEventListener("drop", (event) => {
  lastManualFile = event.dataTransfer.files?.[0] || null;
});
transcriptInput.addEventListener("input", () => {
  setTimeout(() => {
    if (manualPriorityToggle.checked) syncManualPriorityExperiment();
    drawManualAnnotations();
  }, 0);
});

const originalManualUpdateResearchOutputs = updateResearchOutputs;
updateResearchOutputs = function updateResearchOutputsWithManualAnnotations() {
  const result = originalManualUpdateResearchOutputs();
  refreshManualAudioSource();
  if (manualPriorityToggle.checked) syncManualPriorityExperiment();
  drawManualAnnotations();
  return result;
};

setInterval(refreshManualAudioSource, 500);
