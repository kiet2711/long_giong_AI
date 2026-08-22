/**
 * AI Dubbing & Video Sync Studio - Frontend Application
 */

// Application State
const state = {
  videoPath: null,
  videoUrl: null,
  videoMeta: null,
  srtDubPath: null,
  srtOrigPath: null,
  subtitles: [],
  voices: [],
  currentJobId: null,
  socket: null,
  isPlaying: false,
  currentTime: 0.0,
  totalDuration: 18.0,
  previewAudio: new Audio(),
};

// DOM Elements
const el = {
  // Inputs
  videoInput: document.getElementById('videoInput'),
  srtDubInput: document.getElementById('srtDubInput'),
  srtOrigInput: document.getElementById('srtOrigInput'),
  videoFileName: document.getElementById('videoFileName'),
  srtDubFileName: document.getElementById('srtDubFileName'),
  srtOrigFileName: document.getElementById('srtOrigFileName'),
  
  // Voice & Tuning
  voiceSelect: document.getElementById('voiceSelect'),
  voiceRateSelect: document.getElementById('voiceRateSelect'),
  btnPreviewVoice: document.getElementById('btnPreviewVoice'),
  audioSpeedRangeBadge: document.getElementById('audioSpeedRangeBadge'),
  audioRangeHighlight: document.getElementById('audioRangeHighlight'),
  minAudioSpeedSlider: document.getElementById('minAudioSpeedSlider'),
  maxAudioSpeedSlider: document.getElementById('maxAudioSpeedSlider'),
  videoSpeedRangeBadge: document.getElementById('videoSpeedRangeBadge'),
  videoRangeHighlight: document.getElementById('videoRangeHighlight'),
  minVideoSpeedSlider: document.getElementById('minVideoSpeedSlider'),
  maxVideoSpeedSlider: document.getElementById('maxVideoSpeedSlider'),
  origVolSlider: document.getElementById('origVolSlider'),
  origVolBadge: document.getElementById('origVolBadge'),
  dubVolSlider: document.getElementById('dubVolSlider'),
  dubVolBadge: document.getElementById('dubVolBadge'),
  threadsSlider: document.getElementById('threadsSlider'),
  threadsValue: document.getElementById('threadsValue'),
  btnStartDubbing: document.getElementById('btnStartDubbing'),

  // Video Player
  mainVideo: document.getElementById('mainVideo'),
  videoPlaceholder: document.getElementById('videoPlaceholder'),
  captionBox: document.getElementById('captionBox'),
  captionText: document.getElementById('captionText'),
  playBtn: document.getElementById('playBtn'),
  playIcon: document.getElementById('playIcon'),
  curTimeText: document.getElementById('curTimeText'),
  totalTimeText: document.getElementById('totalTimeText'),
  tbar: document.getElementById('tbar'),
  tbarFill: document.getElementById('tbarFill'),
  tbarKnob: document.getElementById('tbarKnob'),
  waveA: document.getElementById('waveA'),
  waveV: document.getElementById('waveV'),

  // Subtitle Pane
  srtList: document.getElementById('srtList'),
  srtCountLabel: document.getElementById('srtCountLabel'),
  rangeIndicator: document.getElementById('rangeIndicator'),

  // Modal Progress
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalTitle: document.getElementById('modalTitle'),
  progressBarFill: document.getElementById('progressBarFill'),
  statusMsg: document.getElementById('statusMsg'),
  logBox: document.getElementById('logBox'),
  btnModalClose: document.getElementById('btnModalClose'),
  btnDownloadResult: document.getElementById('btnDownloadResult'),
  btnDownloadSrt: document.getElementById('btnDownloadSrt'),

  // Floating Job Status
  floatingJobPill: document.getElementById('floatingJobPill'),
  floatingSpinner: document.getElementById('floatingSpinner'),
  floatingJobTitle: document.getElementById('floatingJobTitle'),
  floatingJobPct: document.getElementById('floatingJobPct'),
  btnOpenModalFromFloating: document.getElementById('btnOpenModalFromFloating'),

  // Failed Review UI
  failedReviewContainer: document.getElementById('failedReviewContainer'),
  failedCountBadge: document.getElementById('failedCountBadge'),
  failedList: document.getElementById('failedList'),
  btnRetryAllFailed: document.getElementById('btnRetryAllFailed'),
  btnSkipFailedAndRender: document.getElementById('btnSkipFailedAndRender'),
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadVoices();
  buildFakeWaveforms();
  setupEventListeners();
  loadSampleMockData();
  updateOrigVolUI();
  updateDubVolUI();
  updateSpeedLimitsUI();
  checkAndRestoreActiveJob();
});

function updateSpeedLimitsUI() {
  // 1. Audio Speed Range
  if (el.minAudioSpeedSlider && el.maxAudioSpeedSlider) {
    let minA = parseFloat(el.minAudioSpeedSlider.value) || 0.80;
    let maxA = parseFloat(el.maxAudioSpeedSlider.value) || 1.20;
    if (minA > maxA) {
      minA = maxA;
      el.minAudioSpeedSlider.value = minA;
    }

    // Audio range is 0.50 to 2.00 (total span = 1.50)
    const leftPct = ((minA - 0.50) / 1.50) * 100;
    const rightPct = ((maxA - 0.50) / 1.50) * 100;
    if (el.audioRangeHighlight) {
      el.audioRangeHighlight.style.left = `${leftPct}%`;
      el.audioRangeHighlight.style.width = `${Math.max(2, rightPct - leftPct)}%`;
    }

    if (el.audioSpeedRangeBadge) {
      if (Math.abs(minA - 1.0) < 0.01 && Math.abs(maxA - 1.0) < 0.01) {
        el.audioSpeedRangeBadge.textContent = '1.00x (Khóa cố định)';
      } else if (Math.abs(minA - maxA) < 0.01) {
        el.audioSpeedRangeBadge.textContent = `${minA.toFixed(2)}x (Cố định)`;
      } else {
        el.audioSpeedRangeBadge.textContent = `${minA.toFixed(2)}x ⟷ ${maxA.toFixed(2)}x`;
      }
    }
  }

  // 2. Video Speed Range
  if (el.minVideoSpeedSlider && el.maxVideoSpeedSlider) {
    let minV = parseFloat(el.minVideoSpeedSlider.value) || 0.50;
    let maxV = parseFloat(el.maxVideoSpeedSlider.value) || 1.50;
    if (minV > maxV) {
      minV = maxV;
      el.minVideoSpeedSlider.value = minV;
    }

    // Video range is 0.30 to 2.00 (total span = 1.70)
    const leftPct = ((minV - 0.30) / 1.70) * 100;
    const rightPct = ((maxV - 0.30) / 1.70) * 100;
    if (el.videoRangeHighlight) {
      el.videoRangeHighlight.style.left = `${leftPct}%`;
      el.videoRangeHighlight.style.width = `${Math.max(2, rightPct - leftPct)}%`;
    }

    if (el.videoSpeedRangeBadge) {
      if (Math.abs(minV - 1.0) < 0.01 && Math.abs(maxV - 1.0) < 0.01) {
        el.videoSpeedRangeBadge.textContent = '1.00x (Khóa 1.0x - 0s Encode)';
      } else if (Math.abs(minV - maxV) < 0.01) {
        el.videoSpeedRangeBadge.textContent = `${minV.toFixed(2)}x (Cố định)`;
      } else {
        el.videoSpeedRangeBadge.textContent = `${minV.toFixed(2)}x ⟷ ${maxV.toFixed(2)}x`;
      }
    }
  }
}

function updateOrigVolUI() {
  if (!el.origVolSlider || !el.origVolBadge) return;
  const val = parseInt(el.origVolSlider.value, 10);
  let desc = `${val}%`;
  if (val === 0) desc = '0% (Tắt tiếng gốc)';
  else if (val <= 20) desc = `${val}% (Nền nhỏ)`;
  else if (val <= 60) desc = `${val}% (Nền vừa)`;
  else if (val === 100) desc = '100% (Gốc 100%)';
  else desc = `${val}% (Khuếch đại)`;
  el.origVolBadge.textContent = desc;
}

function updateDubVolUI() {
  if (!el.dubVolSlider || !el.dubVolBadge) return;
  const val = parseInt(el.dubVolSlider.value, 10);
  let desc = `${val}%`;
  if (val === 100) desc = '100% (Chuẩn)';
  else if (val === 120) desc = '120% (Rõ nét)';
  else if (val > 150) desc = `${val}% (Khuếch đại lớn)`;
  el.dubVolBadge.textContent = desc;
}

// --- API: Load Voices ---
async function loadVoices() {
  try {
    const res = await fetch('/api/voices');
    const data = await res.json();
    state.voices = data.voices || [];

    el.voiceSelect.innerHTML = '';
    state.voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voice_type;
      opt.dataset.resourceId = v.resource_id || '';
      const isVn = (v.lang || '').toLowerCase() === 'vi-vn';
      opt.textContent = `${isVn ? '🇻🇳 ' : '🌐 '}${v.display_name} (${v.voice_type})`;
      if (v.voice_type === 'BV421_vivn_streaming') {
        opt.selected = true;
      }
      el.voiceSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load voices:', err);
  }
}

// --- Preview Voice TTS ---
el.btnPreviewVoice.addEventListener('click', async () => {
  const voice = el.voiceSelect.value;
  const rate = el.voiceRateSelect.value;
  const sampleText = "Xin chào! Đây là bản nghe thử giọng đọc AI của CapCut.";

  el.btnPreviewVoice.disabled = true;
  el.btnPreviewVoice.textContent = "Đang tải...";

  try {
    const res = await fetch('/api/preview_tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sampleText, voice, rate }),
    });
    const data = await res.json();
    if (data.audio_url) {
      state.previewAudio.src = data.audio_url;
      state.previewAudio.play();
    }
  } catch (err) {
    alert('Không thể nghe thử giọng đọc: ' + err.message);
  } finally {
    el.btnPreviewVoice.disabled = false;
    el.btnPreviewVoice.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg> Nghe thử giọng`;
  }
});

// --- Upload & Parse Handlers ---
function setupEventListeners() {
  el.videoInput.addEventListener('change', handleFileSelection);
  el.srtDubInput.addEventListener('change', handleFileSelection);
  el.srtOrigInput.addEventListener('change', handleFileSelection);

  // Player controls
  el.playBtn.addEventListener('click', togglePlay);
  el.tbar.addEventListener('click', handleSeek);
  el.mainVideo.addEventListener('timeupdate', onVideoTimeUpdate);
  el.mainVideo.addEventListener('ended', () => {
    state.isPlaying = false;
    updatePlayButton();
  });

  // Range sliders
  if (el.origVolSlider) {
    el.origVolSlider.addEventListener('input', updateOrigVolUI);
  }
  if (el.dubVolSlider) {
    el.dubVolSlider.addEventListener('input', updateDubVolUI);
  }

  // Dual Range Slider 1: Audio Speed
  if (el.minAudioSpeedSlider && el.maxAudioSpeedSlider) {
    el.minAudioSpeedSlider.addEventListener('input', () => {
      const minA = parseFloat(el.minAudioSpeedSlider.value);
      const maxA = parseFloat(el.maxAudioSpeedSlider.value);
      if (minA > maxA) el.maxAudioSpeedSlider.value = minA;
      updateSpeedLimitsUI();
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    });

    el.maxAudioSpeedSlider.addEventListener('input', () => {
      const minA = parseFloat(el.minAudioSpeedSlider.value);
      const maxA = parseFloat(el.maxAudioSpeedSlider.value);
      if (maxA < minA) el.minAudioSpeedSlider.value = maxA;
      updateSpeedLimitsUI();
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    });
  }

  // Dual Range Slider 2: Video Speed
  if (el.minVideoSpeedSlider && el.maxVideoSpeedSlider) {
    el.minVideoSpeedSlider.addEventListener('input', () => {
      const minV = parseFloat(el.minVideoSpeedSlider.value);
      const maxV = parseFloat(el.maxVideoSpeedSlider.value);
      if (minV > maxV) el.maxVideoSpeedSlider.value = minV;
      updateSpeedLimitsUI();
    });

    el.maxVideoSpeedSlider.addEventListener('input', () => {
      const minV = parseFloat(el.minVideoSpeedSlider.value);
      const maxV = parseFloat(el.maxVideoSpeedSlider.value);
      if (maxV < minV) el.minVideoSpeedSlider.value = maxV;
      updateSpeedLimitsUI();
    });
  }

  // Quick preset buttons
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target === 'orig' && el.origVolSlider) {
        el.origVolSlider.value = btn.dataset.val;
        updateOrigVolUI();
      } else if (target === 'dub' && el.dubVolSlider) {
        el.dubVolSlider.value = btn.dataset.val;
        updateDubVolUI();
      } else if (target === 'audiorange' && el.minAudioSpeedSlider && el.maxAudioSpeedSlider) {
        el.minAudioSpeedSlider.value = btn.dataset.min;
        el.maxAudioSpeedSlider.value = btn.dataset.max;
        updateSpeedLimitsUI();
        if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
      } else if (target === 'videorange' && el.minVideoSpeedSlider && el.maxVideoSpeedSlider) {
        el.minVideoSpeedSlider.value = btn.dataset.min;
        el.maxVideoSpeedSlider.value = btn.dataset.max;
        updateSpeedLimitsUI();
      }
    });
  });

  el.threadsSlider.addEventListener('input', () => {
    el.threadsValue.textContent = `${el.threadsSlider.value} luồng`;
  });

  // Cleanup Cache Button
  const btnCleanup = document.getElementById('btnCleanup');
  if (btnCleanup) {
    btnCleanup.addEventListener('click', async () => {
      btnCleanup.disabled = true;
      btnCleanup.textContent = 'Đang dọn dẹp...';
      try {
        const res = await fetch('/api/cleanup', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Đã dọn dẹp thành công bộ nhớ đệm!');
      } catch (err) {
        alert('Lỗi dọn dẹp: ' + err.message);
      } finally {
        btnCleanup.disabled = false;
        btnCleanup.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          Dọn dẹp rác bộ nhớ
        `;
      }
    });
  }

  // Start Dubbing Button
  el.btnStartDubbing.addEventListener('click', startDubbingProcess);
  if (el.btnModalClose) {
    el.btnModalClose.addEventListener('click', () => {
      el.modalBackdrop.classList.remove('show');
      if (state.currentJobId && el.floatingJobPill) {
        el.floatingJobPill.style.display = 'flex';
      }
    });
  }

  if (el.btnOpenModalFromFloating) {
    el.btnOpenModalFromFloating.addEventListener('click', (e) => {
      e.stopPropagation();
      el.modalBackdrop.classList.add('show');
      if (el.floatingJobPill) el.floatingJobPill.style.display = 'none';
    });
  }

  if (el.floatingJobPill) {
    el.floatingJobPill.addEventListener('click', () => {
      el.modalBackdrop.classList.add('show');
      el.floatingJobPill.style.display = 'none';
    });
  }

  // Failed Review actions
  if (el.btnRetryAllFailed) {
    el.btnRetryAllFailed.addEventListener('click', retryAllFailedSegments);
  }
  if (el.btnSkipFailedAndRender) {
    el.btnSkipFailedAndRender.addEventListener('click', resumeDubbingRender);
  }
}

async function handleFileSelection() {
  const vFile = el.videoInput.files[0];
  const srtDubFile = el.srtDubInput.files[0];
  const srtOrigFile = el.srtOrigInput.files[0];

  if (vFile) el.videoFileName.textContent = vFile.name;
  if (srtDubFile) el.srtDubFileName.textContent = srtDubFile.name;
  if (srtOrigFile) el.srtOrigFileName.textContent = srtOrigFile.name;

  if (!vFile && !srtDubFile) return;

  const formData = new FormData();
  if (vFile) formData.append('video', vFile);
  if (srtDubFile) formData.append('srt_dub', srtDubFile);
  if (srtOrigFile) formData.append('srt_orig', srtOrigFile);

  try {
    const res = await fetch('/api/upload_files', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (data.video_path) {
      state.videoPath = data.video_path;
      state.videoUrl = data.video_url;
      state.videoMeta = data.video_meta;
      if (data.video_meta && data.video_meta.duration) {
        state.totalDuration = data.video_meta.duration;
      }
      loadVideoIntoPlayer(data.video_url);
    }

    if (data.srt_dub_path) state.srtDubPath = data.srt_dub_path;
    if (data.srt_orig_path) state.srtOrigPath = data.srt_orig_path;

    if (data.subtitles && data.subtitles.length > 0) {
      state.subtitles = data.subtitles;
      renderSubtitleList(state.subtitles);
    }
  } catch (err) {
    alert('Lỗi tải file lên: ' + err.message);
  }
}

function getSpeedBadgeInfo(item) {
  const ratio = item.ratio || 1.0;
  const minAudioSpeed = el.minAudioSpeedSlider ? parseFloat(el.minAudioSpeedSlider.value) || 0.80 : 0.80;
  const maxAudioSpeed = el.maxAudioSpeedSlider ? parseFloat(el.maxAudioSpeedSlider.value) || 1.20 : 1.20;
  const maxVideoSpeed = el.maxVideoSpeedSlider ? parseFloat(el.maxVideoSpeedSlider.value) || 1.50 : 1.50;

  if (item.sync_desc) {
    let cls = 'ok';
    if (item.sync_mode === 'rubberband') cls = 'ok';
    else if (item.sync_mode === 'setpts') cls = 'warn';
    return { text: item.sync_desc, cls };
  }

  if (Math.abs(ratio - 1.0) < 0.05) {
    return { text: 'Chuẩn 1.0x (Khớp)', cls: 'ok' };
  }

  if (ratio > 1.0) {
    // Audio is shorter than video duration -> ratio = Dv / Da > 1.0
    const reqAudioSpeed = 1.0 / ratio;
    if (reqAudioSpeed >= minAudioSpeed && minAudioSpeed < 0.99) {
      return { text: `Giảm giọng ${reqAudioSpeed.toFixed(2)}x`, cls: 'ok' };
    } else {
      const vSpeed = Math.min(maxVideoSpeed, ratio);
      return { text: `Tăng video ${vSpeed.toFixed(2)}x`, cls: 'warn' };
    }
  } else {
    // Audio is longer than video duration -> ratio = Dv / Da < 1.0
    const reqAudioSpeed = 1.0 / Math.max(0.1, ratio);
    if (reqAudioSpeed <= maxAudioSpeed) {
      return { text: `Tăng giọng ${reqAudioSpeed.toFixed(2)}x`, cls: 'ok' };
    } else {
      return { text: `Chậm video ${ratio.toFixed(2)}x`, cls: 'warn' };
    }
  }
}

// --- Render Subtitle List ---
function renderSubtitleList(subs) {
  el.srtList.innerHTML = '';
  el.srtCountLabel.textContent = `SRT — ${subs.length} DÒNG`;

  if (subs.length > 0) {
    const first = subs[0];
    const last = subs[subs.length - 1];
    el.rangeIndicator.textContent = `${fmtTime(first.start_sec)} – ${fmtTime(last.end_sec)}`;
  }

  subs.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'srt-line';
    div.dataset.idx = item.index;
    div.dataset.start = item.start_sec;
    div.dataset.end = item.end_sec;

    const badgeInfo = getSpeedBadgeInfo(item);

    div.innerHTML = `
      <div class="srt-idx">${String(item.index).padStart(2, '0')}</div>
      <div class="srt-body">
        <div class="srt-time">
          <span>${fmtTime(item.start_sec)} → ${fmtTime(item.end_sec)} (${item.duration_sec.toFixed(1)}s)</span>
          <span class="ratio ${badgeInfo.cls}" id="ratio-badge-${item.index}">${badgeInfo.text}</span>
        </div>
        <div class="srt-text">${escapeHtml(item.text_dub)}</div>
        ${item.text_orig ? `<div class="orig">${escapeHtml(item.text_orig)}</div>` : ''}
      </div>
    `;

    div.addEventListener('click', () => {
      seekToTime(item.start_sec + 0.05);
    });
    el.srtList.appendChild(div);
  });
}

// --- Player Logic ---
function loadVideoIntoPlayer(url) {
  el.videoPlaceholder.style.display = 'none';
  el.mainVideo.src = url;
  el.mainVideo.load();
  el.mainVideo.onloadedmetadata = () => {
    state.totalDuration = el.mainVideo.duration || state.totalDuration;
    el.totalTimeText.textContent = fmtTime(state.totalDuration);
    updatePlayerUI();
  };
}

function togglePlay() {
  if (el.mainVideo.src) {
    if (el.mainVideo.paused) {
      el.mainVideo.play();
      state.isPlaying = true;
    } else {
      el.mainVideo.pause();
      state.isPlaying = false;
    }
  } else {
    // Mock timer if no real video loaded
    state.isPlaying = !state.isPlaying;
    if (state.isPlaying) {
      state.mockTimer = setInterval(() => {
        state.currentTime += 0.1;
        if (state.currentTime >= state.totalDuration) {
          state.currentTime = 0;
        }
        updatePlayerUI();
      }, 100);
    } else {
      clearInterval(state.mockTimer);
    }
  }
  updatePlayButton();
}

function updatePlayButton() {
  if (state.isPlaying) {
    el.playIcon.innerHTML = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
  } else {
    el.playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
}

function handleSeek(e) {
  const rect = el.tbar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekToTime(pct * state.totalDuration);
}

function seekToTime(t) {
  state.currentTime = Math.max(0, Math.min(state.totalDuration, t));
  if (el.mainVideo.src) {
    el.mainVideo.currentTime = state.currentTime;
  }
  updatePlayerUI();
}

function onVideoTimeUpdate() {
  state.currentTime = el.mainVideo.currentTime;
  updatePlayerUI();
}

function updatePlayerUI() {
  const pct = (state.currentTime / Math.max(1, state.totalDuration)) * 100;
  el.tbarFill.style.width = pct + '%';
  el.tbarKnob.style.left = pct + '%';
  el.curTimeText.textContent = fmtTime(state.currentTime);

  // Update live caption overlay and highlight active SRT line
  const cur = state.currentTime;
  const activeSub = state.subtitles.find((s) => cur >= s.start_sec && cur < s.end_sec);

  if (activeSub) {
    el.captionBox.style.display = 'block';
    el.captionText.textContent = activeSub.text_dub;
  } else {
    el.captionBox.style.display = 'none';
  }

  document.querySelectorAll('.srt-line').forEach((row) => {
    const start = parseFloat(row.dataset.start);
    const end = parseFloat(row.dataset.end);
    const isActive = cur >= start && cur < end;
    row.classList.toggle('active', isActive);
  });
}

// --- Start Full Dubbing Process ---
async function startDubbingProcess() {
  if (!state.videoPath || !state.srtDubPath) {
    alert('Vui lòng chọn cả File Video và File Phụ đề SRT trước khi bắt đầu!');
    return;
  }

  const origVolVal = el.origVolSlider ? (parseFloat(el.origVolSlider.value) / 100.0) : 0.15;
  const dubVolVal = el.dubVolSlider ? (parseFloat(el.dubVolSlider.value) / 100.0) : 1.20;

  const payload = {
    video_path: state.videoPath,
    srt_dub_path: state.srtDubPath,
    srt_orig_path: state.srtOrigPath,
    voice: el.voiceSelect.value,
    voice_rate: el.voiceRateSelect.value,
    min_audio_speed: el.minAudioSpeedSlider ? parseFloat(el.minAudioSpeedSlider.value) : 0.80,
    max_audio_speed: el.maxAudioSpeedSlider ? parseFloat(el.maxAudioSpeedSlider.value) : 1.20,
    min_video_speed: el.minVideoSpeedSlider ? parseFloat(el.minVideoSpeedSlider.value) : 0.50,
    max_video_speed: el.maxVideoSpeedSlider ? parseFloat(el.maxVideoSpeedSlider.value) : 1.50,
    orig_volume: origVolVal,
    dub_volume: dubVolVal,
    num_workers: parseInt(el.threadsSlider.value, 10) || 50,
  };

  el.btnStartDubbing.disabled = true;
  el.modalBackdrop.classList.add('show');
  el.modalTitle.textContent = 'Đang xử lý lồng tiếng & Render FFmpeg...';
  el.progressBarFill.style.width = '0%';
  el.statusMsg.textContent = 'Đang khởi tạo tiến trình...';
  el.logBox.innerHTML = '';
  el.btnDownloadResult.style.display = 'none';
  if (el.btnDownloadSrt) el.btnDownloadSrt.style.display = 'none';

  if (el.floatingJobPill) {
    el.floatingJobPill.classList.remove('completed');
    el.floatingJobPill.style.display = 'none';
    if (el.floatingSpinner) {
      el.floatingSpinner.classList.remove('completed');
      el.floatingSpinner.textContent = '';
    }
  }

  try {
    const res = await fetch('/api/start_dubbing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể bắt đầu job');

    state.currentJobId = data.job_id;
    try {
      localStorage.setItem('active_dubbing_job_id', data.job_id);
    } catch (e) {}

    connectWebSocket(data.job_id);
  } catch (err) {
    appendLog(`[LỖI] ${err.message}`);
    el.statusMsg.textContent = `Lỗi: ${err.message}`;
    el.btnStartDubbing.disabled = false;
  }
}

// --- WebSocket Live Progress Stream ---
function connectWebSocket(jobId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/progress/${jobId}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    appendLog('[HỆ THỐNG] Đã kết nối WebSocket tiến độ thời gian thực.');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.percent !== undefined) {
        el.progressBarFill.style.width = `${msg.percent}%`;
        if (el.floatingJobPct) el.floatingJobPct.textContent = `${Math.round(msg.percent)}%`;
      }
      if (msg.message) {
        el.statusMsg.textContent = msg.message;
        if (el.floatingJobTitle) el.floatingJobTitle.textContent = msg.message;
        appendLog(`[${msg.stage?.toUpperCase() || 'INFO'}] ${msg.message}`);
      }

      // Live update speed badge in table
      if (msg.data && msg.data.seg_id) {
        const badge = document.getElementById(`ratio-badge-${msg.data.seg_id}`);
        if (badge) {
          badge.textContent = msg.data.sync_desc || (msg.data.ratio ? `${msg.data.ratio.toFixed(2)}x` : '1.0x');
          badge.className = `ratio ${msg.data.sync_mode === 'setpts' ? 'warn' : 'ok'}`;
        }
      }

      // Needs Review Stage (Failed TTS segments)
      if (msg.stage === 'tts_needs_review') {
        el.modalTitle.textContent = '⚠️ Cần xem xét câu lỗi CapCut';
        el.btnStartDubbing.disabled = false;
        const failed = msg.data?.failed_segments || msg.failed_segments || [];
        renderFailedSegmentsReview(failed);
      }

      // Completed
      if (msg.stage === 'completed') {
        el.modalTitle.textContent = '🎉 Hoàn tất Lồng tiếng & Render!';
        el.progressBarFill.style.width = '100%';
        el.btnStartDubbing.disabled = false;
        if (el.failedReviewContainer) el.failedReviewContainer.style.display = 'none';

        if (el.floatingJobPill) el.floatingJobPill.classList.add('completed');
        if (el.floatingSpinner) {
          el.floatingSpinner.classList.add('completed');
          el.floatingSpinner.textContent = '✅';
        }
        if (el.floatingJobTitle) el.floatingJobTitle.textContent = '🎉 Đã hoàn tất! Nhấn để tải về.';
        if (el.floatingJobPct) el.floatingJobPct.textContent = '100%';

        // Update state.subtitles with newly shifted timecodes
        if (msg.result && msg.result.timeline) {
          updateSubtitlesFromTimeline(msg.result.timeline);
        }

        if (msg.output_url) {
          el.btnDownloadResult.style.display = 'inline-flex';
          el.btnDownloadResult.onclick = () => {
            window.open(msg.output_url, '_blank');
          };
          // Automatically load final dubbed video into player
          loadVideoIntoPlayer(msg.output_url);
        }

        if (msg.output_srt_url && el.btnDownloadSrt) {
          el.btnDownloadSrt.style.display = 'inline-flex';
          el.btnDownloadSrt.onclick = () => {
            window.open(msg.output_srt_url, '_blank');
          };
        }
      } else if (msg.stage === 'failed') {
        el.modalTitle.textContent = '❌ Quá trình Render gặp lỗi';
        el.btnStartDubbing.disabled = false;
        if (el.floatingJobTitle) el.floatingJobTitle.textContent = '❌ Lỗi xử lý';
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  ws.onerror = (e) => {
    console.error('WS Error:', e);
  };
}

// --- Render Failed Sentences Review Box ---
function renderFailedSegmentsReview(failedSegments) {
  if (!el.failedReviewContainer || !el.failedList) return;
  el.failedList.innerHTML = '';
  el.failedCountBadge.textContent = failedSegments.length;
  el.failedReviewContainer.style.display = 'block';

  failedSegments.forEach((seg) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'failed-item';
    itemDiv.id = `failed-item-${seg.seg_id}`;

    itemDiv.innerHTML = `
      <div class="failed-item-idx">#${String(seg.seg_id).padStart(2, '0')}</div>
      <input type="text" class="failed-item-input" id="failed-input-${seg.seg_id}" value="${escapeHtml(seg.text_dub)}" placeholder="Nội dung câu..." />
      <button class="failed-item-btn" id="btn-retry-${seg.seg_id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        Thử lại
      </button>
    `;

    const retryBtn = itemDiv.querySelector(`#btn-retry-${seg.seg_id}`);
    const inputEl = itemDiv.querySelector(`#failed-input-${seg.seg_id}`);

    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.innerHTML = 'Đang thử...';
      try {
        const res = await fetch('/api/retry_tts_segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: state.currentJobId,
            segments: [{ seg_id: seg.seg_id, text_dub: inputEl.value }],
            voice: el.voiceSelect.value,
            voice_rate: el.voiceRateSelect.value,
          }),
        });
        const data = await res.json();
        const updatedSeg = (data.updated_segments || [])[0];
        if (updatedSeg && !updatedSeg.is_failed) {
          itemDiv.classList.add('success');
          retryBtn.className = 'failed-item-btn btn-done';
          retryBtn.innerHTML = '✅ Đã tạo';
          retryBtn.disabled = true;
          inputEl.disabled = true;
          if (data.remaining_failed === 0) {
            appendLog('[HỆ THỐNG] Đã tạo thành công tất cả câu lỗi! Tự động tiếp tục Render Video...');
            setTimeout(resumeDubbingRender, 1000);
          }
        } else {
          retryBtn.disabled = false;
          retryBtn.innerHTML = '❌ Thử lại';
          appendLog(`[TTS LỖI] Câu #${seg.seg_id}: ${updatedSeg?.tts_error || 'Thất bại'}`);
        }
      } catch (err) {
        retryBtn.disabled = false;
        retryBtn.innerHTML = '❌ Thử lại';
        appendLog(`[LỖI] ${err.message}`);
      }
    });

    el.failedList.appendChild(itemDiv);
  });
}

async function retryAllFailedSegments() {
  if (!el.failedList || !state.currentJobId) return;
  const items = el.failedList.querySelectorAll('.failed-item:not(.success)');
  if (items.length === 0) {
    resumeDubbingRender();
    return;
  }

  el.btnRetryAllFailed.disabled = true;
  el.btnRetryAllFailed.textContent = 'Đang thử lại tất cả...';

  const segmentsToRetry = [];
  items.forEach((item) => {
    const segId = parseInt(item.id.replace('failed-item-', ''), 10);
    const inputEl = item.querySelector('.failed-item-input');
    segmentsToRetry.push({ seg_id: segId, text_dub: inputEl ? inputEl.value : '' });
  });

  try {
    const res = await fetch('/api/retry_tts_segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: state.currentJobId,
        segments: segmentsToRetry,
        voice: el.voiceSelect.value,
        voice_rate: el.voiceRateSelect.value,
      }),
    });
    const data = await res.json();
    (data.updated_segments || []).forEach((updatedSeg) => {
      const itemDiv = document.getElementById(`failed-item-${updatedSeg.seg_id}`);
      if (itemDiv) {
        const retryBtn = itemDiv.querySelector('.failed-item-btn');
        const inputEl = itemDiv.querySelector('.failed-item-input');
        if (!updatedSeg.is_failed) {
          itemDiv.classList.add('success');
          if (retryBtn) {
            retryBtn.className = 'failed-item-btn btn-done';
            retryBtn.innerHTML = '✅ Đã tạo';
            retryBtn.disabled = true;
          }
          if (inputEl) inputEl.disabled = true;
        }
      }
    });

    if (data.remaining_failed === 0) {
      appendLog('[HỆ THỐNG] Tất cả câu lỗi đã tạo thành công! Bắt đầu Render Video...');
      setTimeout(resumeDubbingRender, 1000);
    } else {
      appendLog(`[HỆ THỐNG] Còn ${data.remaining_failed} câu chưa tạo được.`);
    }
  } catch (err) {
    appendLog(`[LỖI] ${err.message}`);
  } finally {
    el.btnRetryAllFailed.disabled = false;
    el.btnRetryAllFailed.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
      Thử tạo lại tất cả câu lỗi
    `;
  }
}

async function resumeDubbingRender() {
  if (!state.currentJobId) return;
  if (el.failedReviewContainer) el.failedReviewContainer.style.display = 'none';
  el.statusMsg.textContent = 'Đang tiếp tục hòa trộn âm thanh & Render Video...';

  try {
    const res = await fetch('/api/resume_dubbing_render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: state.currentJobId, skip_failed: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể tiếp tục render');
    appendLog('[HỆ THỐNG] Đã kích hoạt giai đoạn Render Video.');
  } catch (err) {
    appendLog(`[LỖI] ${err.message}`);
    el.statusMsg.textContent = `Lỗi render: ${err.message}`;
  }
}

// --- Convert Final Timeline to Subtitles List with Synchronized Timecodes ---
function updateSubtitlesFromTimeline(timeline) {
  let curTime = 0.0;
  const newSubs = [];
  let idx = 1;

  timeline.forEach((seg) => {
    if (seg.seg_type === 'dub') {
      const vSpeed = seg.video_speed_applied || 1.0;
      const segDur = seg.duration_sec / Math.max(0.1, vSpeed);
      const startT = curTime;
      const endT = curTime + segDur;

      newSubs.push({
        index: idx++,
        start_sec: Math.round(startT * 1000) / 1000,
        end_sec: Math.round(endT * 1000) / 1000,
        duration_sec: Math.round(segDur * 1000) / 1000,
        text_dub: seg.text_dub,
        text_orig: seg.text_orig,
        ratio: seg.ratio,
        sync_mode: seg.sync_mode,
        speed_applied: seg.speed_applied,
        video_speed_applied: seg.video_speed_applied,
        sync_desc: seg.sync_desc,
      });

      curTime += segDur;
    } else {
      curTime += seg.duration_sec;
    }
  });

  if (newSubs.length > 0) {
    state.subtitles = newSubs;
    renderSubtitleList(state.subtitles);
  }
}

// --- Restore active job on page refresh / reopen ---
function checkAndRestoreActiveJob() {
  let savedJobId = null;
  try {
    savedJobId = localStorage.getItem('active_dubbing_job_id');
  } catch (e) {}
  if (!savedJobId) return;

  fetch(`/api/job_status/${savedJobId}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((job) => {
      if (!job) {
        try { localStorage.removeItem('active_dubbing_job_id'); } catch (e) {}
        return;
      }
      state.currentJobId = savedJobId;

      if (job.status === 'running' || job.status === 'started') {
        if (el.floatingJobPill) {
          el.floatingJobPill.style.display = 'flex';
          el.floatingJobPill.classList.remove('completed');
        }
        if (el.floatingSpinner) {
          el.floatingSpinner.classList.remove('completed');
          el.floatingSpinner.textContent = '';
        }
        if (el.floatingJobTitle) el.floatingJobTitle.textContent = job.message || 'Đang xử lý lồng tiếng...';
        if (el.floatingJobPct) el.floatingJobPct.textContent = `${Math.round(job.percent || 0)}%`;
        connectWebSocket(savedJobId);
      } else if (job.status === 'completed') {
        if (el.floatingJobPill) {
          el.floatingJobPill.style.display = 'flex';
          el.floatingJobPill.classList.add('completed');
        }
        if (el.floatingSpinner) {
          el.floatingSpinner.classList.add('completed');
          el.floatingSpinner.textContent = '✅';
        }
        if (el.floatingJobTitle) el.floatingJobTitle.textContent = '🎉 Đã hoàn tất! Nhấn để tải về.';
        if (el.floatingJobPct) el.floatingJobPct.textContent = '100%';

        if (job.result && job.result.timeline) {
          updateSubtitlesFromTimeline(job.result.timeline);
        }

        if (job.output_url) {
          el.btnDownloadResult.style.display = 'inline-flex';
          el.btnDownloadResult.onclick = () => window.open(job.output_url, '_blank');
          loadVideoIntoPlayer(job.output_url);
        }
        if (job.output_srt_url && el.btnDownloadSrt) {
          el.btnDownloadSrt.style.display = 'inline-flex';
          el.btnDownloadSrt.onclick = () => window.open(job.output_srt_url, '_blank');
        }
      }
    })
    .catch(() => {});
}

function appendLog(text) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  el.logBox.appendChild(line);
  el.logBox.scrollTop = el.logBox.scrollHeight;
}

// --- Helpers ---
function fmtTime(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildFakeWaveforms() {
  el.waveA.innerHTML = '';
  el.waveV.innerHTML = '';
  for (let i = 0; i < 64; i++) {
    const b1 = document.createElement('span');
    b1.style.height = `${20 + Math.random() * 80}%`;
    el.waveA.appendChild(b1);

    const b2 = document.createElement('span');
    b2.style.height = `${30 + Math.random() * 70}%`;
    el.waveV.appendChild(b2);
  }
}

function loadSampleMockData() {
  state.subtitles = [
    { index: 1, start_sec: 0.0, end_sec: 3.5, duration_sec: 3.5, text_dub: "Xin chào, hôm nay chúng ta sẽ...", text_orig: "Hello, today we will...", ratio: 1.02 },
    { index: 2, start_sec: 3.5, end_sec: 7.2, duration_sec: 3.7, text_dub: "...bắt đầu với một câu hỏi đơn giản.", text_orig: "...start with a simple question.", ratio: 1.08 },
    { index: 3, start_sec: 7.2, end_sec: 12.6, duration_sec: 5.4, text_dub: "Tại sao mọi thứ lại phức tạp đến vậy, trong khi câu trả lời rất gần?", text_orig: "Why is everything so complex, when the answer is so close?", ratio: 1.31 },
    { index: 4, start_sec: 12.6, end_sec: 18.0, duration_sec: 5.4, text_dub: "Chúng ta sẽ tìm hiểu ngay sau đây.", text_orig: "We'll find out right after this.", ratio: 0.95 },
  ];
  renderSubtitleList(state.subtitles);
  updatePlayerUI();
}
