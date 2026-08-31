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
  currentSessionId: null,
  socket: null,
  isPlaying: false,
  currentTime: 0.0,
  totalDuration: 18.0,
  previewAudio: new Audio(),
  subtitleOverlayEnabled: true,
  burnSubtitlesEnabled: true,
  subtitlePosition: 8,
  maskHeight: 28,
  maskOpacity: 38,
  maskBlur: 12,
  subtitleFontSize: 22,
  subtitleColor: 'white',
  subtitleOutline: 2,
  maskLayers: [{ id: 1, x: 0, y: 72, width: 100, height: 28, opacity: 38, blur: 12 }],
  activeMaskLayerId: 1,
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
  minAudioSpeedInput: document.getElementById('minAudioSpeedInput'),
  maxAudioSpeedInput: document.getElementById('maxAudioSpeedInput'),
  speedSaveHint: document.getElementById('speedSaveHint'),
  gapBorrowSlider: document.getElementById('gapBorrowSlider'),
  gapBorrowBadge: document.getElementById('gapBorrowBadge'),
  useAdaptiveProsodyCheckbox: document.getElementById('useAdaptiveProsodyCheckbox'),
  origVolSlider: document.getElementById('origVolSlider'),
  origVolBadge: document.getElementById('origVolBadge'),
  origAudioQuickBadge: document.getElementById('origAudioQuickBadge'),
  dubVolSlider: document.getElementById('dubVolSlider'),
  dubVolBadge: document.getElementById('dubVolBadge'),
  threadsSlider: document.getElementById('threadsSlider'),
  threadsValue: document.getElementById('threadsValue'),
  btnStartDubbing: document.getElementById('btnStartDubbing'),
  subtitleOverlayEnabled: document.getElementById('subtitleOverlayEnabled'),
  burnSubtitlesEnabled: document.getElementById('burnSubtitlesEnabled'),
  subtitlePositionSlider: document.getElementById('subtitlePositionSlider'),
  subtitlePositionBadge: document.getElementById('subtitlePositionBadge'),
  subtitleMaskPreview: document.getElementById('subtitleMaskPreview'),
  subtitleMaskResizeHandle: document.getElementById('subtitleMaskResizeHandle'),
  subtitleFontSizeSlider: document.getElementById('subtitleFontSizeSlider'),
  subtitleFontSizeBadge: document.getElementById('subtitleFontSizeBadge'),
  subtitleColorSelect: document.getElementById('subtitleColorSelect'),
  subtitleOutlineSlider: document.getElementById('subtitleOutlineSlider'),
  subtitleOutlineBadge: document.getElementById('subtitleOutlineBadge'),
  subtitleMaskLayers: document.getElementById('subtitleMaskLayers'),
  maskLayerList: document.getElementById('maskLayerList'),
  btnAddMaskLayer: document.getElementById('btnAddMaskLayer'),

  // Gemini AI Settings & Key Pool
  btnHeaderGeminiSettings: document.getElementById('btnHeaderGeminiSettings'),
  headerGeminiKeyBadge: document.getElementById('headerGeminiKeyBadge'),
  geminiSettingsModalBackdrop: document.getElementById('geminiSettingsModalBackdrop'),
  modalGeminiModelSelect: document.getElementById('modalGeminiModelSelect'),
  modalGeminiKeysInput: document.getElementById('modalGeminiKeysInput'),
  modalKeyPoolCountBadge: document.getElementById('modalKeyPoolCountBadge'),
  btnTestGeminiConnection: document.getElementById('btnTestGeminiConnection'),
  geminiTestStatusBox: document.getElementById('geminiTestStatusBox'),
  btnCloseGeminiSettingsModal: document.getElementById('btnCloseGeminiSettingsModal'),
  btnSaveGeminiSettings: document.getElementById('btnSaveGeminiSettings'),



  // Video Player
  mainVideo: document.getElementById('mainVideo'),
  videoPlaceholder: document.getElementById('videoPlaceholder'),
  captionBox: document.getElementById('captionBox'),
  captionText: document.getElementById('captionText'),
  playBtn: document.getElementById('playBtn'),
  playIcon: document.getElementById('playIcon'),
  fsBtn: document.getElementById('fsBtn'),
  muteBtn: document.getElementById('muteBtn'),
  muteIcon: document.getElementById('muteIcon'),
  pipBtn: document.getElementById('pipBtn'),
  speedBtn: document.getElementById('speedBtn'),
  speedMenuPopup: document.getElementById('speedMenuPopup'),
  speedMenuWrap: document.getElementById('speedMenuWrap'),
  rewindBtn: document.getElementById('rewindBtn'),
  forwardBtn: document.getElementById('forwardBtn'),
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
  btnOpenVideo: document.getElementById('btnOpenVideo'),
  btnOpenFolder: document.getElementById('btnOpenFolder'),

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
  btnGeminiFixAllFailed: document.getElementById('btnGeminiFixAllFailed'),
  btnRetryAllFailed: document.getElementById('btnRetryAllFailed'),
  btnSkipFailedAndRender: document.getElementById('btnSkipFailedAndRender'),


  // Live Render HUD
  renderStatsHud: document.getElementById('renderStatsHud'),
  hudFrames: document.getElementById('hudFrames'),
  hudTime: document.getElementById('hudTime'),
  hudSpeed: document.getElementById('hudSpeed'),
  hudStagePercent: document.getElementById('hudStagePercent'),

  // Pipeline Stepper
  stepInit: document.getElementById('step-init'),
  stepTts: document.getElementById('step-tts'),
  stepAudio: document.getElementById('step-audio'),
  stepVideo: document.getElementById('step-video'),

  // Dual Progress Bars
  overallPctText: document.getElementById('overallPctText'),
  stagePctText: document.getElementById('stagePctText'),
  stageProgressBarFill: document.getElementById('stageProgressBarFill'),

  // Cache & Projects
  cacheStatsBadge: document.getElementById('cacheStatsBadge'),
  cacheAlertBanner: document.getElementById('cacheAlertBanner'),
  cacheAlertTitle: document.getElementById('cacheAlertTitle'),
  cacheAlertDesc: document.getElementById('cacheAlertDesc'),
  btnOpenProjects: document.getElementById('btnOpenProjects'),
  projectsModalBackdrop: document.getElementById('projectsModalBackdrop'),
  projectsList: document.getElementById('projectsList'),
  btnCloseProjectsModal: document.getElementById('btnCloseProjectsModal'),

  // STT Auto Subtitle Recognition
  btnOpenSttModal: document.getElementById('btnOpenSttModal'),
  sttModalBackdrop: document.getElementById('sttModalBackdrop'),
  btnSttModalCloseX: document.getElementById('btnSttModalCloseX'),
  btnSttModalCancel: document.getElementById('btnSttModalCancel'),
  sttDropzone: document.getElementById('sttDropzone'),
  sttFileInput: document.getElementById('sttFileInput'),
  sttFileName: document.getElementById('sttFileName'),
  sttDropzoneText: document.getElementById('sttDropzoneText'),
  sttLangSelect: document.getElementById('sttLangSelect'),
  sttConcurrencySelect: document.getElementById('sttConcurrencySelect'),
  sttUseTranslation: document.getElementById('sttUseTranslation'),
  btnSttStartAction: document.getElementById('btnSttStartAction'),
  sttProgressContainer: document.getElementById('sttProgressContainer'),
  sttProgressMessage: document.getElementById('sttProgressMessage'),
  sttProgressPercent: document.getElementById('sttProgressPercent'),
  sttProgressBar: document.getElementById('sttProgressBar'),
  sttResultBox: document.getElementById('sttResultBox'),
  sttResultSummary: document.getElementById('sttResultSummary'),
  btnSttApplyToProject: document.getElementById('btnSttApplyToProject'),
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadVoices();
  buildFakeWaveforms();
  setupEventListeners();
  setupSttEventListeners();
  loadSampleMockData();
  initOrigVolFromStorage();
  updateDubVolUI();
  initSpeedLimitsFromStorage();
  updateGapBorrowUI();
  updateCacheStatsBadge();
  updateGeminiKeyCountUI();
  checkAndRestoreActiveJob();
});

function initOrigVolFromStorage() {
  try {
    const saved = localStorage.getItem('user_orig_volume');
    if (saved !== null && !isNaN(parseInt(saved, 10)) && el.origVolSlider) {
      el.origVolSlider.value = parseInt(saved, 10);
    }
  } catch (e) { }
  updateOrigVolUI(false);
}


function getStoredSpeedLimits() {
  try {
    const savedMin = localStorage.getItem('user_min_audio_speed');
    const savedMax = localStorage.getItem('user_max_audio_speed');
    return {
      min: savedMin !== null && !isNaN(parseFloat(savedMin)) ? parseFloat(savedMin) : 0.80,
      max: savedMax !== null && !isNaN(parseFloat(savedMax)) ? parseFloat(savedMax) : 1.40,
    };
  } catch (e) {
    return { min: 0.80, max: 1.40 };
  }
}

let speedSaveTimer = null;
function saveStoredSpeedLimits(minA, maxA) {
  try {
    localStorage.setItem('user_min_audio_speed', minA.toFixed(2));
    localStorage.setItem('user_max_audio_speed', maxA.toFixed(2));
    if (el.speedSaveHint) {
      el.speedSaveHint.style.opacity = '1';
      clearTimeout(speedSaveTimer);
      speedSaveTimer = setTimeout(() => {
        if (el.speedSaveHint) el.speedSaveHint.style.opacity = '0';
      }, 1500);
    }
  } catch (e) { }
}

function initSpeedLimitsFromStorage() {
  const saved = getStoredSpeedLimits();
  if (el.minAudioSpeedSlider) el.minAudioSpeedSlider.value = saved.min;
  if (el.maxAudioSpeedSlider) el.maxAudioSpeedSlider.value = saved.max;
  if (el.minAudioSpeedInput) el.minAudioSpeedInput.value = saved.min.toFixed(2);
  if (el.maxAudioSpeedInput) el.maxAudioSpeedInput.value = saved.max.toFixed(2);
  updateSpeedLimitsUI(false);
}

function updateSpeedLimitsUI(shouldSave = true) {
  // Audio Speed Range (0.50 to 2.00, total span = 1.50)
  if (el.minAudioSpeedSlider && el.maxAudioSpeedSlider) {
    let minA = parseFloat(el.minAudioSpeedSlider.value) || 0.80;
    let maxA = parseFloat(el.maxAudioSpeedSlider.value) || 1.40;
    if (minA > maxA) {
      minA = maxA;
      el.minAudioSpeedSlider.value = minA;
    }

    const leftPct = Math.max(0, Math.min(100, ((minA - 0.50) / 1.50) * 100));
    const rightPct = Math.max(0, Math.min(100, ((maxA - 0.50) / 1.50) * 100));
    if (el.audioRangeHighlight) {
      el.audioRangeHighlight.style.left = `${leftPct}%`;
      el.audioRangeHighlight.style.width = `${Math.max(2, rightPct - leftPct)}%`;
    }

    // Sync input boxes if they are not actively being focused/edited by user
    if (el.minAudioSpeedInput && document.activeElement !== el.minAudioSpeedInput) {
      el.minAudioSpeedInput.value = minA.toFixed(2);
    }
    if (el.maxAudioSpeedInput && document.activeElement !== el.maxAudioSpeedInput) {
      el.maxAudioSpeedInput.value = maxA.toFixed(2);
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

    if (shouldSave) {
      saveStoredSpeedLimits(minA, maxA);
    }
  }
}

function updateGapBorrowUI() {
  if (!el.gapBorrowSlider || !el.gapBorrowBadge) return;
  const val = parseFloat(el.gapBorrowSlider.value) || 0.0;
  if (val <= 0.01) {
    el.gapBorrowBadge.textContent = '0.00s (Tắt mượn)';
  } else {
    el.gapBorrowBadge.textContent = `${val.toFixed(2)}s (Chống méo tiếng)`;
  }
}


function updateOrigVolUI(shouldSave = true) {
  if (!el.origVolSlider) return;
  const val = parseInt(el.origVolSlider.value, 10);
  let desc = `${val}%`;
  let quickDesc = `${val}%`;
  if (val === 0) {
    desc = '0% (Tắt tiếng gốc)';
    quickDesc = '0% (Tắt tiếng)';
  } else if (val <= 20) {
    desc = `${val}% (Nền nhỏ)`;
    quickDesc = `${val}% (Nhạc nền)`;
  } else if (val <= 60) {
    desc = `${val}% (Nền vừa)`;
    quickDesc = `${val}% (Nền vừa)`;
  } else if (val === 100) {
    desc = '100% (Gốc 100%)';
    quickDesc = '100% (Gốc 100%)';
  } else {
    desc = `${val}% (Khuếch đại)`;
    quickDesc = `${val}% (Khuếch đại)`;
  }

  if (el.origVolBadge) el.origVolBadge.textContent = desc;
  if (el.origAudioQuickBadge) el.origAudioQuickBadge.textContent = quickDesc;

  // Update active state on original audio selector buttons
  document.querySelectorAll('.orig-audio-btn').forEach((btn) => {
    const bVal = parseInt(btn.dataset.val, 10);
    if (val === 0 && bVal === 0) {
      btn.classList.add('active');
    } else if (val > 0 && val <= 35 && bVal === 15) {
      btn.classList.add('active');
    } else if (val >= 80 && bVal === 100) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (shouldSave) {
    try {
      localStorage.setItem('user_orig_volume', val.toString());
    } catch (e) { }
  }
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
  if (el.fsBtn) el.fsBtn.addEventListener('click', toggleFullScreen);
  if (el.muteBtn) el.muteBtn.addEventListener('click', toggleMute);
  if (el.pipBtn) el.pipBtn.addEventListener('click', togglePiP);
  setupSpeedMenu();
  if (el.rewindBtn) el.rewindBtn.addEventListener('click', () => { el.mainVideo.currentTime = Math.max(0, el.mainVideo.currentTime - 5); });
  if (el.forwardBtn) el.forwardBtn.addEventListener('click', () => { el.mainVideo.currentTime = Math.min(el.mainVideo.duration || state.totalDuration, el.mainVideo.currentTime + 5); });
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
  if (el.subtitleOverlayEnabled) el.subtitleOverlayEnabled.addEventListener('change', updateSubtitleOutputUI);
  if (el.burnSubtitlesEnabled) el.burnSubtitlesEnabled.addEventListener('change', updateSubtitleOutputUI);
  if (el.subtitlePositionSlider) el.subtitlePositionSlider.addEventListener('input', updateSubtitleOutputUI);
  [el.subtitleFontSizeSlider, el.subtitleOutlineSlider]
    .filter(Boolean).forEach((input) => input.addEventListener('input', updateSubtitleOutputUI));
  if (el.subtitleColorSelect) el.subtitleColorSelect.addEventListener('change', updateSubtitleOutputUI);
  if (el.btnAddMaskLayer) el.btnAddMaskLayer.addEventListener('click', addMaskLayer);
  setupDirectSubtitleEditor();
  updateSubtitleOutputUI();

  // Dual Range Slider 1: Audio Speed
  if (el.minAudioSpeedSlider && el.maxAudioSpeedSlider) {
    el.minAudioSpeedSlider.addEventListener('input', () => {
      const minA = parseFloat(el.minAudioSpeedSlider.value);
      const maxA = parseFloat(el.maxAudioSpeedSlider.value);
      if (minA > maxA) el.maxAudioSpeedSlider.value = minA;
      updateSpeedLimitsUI(true);
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    });

    el.maxAudioSpeedSlider.addEventListener('input', () => {
      const minA = parseFloat(el.minAudioSpeedSlider.value);
      const maxA = parseFloat(el.maxAudioSpeedSlider.value);
      if (maxA < minA) el.minAudioSpeedSlider.value = maxA;
      updateSpeedLimitsUI(true);
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    });
  }

  // Direct Number Input for Audio Speed Range
  if (el.minAudioSpeedInput) {
    const handleMinInputChange = () => {
      let val = parseFloat(el.minAudioSpeedInput.value);
      if (isNaN(val)) val = 0.80;
      val = Math.max(0.50, Math.min(2.00, Math.round(val * 100) / 100));
      if (el.minAudioSpeedSlider) el.minAudioSpeedSlider.value = val;
      const maxVal = parseFloat(el.maxAudioSpeedSlider ? el.maxAudioSpeedSlider.value : 1.40) || 1.40;
      if (val > maxVal) {
        if (el.maxAudioSpeedSlider) el.maxAudioSpeedSlider.value = val;
        if (el.maxAudioSpeedInput) el.maxAudioSpeedInput.value = val.toFixed(2);
      }
      updateSpeedLimitsUI(true);
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    };
    el.minAudioSpeedInput.addEventListener('change', handleMinInputChange);
    el.minAudioSpeedInput.addEventListener('blur', handleMinInputChange);
  }

  if (el.maxAudioSpeedInput) {
    const handleMaxInputChange = () => {
      let val = parseFloat(el.maxAudioSpeedInput.value);
      if (isNaN(val)) val = 1.40;
      val = Math.max(0.50, Math.min(2.00, Math.round(val * 100) / 100));
      if (el.maxAudioSpeedSlider) el.maxAudioSpeedSlider.value = val;
      const minVal = parseFloat(el.minAudioSpeedSlider ? el.minAudioSpeedSlider.value : 0.80) || 0.80;
      if (val < minVal) {
        if (el.minAudioSpeedSlider) el.minAudioSpeedSlider.value = val;
        if (el.minAudioSpeedInput) el.minAudioSpeedInput.value = val.toFixed(2);
      }
      updateSpeedLimitsUI(true);
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    };
    el.maxAudioSpeedInput.addEventListener('change', handleMaxInputChange);
    el.maxAudioSpeedInput.addEventListener('blur', handleMaxInputChange);
  }

  // Gap Borrowing Slider
  if (el.gapBorrowSlider) {
    el.gapBorrowSlider.addEventListener('input', () => {
      updateGapBorrowUI();
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
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
      } else if (target === 'gapborrow' && el.gapBorrowSlider) {
        el.gapBorrowSlider.value = btn.dataset.val;
        updateGapBorrowUI();
        if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
      }
    });
  });

  // Original Audio Mode Buttons (Quick selector)
  document.querySelectorAll('.orig-audio-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val, 10);
      if (el.origVolSlider) {
        el.origVolSlider.value = val;
        updateOrigVolUI();
      }
    });
  });

  if (el.threadsSlider) {
    el.threadsSlider.addEventListener('input', () => {
      el.threadsValue.textContent = `${el.threadsSlider.value} luồng`;
    });
  }


  // Cleanup Cache Button
  const btnCleanup = document.getElementById('btnCleanup');
  if (btnCleanup) {
    btnCleanup.addEventListener('click', async () => {
      if (!confirm('Bạn có chắc chắn muốn dọn dẹp sạch toàn bộ file rác và bộ nhớ tạm? (Toàn bộ Video thành phẩm trong thư mục outputs sẽ luôn được giữ nguyên an toàn!)')) {
        return;
      }
      btnCleanup.disabled = true;
      btnCleanup.textContent = 'Đang dọn dẹp...';
      try {
        const res = await fetch('/api/cleanup', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Đã dọn dẹp sạch toàn bộ bộ nhớ rác!');
        updateCacheStatsBadge();
        if (el.cacheAlertBanner) el.cacheAlertBanner.style.display = 'none';
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

  // Open File / Folder actions
  if (el.btnOpenVideo) {
    el.btnOpenVideo.addEventListener('click', async () => {
      try {
        await fetch('/api/open_file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: state.currentJobId, target: 'video' }),
        });
      } catch (e) {
        console.error(e);
      }
    });
  }

  if (el.btnOpenFolder) {
    el.btnOpenFolder.addEventListener('click', async () => {
      try {
        await fetch('/api/open_file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: state.currentJobId, target: 'folder' }),
        });
      } catch (e) {
        console.error(e);
      }
    });
  }

  // Failed Review actions
  if (el.btnGeminiFixAllFailed) {
    el.btnGeminiFixAllFailed.addEventListener('click', fixAllFailedSegmentsWithGemini);
  }
  if (el.btnRetryAllFailed) {
    el.btnRetryAllFailed.addEventListener('click', retryAllFailedSegments);
  }
  if (el.btnSkipFailedAndRender) {
    el.btnSkipFailedAndRender.addEventListener('click', resumeDubbingRender);
  }


  // Projects Modal Events
  if (el.btnOpenProjects) {
    el.btnOpenProjects.addEventListener('click', openProjectsModal);
  }
  if (el.btnCloseProjectsModal) {
    el.btnCloseProjectsModal.addEventListener('click', closeProjectsModal);
  }
  if (el.projectsModalBackdrop) {
    el.projectsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === el.projectsModalBackdrop) closeProjectsModal();
    });
  }

  // Voice changes -> recheck cache
  if (el.voiceSelect) {
    el.voiceSelect.addEventListener('change', () => {
      checkSubtitlesCache();
    });
  }
  if (el.voiceRateSelect) {
    el.voiceRateSelect.addEventListener('change', () => {
      checkSubtitlesCache();
    });
  }

  // Gemini AI Settings Modal Listeners
  if (el.btnHeaderGeminiSettings) {
    el.btnHeaderGeminiSettings.addEventListener('click', openGeminiSettingsModal);
  }
  if (el.btnCloseGeminiSettingsModal) {
    el.btnCloseGeminiSettingsModal.addEventListener('click', closeGeminiSettingsModal);
  }
  if (el.geminiSettingsModalBackdrop) {
    el.geminiSettingsModalBackdrop.addEventListener('click', (e) => {
      if (e.target === el.geminiSettingsModalBackdrop) closeGeminiSettingsModal();
    });
  }
  if (el.btnSaveGeminiSettings) {
    el.btnSaveGeminiSettings.addEventListener('click', saveGeminiSettings);
  }
  if (el.btnTestGeminiConnection) {
    el.btnTestGeminiConnection.addEventListener('click', testGeminiConnection);
  }
  if (el.modalGeminiKeysInput) {
    el.modalGeminiKeysInput.addEventListener('input', () => {
      const raw = el.modalGeminiKeysInput.value;
      const count = raw.replace(/,/g, '\n').split('\n').map(k => k.trim()).filter(Boolean).length;
      if (el.modalKeyPoolCountBadge) {
        el.modalKeyPoolCountBadge.textContent = `${count} Key sẵn sàng`;
      }
    });
  }
}

// --- Gemini AI Settings Functions ---
function getStoredGeminiKeys() {
  try {
    const raw = localStorage.getItem('gemini_api_keys');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(k => k.trim()).filter(Boolean);
    } catch (e) { }
    return raw.replace(/,/g, '\n').split('\n').map(k => k.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getStoredGeminiModel() {
  try {
    return localStorage.getItem('gemini_model') || 'gemini-2.5-flash-lite';
  } catch (e) {
    return 'gemini-2.5-flash-lite';
  }
}

function updateGeminiKeyCountUI() {
  const keys = getStoredGeminiKeys();
  const count = keys.length;
  if (el.headerGeminiKeyBadge) {
    el.headerGeminiKeyBadge.textContent = `${count} Key sẵn sàng`;
  }
  if (el.modalKeyPoolCountBadge) {
    el.modalKeyPoolCountBadge.textContent = `${count} Key sẵn sàng`;
  }
}

function openGeminiSettingsModal() {
  if (el.modalGeminiKeysInput) {
    const keys = getStoredGeminiKeys();
    el.modalGeminiKeysInput.value = keys.join('\n');
  }
  if (el.modalGeminiModelSelect) {
    el.modalGeminiModelSelect.value = getStoredGeminiModel();
  }
  if (el.geminiTestStatusBox) {
    el.geminiTestStatusBox.style.display = 'none';
  }
  updateGeminiKeyCountUI();
  if (el.geminiSettingsModalBackdrop) {
    el.geminiSettingsModalBackdrop.classList.add('show');
  }
}

function closeGeminiSettingsModal() {
  if (el.geminiSettingsModalBackdrop) {
    el.geminiSettingsModalBackdrop.classList.remove('show');
  }
}

function saveGeminiSettings() {
  if (el.modalGeminiKeysInput) {
    const raw = el.modalGeminiKeysInput.value;
    const cleanKeys = raw.replace(/,/g, '\n').split('\n').map(k => k.trim()).filter(Boolean);
    try {
      localStorage.setItem('gemini_api_keys', JSON.stringify(cleanKeys));
    } catch (e) { }
  }
  if (el.modalGeminiModelSelect) {
    try {
      localStorage.setItem('gemini_model', el.modalGeminiModelSelect.value);
    } catch (e) { }
  }
  updateGeminiKeyCountUI();
  closeGeminiSettingsModal();
}

async function testGeminiConnection() {
  const raw = el.modalGeminiKeysInput ? el.modalGeminiKeysInput.value : '';
  const cleanKeys = raw.replace(/,/g, '\n').split('\n').map(k => k.trim()).filter(Boolean);
  const model = el.modalGeminiModelSelect ? el.modalGeminiModelSelect.value : 'gemini-2.5-flash-lite';
  const firstKey = cleanKeys.length > 0 ? cleanKeys[0] : null;

  if (!firstKey) {
    alert('Vui lòng nhập ít nhất 1 Gemini API Key trước khi kiểm tra!');
    return;
  }

  if (el.geminiTestStatusBox) {
    el.geminiTestStatusBox.style.display = 'block';
    el.geminiTestStatusBox.style.background = 'rgba(59, 130, 246, 0.1)';
    el.geminiTestStatusBox.style.color = '#60A5FA';
    el.geminiTestStatusBox.style.border = '1px solid rgba(59, 130, 246, 0.3)';
    el.geminiTestStatusBox.innerHTML = `⏳ Đang kiểm tra kết nối với <b>${model}</b>...`;
  }

  try {
    const res = await fetch('/api/gemini/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: firstKey, model: model }),
    });
    const data = await res.json();

    if (data.success) {
      el.geminiTestStatusBox.style.background = 'rgba(16, 185, 129, 0.1)';
      el.geminiTestStatusBox.style.color = 'var(--teal)';
      el.geminiTestStatusBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      el.geminiTestStatusBox.innerHTML = `✅ Kết nối thành công! Key: <b>${data.masked_key}</b> | Model: <b>${data.model}</b> | Độ trễ: <b>${data.latency_ms}ms</b>`;
    } else {
      el.geminiTestStatusBox.style.background = 'rgba(239, 68, 68, 0.1)';
      el.geminiTestStatusBox.style.color = '#F87171';
      el.geminiTestStatusBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      el.geminiTestStatusBox.innerHTML = `❌ Lỗi kết nối: ${data.error || 'Không xác định'}`;
    }
  } catch (err) {
    if (el.geminiTestStatusBox) {
      el.geminiTestStatusBox.style.background = 'rgba(239, 68, 68, 0.1)';
      el.geminiTestStatusBox.style.color = '#F87171';
      el.geminiTestStatusBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      el.geminiTestStatusBox.innerHTML = `❌ Lỗi gọi API: ${err.message}`;
    }
  }
}


// --- Cache & Project Management Functions ---
async function updateCacheStatsBadge() {
  try {
    const res = await fetch('/api/cache_stats');
    if (!res.ok) return;
    const data = await res.json();
    if (el.cacheStatsBadge) {
      el.cacheStatsBadge.textContent = `⚡ Bộ nhớ đệm: ${data.total_cached_files} câu (${data.size_mb} MB)`;
    }
  } catch (e) { }
}

async function checkSubtitlesCache() {
  if (!state.subtitles || state.subtitles.length === 0) {
    if (el.cacheAlertBanner) el.cacheAlertBanner.style.display = 'none';
    return;
  }
  try {
    const res = await fetch('/api/check_cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subtitles: state.subtitles,
        voice: el.voiceSelect.value,
        voice_rate: el.voiceRateSelect.value,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.subtitles) {
      state.subtitles = data.subtitles;
      renderSubtitleList(state.subtitles);
    }
    if (el.cacheAlertBanner && el.cacheAlertTitle && el.cacheAlertDesc) {
      if (data.cached_count > 0) {
        el.cacheAlertBanner.style.display = 'flex';
        el.cacheAlertTitle.textContent = `⚡ Đã phát hiện ${data.cached_count.toLocaleString()} / ${data.total.toLocaleString()} câu (${data.cached_percent}%) có sẵn âm thanh trong Bộ nhớ đệm!`;
        el.cacheAlertDesc.textContent = `Tiến trình tạo giọng đọc AI sẽ tự động tái sử dụng 100% các câu này trong 0 giây, chỉ cần tạo ${data.missing_count.toLocaleString()} câu còn thiếu.`;
      } else {
        el.cacheAlertBanner.style.display = 'none';
      }
    }
    updateCacheStatsBadge();
  } catch (e) { }
}

function openProjectsModal() {
  if (el.projectsModalBackdrop) {
    el.projectsModalBackdrop.classList.add('show');
    loadProjectsList();
  }
}

function closeProjectsModal() {
  if (el.projectsModalBackdrop) {
    el.projectsModalBackdrop.classList.remove('show');
  }
}

async function loadProjectsList() {
  if (!el.projectsList) return;
  el.projectsList.innerHTML = '<div style="text-align: center; color: var(--muted); padding: 30px;">Đang tải danh sách dự án...</div>';

  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    const projects = data.projects || [];

    if (projects.length === 0) {
      el.projectsList.innerHTML = `
        <div style="text-align: center; color: var(--muted); padding: 30px;">
          <div style="font-size: 32px; margin-bottom: 8px;">📂</div>
          <div style="font-weight: 600; margin-bottom: 4px;">Chưa có dự án nào được lưu</div>
          <div style="font-size: 12px;">Khi bạn tải video hoặc SRT lên, dự án sẽ tự động được lưu tại đây để mở lại bất cứ lúc nào.</div>
        </div>
      `;
      return;
    }

    el.projectsList.innerHTML = '';
    projects.forEach((proj) => {
      const card = document.createElement('div');
      card.className = 'project-card';

      let statusBadge = '';
      if (proj.status === 'completed') {
        statusBadge = '<span class="project-status-pill completed">✅ Hoàn tất</span>';
      } else if (proj.status === 'needs_review') {
        statusBadge = '<span class="project-status-pill needs_review">⚠️ Cần xem xét câu lỗi</span>';
      } else {
        statusBadge = '<span class="project-status-pill ready">⚡ Sẵn sàng</span>';
      }

      const cachedPct = proj.cached_percent || 0;
      const totalSegs = proj.total_segments || 0;
      const cachedSegs = proj.cached_segments || 0;

      card.innerHTML = `
        <div class="project-card-header">
          <div>
            <div class="project-card-title">${escapeHtml(proj.name || 'Dự án không tên')}</div>
            <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">Mã: ${proj.project_id} &bull; Cập nhật: ${proj.updated_at || ''}</div>
          </div>
          ${statusBadge}
        </div>

        <div class="project-card-meta">
          <span>🎬 Video: ${proj.video_path ? escapeHtml(proj.video_path.split(/[\\/]/).pop()) : 'Chưa có'}</span>
          <span>📝 Phụ đề: ${totalSegs} câu</span>
          <span>🎙️ Giọng: ${escapeHtml(proj.voice || 'Mặc định')} (${proj.voice_rate || '1.0'}x)</span>
        </div>

        <div class="project-cache-bar-wrap">
          <div class="project-cache-bar-bg">
            <div class="project-cache-bar-fill" style="width: ${cachedPct}%;"></div>
          </div>
          <span style="font-size: 11px; font-weight: 700; color: ${cachedPct >= 90 ? '#34D399' : '#60A5FA'}; white-space: nowrap;">
            ${cachedSegs.toLocaleString()} / ${totalSegs.toLocaleString()} câu (${cachedPct}%)
          </span>
        </div>

        <div class="project-card-actions">
          <button class="btn btn-outline btn-sm btn-delete-proj" data-id="${proj.project_id}" style="color: #F87171; border-color: rgba(248,113,113,0.3);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Xóa
          </button>
          <button class="btn btn-teal btn-sm btn-load-proj" data-id="${proj.project_id}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            Mở Dự Án Này
          </button>
        </div>
      `;

      card.querySelector('.btn-load-proj').addEventListener('click', () => selectProject(proj.project_id));
      card.querySelector('.btn-delete-proj').addEventListener('click', (e) => deleteProject(proj.project_id, e));

      el.projectsList.appendChild(card);
    });

  } catch (err) {
    el.projectsList.innerHTML = `<div style="color: #F87171; padding: 20px; text-align: center;">Lỗi tải dự án: ${err.message}</div>`;
  }
}

async function selectProject(projectId) {
  try {
    const res = await fetch('/api/projects/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!res.ok) throw new Error('Không thể nạp dự án');
    const data = await res.json();

    state.videoPath = data.video_path;
    state.videoUrl = data.video_url;
    state.videoMeta = data.video_meta;
    state.srtDubPath = data.srt_dub_path;
    state.srtOrigPath = data.srt_orig_path;
    state.subtitles = data.subtitles || [];
    state.currentSessionId = data.project_id || projectId;

    if (data.video_path) {
      el.videoFileName.textContent = data.video_path.split(/[\\/]/).pop();
    }
    if (data.srt_dub_path) {
      el.srtDubFileName.textContent = data.srt_dub_path.split(/[\\/]/).pop();
    }
    if (data.srt_orig_path) {
      el.srtOrigFileName.textContent = data.srt_orig_path.split(/[\\/]/).pop();
    }

    if (data.voice && el.voiceSelect) el.voiceSelect.value = data.voice;
    if (data.voice_rate && el.voiceRateSelect) el.voiceRateSelect.value = data.voice_rate;

    state.currentJobId = data.project_id || projectId;
    try { localStorage.setItem('active_dubbing_job_id', state.currentJobId); } catch (e) { }

    if (data.video_url) {
      loadVideoIntoPlayer(data.video_url);
    }

    if (state.subtitles.length > 0) {
      renderSubtitleList(state.subtitles);
      checkSubtitlesCache();
    }

    closeProjectsModal();
    appendLog(`[HỆ THỐNG] Đã nạp thành công dự án "${data.name}" (${data.cached_segments || 0}/${data.total_segments || 0} câu đã có trong Cache).`);
  } catch (err) {
    alert('Lỗi nạp dự án: ' + err.message);
  }
}

async function deleteProject(projectId, evt) {
  evt.stopPropagation();
  if (!confirm('Bạn có chắc chắn muốn xóa dự án này khỏi danh sách?')) return;
  try {
    const res = await fetch('/api/projects/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!res.ok) throw new Error('Không thể xóa dự án');
    loadProjectsList();
  } catch (err) {
    alert('Lỗi xóa dự án: ' + err.message);
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
  if (state.currentSessionId) {
    formData.append('session_id', state.currentSessionId);
  }

  try {
    const res = await fetch('/api/upload_files', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (data.session_id) {
      state.currentSessionId = data.session_id;
    }

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
      checkSubtitlesCache();
    }
    updateCacheStatsBadge();
  } catch (err) {
    alert('Lỗi tải file lên: ' + err.message);
  }
}

function getSpeedBadgeInfo(item) {
  if (item.sync_desc) {
    let cls = 'ok';
    if (item.speed_warning_level === 'critical' || item.sync_mode === 'setpts') cls = 'danger';
    else if (item.speed_warning_level === 'warning') cls = 'warn';
    return { text: item.sync_desc, cls };
  }

  const ratio = item.ratio || 1.0;
  const minAudioSpeed = el.minAudioSpeedSlider ? parseFloat(el.minAudioSpeedSlider.value) || 0.85 : 0.85;
  const maxAudioSpeed = el.maxAudioSpeedSlider ? parseFloat(el.maxAudioSpeedSlider.value) || 1.35 : 1.35;
  const gapBorrow = el.gapBorrowSlider ? parseFloat(el.gapBorrowSlider.value) || 0.80 : 0.80;

  if (Math.abs(ratio - 1.0) < 0.05) {
    return { text: 'Chuẩn 1.0x (Khớp)', cls: 'ok' };
  }

  if (ratio > 1.0) {
    // Audio is shorter than segment duration -> ratio = Dv / Da > 1.0
    const reqAudioSpeed = 1.0 / ratio;
    if (reqAudioSpeed >= minAudioSpeed && minAudioSpeed < 0.99) {
      return { text: `Giảm giọng ${reqAudioSpeed.toFixed(2)}x`, cls: 'ok' };
    } else {
      return { text: 'Chuẩn 1.0x (Đệm khoảng lặng)', cls: 'ok' };
    }
  } else {
    // Audio is longer than segment duration -> ratio = Dv / Da < 1.0
    const dur = typeof item.duration_sec === 'number' ? item.duration_sec : 2.0;
    const nextGap = item.next_gap_sec || 0.0;
    const usableGap = Math.min(gapBorrow, Math.max(0, nextGap - 0.15));
    const effectiveDur = dur + usableGap;
    const audDur = item.audio_duration_sec || (dur / Math.max(0.1, ratio));
    const reqAudioSpeed = audDur / Math.max(0.1, effectiveDur);

    if (reqAudioSpeed <= 1.05 && usableGap > 0) {
      return { text: `Chuẩn 1.0x (Mượn ${usableGap.toFixed(2)}s Gap)`, cls: 'ok' };
    } else if (reqAudioSpeed <= maxAudioSpeed) {
      const gapNote = usableGap > 0 ? ` + Mượn ${usableGap.toFixed(1)}s` : '';
      const cls = reqAudioSpeed <= 1.20 ? 'ok' : 'warn';
      return { text: `Tăng ${reqAudioSpeed.toFixed(2)}x${gapNote}`, cls };
    } else {
      const gapNote = usableGap > 0 ? ` + Mượn ${usableGap.toFixed(1)}s` : '';
      return { text: `⚠️ Quá dài (${reqAudioSpeed.toFixed(2)}x)${gapNote}`, cls: 'danger' };
    }
  }
}


// --- Render Subtitle List ---
function renderSubtitleList(subs) {
  if (!el.srtList) return;
  el.srtList.innerHTML = '';
  const count = (subs && Array.isArray(subs)) ? subs.length : 0;
  if (el.srtCountLabel) {
    el.srtCountLabel.textContent = `SRT — ${count} DÒNG`;
  }

  if (subs && subs.length > 0) {
    const first = subs[0];
    const last = subs[subs.length - 1];
    if (el.rangeIndicator) {
      const fStart = typeof first.start_sec === 'number' ? first.start_sec : (parseFloat(first.start_sec) || 0);
      const lEnd = typeof last.end_sec === 'number' ? last.end_sec : (parseFloat(last.end_sec) || 0);
      el.rangeIndicator.textContent = `${fmtTime(fStart)} – ${fmtTime(lEnd)}`;
    }
  }

  (subs || []).forEach((item, i) => {
    const idx = item.index ?? item.id ?? (i + 1);
    const startSec = typeof item.start_sec === 'number' ? item.start_sec : (parseFloat(item.start_sec) || 0);
    const endSec = typeof item.end_sec === 'number' ? item.end_sec : (parseFloat(item.end_sec) || startSec);
    const durSec = typeof item.duration_sec === 'number' ? item.duration_sec : (parseFloat(item.duration_sec) || Math.max(0.1, endSec - startSec));

    const div = document.createElement('div');
    div.className = 'srt-line';
    div.dataset.idx = idx;
    div.dataset.start = startSec;
    div.dataset.end = endSec;

    const badgeInfo = getSpeedBadgeInfo(item);
    const cacheTagHtml = item.has_cache
      ? `<span class="sub-cache-tag cached" title="Đã có âm thanh trong Cache (Tải 0s)">⚡ Sẵn sàng</span>`
      : `<span class="sub-cache-tag missing" title="Chưa tạo âm thanh">⏳ Chưa tạo</span>`;

    div.innerHTML = `
      <div class="srt-idx">${String(idx).padStart(2, '0')}</div>
      <div class="srt-body">
        <div class="srt-time">
          <span>${fmtTime(startSec)} → ${fmtTime(endSec)} (${durSec.toFixed(1)}s)</span>
          ${cacheTagHtml}
          <span class="ratio ${badgeInfo.cls}" id="ratio-badge-${idx}">${badgeInfo.text}</span>
        </div>
        <div class="srt-text">${escapeHtml(item.text_dub || '')}</div>
        ${item.text_orig ? `<div class="orig">${escapeHtml(item.text_orig)}</div>` : ''}
      </div>
    `;

    div.addEventListener('click', () => {
      seekToTime(startSec + 0.05);
    });
    el.srtList.appendChild(div);
  });
}

// --- Player Logic ---
function loadVideoIntoPlayer(url) {
  if (el.videoPlaceholder) el.videoPlaceholder.style.display = 'none';
  if (el.mainVideo) {
    el.mainVideo.style.display = 'block';
    el.mainVideo.src = url;
    el.mainVideo.load();
    el.mainVideo.onloadedmetadata = () => {
      state.totalDuration = el.mainVideo.duration || state.totalDuration;
      if (el.totalTimeText) el.totalTimeText.textContent = fmtTime(state.totalDuration);
      updatePlayerUI();
    };
  }
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

function toggleFullScreen() {
  const container = document.querySelector('.video-pane');
  if (!container) return;

  if (!document.fullscreenElement) {
    if (container.requestFullscreen) {
      container.requestFullscreen().catch(console.warn);
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

function toggleMute() {
  if (!el.mainVideo) return;
  el.mainVideo.muted = !el.mainVideo.muted;
  if (!el.mainVideo.muted && el.mainVideo.volume === 0) {
    el.mainVideo.volume = 1;
  }
  updateMuteButton();
}

function updateMuteButton() {
  if (!el.muteIcon || !el.mainVideo) return;
  if (el.mainVideo.muted || el.mainVideo.volume === 0) {
    el.muteIcon.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
    if (el.muteBtn) el.muteBtn.title = "Bật âm thanh";
  } else {
    el.muteIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    if (el.muteBtn) el.muteBtn.title = "Tắt âm thanh";
  }
}

async function togglePiP() {
  if (!el.mainVideo) return;
  try {
    if (el.mainVideo !== document.pictureInPictureElement) {
      await el.mainVideo.requestPictureInPicture();
    } else {
      await document.exitPictureInPicture();
    }
  } catch (error) {
    console.warn(`Lỗi mở PiP: ${error.message}`);
  }
}

function setupSpeedMenu() {
  if (!el.speedBtn || !el.speedMenuPopup) return;

  // Toggle speed menu dropdown
  el.speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.speedMenuPopup.classList.toggle('show');
  });

  // Handle option selection
  el.speedMenuPopup.querySelectorAll('.speed-opt-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const speedVal = parseFloat(btn.dataset.speed) || 1.0;
      setPlaybackSpeed(speedVal);
      el.speedMenuPopup.classList.remove('show');
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (el.speedMenuPopup.classList.contains('show')) {
      if (!el.speedMenuPopup.contains(e.target) && e.target !== el.speedBtn) {
        el.speedMenuPopup.classList.remove('show');
      }
    }
  });

  // Close dropdown on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.speedMenuPopup.classList.contains('show')) {
      el.speedMenuPopup.classList.remove('show');
    }
  });
}

function setPlaybackSpeed(speed) {
  if (el.mainVideo) {
    el.mainVideo.playbackRate = speed;
  }
  if (el.speedBtn) {
    el.speedBtn.textContent = speed === 1 ? '1x' : `${speed}x`;
    el.speedBtn.title = `Tốc độ phát: ${speed}x`;
    if (speed !== 1) {
      el.speedBtn.style.color = 'var(--amber)';
    } else {
      el.speedBtn.style.color = 'var(--muted)';
    }
  }

  // Update active styling on items in menu
  if (el.speedMenuPopup) {
    el.speedMenuPopup.querySelectorAll('.speed-opt-btn').forEach((btn) => {
      const bSpeed = parseFloat(btn.dataset.speed) || 1.0;
      btn.classList.toggle('active', Math.abs(bSpeed - speed) < 0.01);
    });
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

  if (activeSub && state.burnSubtitlesEnabled) {
    el.captionBox.style.display = 'block';
    el.captionText.textContent = activeSub.text_dub;
  } else {
    el.captionBox.style.display = 'none';
  }

  let currentActiveElement = null;
  let currentActiveId = null;

  document.querySelectorAll('.srt-line').forEach((row) => {
    const start = parseFloat(row.dataset.start);
    const end = parseFloat(row.dataset.end);
    const isActive = cur >= start && cur < end;

    if (isActive) {
      currentActiveElement = row;
      currentActiveId = row.dataset.idx;
    }

    if (row.classList.contains('active') !== isActive) {
      row.classList.toggle('active', isActive);
    }
  });

  // Tự động cuộn đến phụ đề hiện tại
  if (currentActiveElement && state.lastActiveSubId !== currentActiveId) {
    state.lastActiveSubId = currentActiveId;
    currentActiveElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (!currentActiveElement && state.lastActiveSubId !== null) {
    state.lastActiveSubId = null;
  }
}

function updateSubtitleOutputUI() {
  state.subtitleOverlayEnabled = el.subtitleOverlayEnabled ? el.subtitleOverlayEnabled.checked : true;
  state.burnSubtitlesEnabled = el.burnSubtitlesEnabled ? el.burnSubtitlesEnabled.checked : true;
  state.subtitlePosition = el.subtitlePositionSlider ? parseInt(el.subtitlePositionSlider.value, 10) : 8;
  syncLegacyPrimaryMaskState();
  state.subtitleFontSize = el.subtitleFontSizeSlider ? parseInt(el.subtitleFontSizeSlider.value, 10) : 22;
  state.subtitleColor = el.subtitleColorSelect ? el.subtitleColorSelect.value : 'white';
  state.subtitleOutline = el.subtitleOutlineSlider ? parseInt(el.subtitleOutlineSlider.value, 10) : 2;
  if (el.subtitlePositionBadge) el.subtitlePositionBadge.textContent = `${state.subtitlePosition}%`;
  if (el.subtitleFontSizeBadge) el.subtitleFontSizeBadge.textContent = state.subtitleFontSize;
  if (el.subtitleOutlineBadge) el.subtitleOutlineBadge.textContent = `${state.subtitleOutline}px`;
  renderMaskLayersPreview();
  renderMaskLayerList();
  if (el.captionBox) {
    const colorMap = { white: '#ffffff', yellow: '#ffe36d', cyan: '#72f4e4' };
    el.captionBox.style.bottom = `${state.subtitlePosition}%`;
    el.captionBox.style.fontSize = `${state.subtitleFontSize}px`;
    el.captionBox.style.setProperty('--caption-color', colorMap[state.subtitleColor] || '#ffffff');
    el.captionBox.style.setProperty('--caption-outline', `${state.subtitleOutline}px`);
  }
  updatePlayerUI();
}

function syncLegacyPrimaryMaskState() {
  const primaryMask = state.maskLayers[0];
  if (!primaryMask) return;
  state.maskHeight = primaryMask.height;
  state.maskOpacity = primaryMask.opacity;
  state.maskBlur = primaryMask.blur;
}

function addMaskLayer() {
  const id = Date.now();
  state.maskLayers.push({ id, x: 12, y: 18, width: 76, height: 18, opacity: 45, blur: 12 });
  state.activeMaskLayerId = id;
  updateSubtitleOutputUI();
}

function removeMaskLayer(id) {
  if (state.maskLayers.length <= 1) return;
  state.maskLayers = state.maskLayers.filter((layer) => layer.id !== id);
  state.activeMaskLayerId = state.maskLayers[0]?.id || null;
  updateSubtitleOutputUI();
}

function renderMaskLayersPreview() {
  if (!el.subtitleMaskLayers) return;
  el.subtitleMaskLayers.innerHTML = '';
  if (!state.subtitleOverlayEnabled) return;
  state.maskLayers.forEach((layer, index) => {
    const node = document.createElement('div');
    node.className = `subtitle-mask-layer${layer.id === state.activeMaskLayerId ? ' active' : ''}`;
    node.dataset.maskId = layer.id;
    node.title = `Lớp che ${index + 1}: kéo để di chuyển`;
    node.style.left = `${layer.x}%`;
    node.style.top = `${layer.y}%`;
    node.style.width = `${layer.width}%`;
    node.style.height = `${layer.height}%`;
    node.style.background = `rgba(0, 0, 0, ${layer.opacity / 100})`;
    node.style.backdropFilter = `blur(${layer.blur}px)`;
    node.innerHTML = `<span>Lớp che ${index + 1}</span>`;
    node.addEventListener('pointerdown', (event) => startMaskLayerDrag(layer.id, event));
    el.subtitleMaskLayers.appendChild(node);
  });
}

function renderMaskLayerList() {
  if (!el.maskLayerList) return;
  el.maskLayerList.innerHTML = '';
  state.maskLayers.forEach((layer, index) => {
    const row = document.createElement('div');
    row.className = 'mask-layer-row';
    row.innerHTML = `<strong>Lớp ${index + 1}</strong>
      <div class="mask-layer-controls">
        <label>Rộng <input data-key="width" type="number" min="5" max="100" value="${layer.width}">%</label>
        <label>Cao <input data-key="height" type="number" min="5" max="100" value="${layer.height}">%</label>
        <label>Tối <input data-key="opacity" type="number" min="0" max="90" value="${layer.opacity}">%</label>
        <label>Mờ nền <input data-key="blur" type="number" min="0" max="30" value="${layer.blur}" title="Độ mờ nền">px</label>
      </div>
      <button type="button" class="mask-layer-delete" title="Xóa lớp che" ${state.maskLayers.length === 1 ? 'disabled' : ''}>×</button>`;
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
      const key = input.dataset.key;
      layer[key] = Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) || 0));
      layer.x = Math.min(layer.x, 100 - layer.width);
      layer.y = Math.min(layer.y, 100 - layer.height);
      state.activeMaskLayerId = layer.id;
      syncLegacyPrimaryMaskState();
      renderMaskLayersPreview();
    }));
    row.querySelector('.mask-layer-delete').addEventListener('click', () => removeMaskLayer(layer.id));
    el.maskLayerList.appendChild(row);
  });
}

let activeMaskDrag = null;

function startMaskLayerDrag(maskId, event) {
  const screen = document.querySelector('.screen');
  const layer = state.maskLayers.find((item) => item.id === maskId);
  if (!screen || !layer) return;
  state.activeMaskLayerId = maskId;
  activeMaskDrag = { maskId, startX: event.clientX, startY: event.clientY, x: layer.x, y: layer.y };
  screen.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function setupDirectSubtitleEditor() {
  const screen = document.querySelector('.screen');
  if (!screen) return;
  let dragMode = null;
  let startY = 0;
  let startValue = 0;
  const startDrag = (mode, event) => {
    if ((mode === 'caption' && !state.burnSubtitlesEnabled) || (mode === 'mask' && !state.subtitleOverlayEnabled)) return;
    dragMode = mode;
    startY = event.clientY;
    startValue = state.subtitlePosition;
    screen.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  el.captionBox?.addEventListener('pointerdown', (event) => startDrag('caption', event));
  el.subtitleMaskResizeHandle?.addEventListener('pointerdown', (event) => startDrag('mask', event));
  screen.addEventListener('pointermove', (event) => {
    if (activeMaskDrag) {
      const layer = state.maskLayers.find((item) => item.id === activeMaskDrag.maskId);
      if (!layer) return;
      layer.x = Math.round(Math.max(0, Math.min(100 - layer.width, activeMaskDrag.x + ((event.clientX - activeMaskDrag.startX) / Math.max(1, screen.clientWidth)) * 100)));
      layer.y = Math.round(Math.max(0, Math.min(100 - layer.height, activeMaskDrag.y + ((event.clientY - activeMaskDrag.startY) / Math.max(1, screen.clientHeight)) * 100)));
      renderMaskLayersPreview();
      renderMaskLayerList();
      return;
    }
    if (!dragMode) return;
    const deltaPercent = ((startY - event.clientY) / Math.max(1, screen.clientHeight)) * 100;
    const slider = el.subtitlePositionSlider;
    if (!slider) return;
    const value = Math.round(Math.max(Number(slider.min), Math.min(Number(slider.max), startValue + deltaPercent)));
    slider.value = value;
    updateSubtitleOutputUI();
  });
  const stopDrag = () => { dragMode = null; activeMaskDrag = null; };
  screen.addEventListener('pointerup', stopDrag);
  screen.addEventListener('pointercancel', stopDrag);
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
    max_audio_speed: el.maxAudioSpeedSlider ? parseFloat(el.maxAudioSpeedSlider.value) : 1.40,
    max_gap_borrow: el.gapBorrowSlider ? parseFloat(el.gapBorrowSlider.value) : 0.80,
    use_adaptive_prosody: el.useAdaptiveProsodyCheckbox ? el.useAdaptiveProsodyCheckbox.checked : true,
    orig_volume: origVolVal,
    dub_volume: dubVolVal,
    num_workers: parseInt(el.threadsSlider.value, 10) || 50,
    subtitle_overlay_enabled: state.subtitleOverlayEnabled,
    burn_subtitles_enabled: state.burnSubtitlesEnabled,
    subtitle_position_percent: state.subtitlePosition,
    subtitle_mask_height_percent: state.maskHeight,
    subtitle_mask_opacity: state.maskOpacity / 100,
    subtitle_mask_blur: state.maskBlur,
    subtitle_font_size: state.subtitleFontSize,
    subtitle_color: state.subtitleColor,
    subtitle_outline: state.subtitleOutline,
    subtitle_masks: state.maskLayers.map(({ x, y, width, height, opacity, blur }) => ({ x, y, width, height, opacity: opacity / 100, blur })),
  };


  el.btnStartDubbing.disabled = true;
  el.modalBackdrop.classList.add('show');
  el.modalTitle.textContent = 'Đang xử lý lồng tiếng & Render FFmpeg...';
  el.progressBarFill.style.width = '0%';
  el.statusMsg.textContent = 'Đang khởi tạo tiến trình...';
  el.logBox.innerHTML = '';
  el.btnDownloadResult.style.display = 'none';
  if (el.btnDownloadSrt) el.btnDownloadSrt.style.display = 'none';
  if (el.btnOpenVideo) el.btnOpenVideo.style.display = 'none';
  if (el.btnOpenFolder) el.btnOpenFolder.style.display = 'none';

  // Reset Pipeline Stepper & Dual Progress Bars
  lastStepperStage = '';
  STEPPER_EL_IDS.forEach(id => {
    if (el[id]) el[id].classList.remove('active', 'done');
  });
  if (el.overallPctText) el.overallPctText.textContent = '0%';
  if (el.stageProgressBarFill) el.stageProgressBarFill.style.width = '0%';
  if (el.stagePctText) el.stagePctText.textContent = '0%';
  if (el.renderStatsHud) el.renderStatsHud.style.display = 'none';
  if (el.failedReviewContainer) el.failedReviewContainer.style.display = 'none';

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
    } catch (e) { }

    connectWebSocket(data.job_id);
  } catch (err) {
    appendLog(`[LỖI] ${err.message}`);
    el.statusMsg.textContent = `Lỗi: ${err.message}`;
    el.btnStartDubbing.disabled = false;
  }
}

// --- Live Progress Handler (Unified for WS & Polling) ---
let pollIntervalTimer = null;

function startJobPolling(jobId) {
  if (pollIntervalTimer) clearInterval(pollIntervalTimer);
  pollIntervalTimer = setInterval(async () => {
    if (!state.currentJobId || state.currentJobId !== jobId) {
      clearInterval(pollIntervalTimer);
      return;
    }
    try {
      const res = await fetch(`/api/job_status/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        handleJobUpdate(data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollIntervalTimer);
        }
      }
    } catch (e) { }
  }, 1500);
}

let lastLoggedMessage = '';

// --- Pipeline Stepper Logic ---
const STEPPER_STAGES = {
  // stage name -> step index (0=init, 1=tts, 2=audio, 3=video)
  'starting': 0, 'init': 0,
  'tts': 1, 'tts_needs_review': 1,
  'audio_render': 2, 'concat_audio': 2, 'mix_audio': 2,
  'video_render': 3,
  'completed': 4, 'failed': -1,
};
const STEPPER_EL_IDS = ['stepInit', 'stepTts', 'stepAudio', 'stepVideo'];
let lastStepperStage = '';

function updatePipelineStepper(stage) {
  if (!stage || stage === lastStepperStage) return;
  lastStepperStage = stage;

  const activeIdx = STEPPER_STAGES[stage];
  if (activeIdx === undefined) return;

  STEPPER_EL_IDS.forEach((elId, idx) => {
    const stepEl = el[elId];
    if (!stepEl) return;
    stepEl.classList.remove('active', 'done');
    if (activeIdx === 4) {
      // All completed
      stepEl.classList.add('done');
    } else if (idx < activeIdx) {
      stepEl.classList.add('done');
    } else if (idx === activeIdx) {
      stepEl.classList.add('active');
    }
  });

  // Reset stage sub-progress bar when switching stages
  if (el.stageProgressBarFill) el.stageProgressBarFill.style.width = '0%';
  if (el.stagePctText) el.stagePctText.textContent = '0%';
}

function handleJobUpdate(msg) {
  if (!msg) return;

  // --- Overall Progress Bar ---
  if (msg.percent !== undefined) {
    el.progressBarFill.style.width = `${msg.percent}%`;
    if (el.overallPctText) el.overallPctText.textContent = `${Math.round(msg.percent)}%`;
    if (el.floatingJobPct) el.floatingJobPct.textContent = `${Math.round(msg.percent)}%`;
  }

  // --- Stage Sub-Progress Bar ---
  if (msg.data && msg.data.stage_percent !== undefined) {
    const stagePct = Math.round(msg.data.stage_percent);
    if (el.stageProgressBarFill) el.stageProgressBarFill.style.width = `${stagePct}%`;
    if (el.stagePctText) el.stagePctText.textContent = `${stagePct}%`;
  }

  // --- Status Message ---
  if (msg.message) {
    el.statusMsg.textContent = msg.message;
    if (el.floatingJobTitle) el.floatingJobTitle.textContent = msg.message;
    if ((msg.stage || msg.status) && msg.message !== lastLoggedMessage) {
      lastLoggedMessage = msg.message;
      appendLog(`[${(msg.stage || msg.status || 'INFO').toUpperCase()}] ${msg.message}`);
    }
  }

  // --- Pipeline Stepper Update ---
  updatePipelineStepper(msg.stage || msg.status);

  // --- Live Render Stats HUD (shown during audio + video FFmpeg stages) ---
  const hudStages = ['audio_render', 'concat_audio', 'mix_audio', 'video_render'];
  if (hudStages.includes(msg.stage) && msg.data) {
    if (el.renderStatsHud) el.renderStatsHud.style.display = 'flex';
    if (el.hudFrames && msg.data.frame !== undefined) {
      el.hudFrames.textContent = parseInt(msg.data.frame, 10).toLocaleString();
    }
    if (el.hudSpeed && msg.data.speed !== undefined) {
      el.hudSpeed.textContent = `${msg.data.speed}x`;
    }
    if (el.hudTime && msg.data.cur_sec !== undefined && msg.data.total_sec !== undefined) {
      el.hudTime.textContent = `${fmtTime(msg.data.cur_sec)} / ${fmtTime(msg.data.total_sec)}`;
    }
    if (el.hudStagePercent && msg.data.stage_percent !== undefined) {
      el.hudStagePercent.textContent = `${Math.round(msg.data.stage_percent)}%`;
    }
  } else if (msg.stage === 'completed' || msg.status === 'completed') {
    if (el.renderStatsHud) el.renderStatsHud.style.display = 'none';
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
  if (msg.stage === 'tts_needs_review' || msg.status === 'needs_review') {
    el.modalTitle.textContent = '⚠️ Cần xem xét câu lỗi CapCut';
    el.btnStartDubbing.disabled = false;
    const failed = msg.data?.failed_segments || msg.failed_segments || [];
    renderFailedSegmentsReview(failed);
  }

  // Completed
  if (msg.stage === 'completed' || msg.status === 'completed') {
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

    if (el.btnOpenVideo) el.btnOpenVideo.style.display = 'inline-flex';
    if (el.btnOpenFolder) el.btnOpenFolder.style.display = 'inline-flex';

    const vidUrl = msg.output_url || (msg.result && msg.result.output_url);
    if (vidUrl) {
      el.btnDownloadResult.style.display = 'inline-flex';
      el.btnDownloadResult.onclick = () => {
        window.open(vidUrl, '_blank');
      };
      // Automatically load final dubbed video into player
      loadVideoIntoPlayer(vidUrl);
    }

    const srtUrl = msg.output_srt_url || (msg.result && msg.result.output_srt_url);
    if (srtUrl && el.btnDownloadSrt) {
      el.btnDownloadSrt.style.display = 'inline-flex';
      el.btnDownloadSrt.onclick = () => {
        window.open(srtUrl, '_blank');
      };
    }
  } else if (msg.stage === 'failed' || msg.status === 'failed') {
    el.modalTitle.textContent = '❌ Quá trình Render gặp lỗi';
    el.btnStartDubbing.disabled = false;
    if (el.floatingJobTitle) el.floatingJobTitle.textContent = '❌ Lỗi xử lý';
  }
}

// --- WebSocket Live Progress Stream with Polling Fallback ---
function connectWebSocket(jobId) {
  startJobPolling(jobId);
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/progress/${jobId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendLog('[HỆ THỐNG] Đã kết nối WebSocket tiến độ thời gian thực.');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleJobUpdate(msg);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onerror = (e) => {
      console.warn('WS fallback to polling active');
    };
  } catch (e) {
    console.warn('WS Init failed, polling will handle updates:', e);
  }
}

// --- Render Failed Sentences Review Box ---
function renderFailedSegmentsReview(failedSegments) {
  if (!el.failedReviewContainer || !el.failedList) return;
  if (!failedSegments || failedSegments.length === 0) return;

  el.failedCountBadge.textContent = failedSegments.length;
  el.failedReviewContainer.style.display = 'block';

  // Guard: If list is already rendered for current job, do NOT wipe user input on polling ticks!
  const currentRenderKey = `${state.currentJobId}_${failedSegments.map(s => s.seg_id).join(',')}`;
  if (el.failedList.dataset.renderKey === currentRenderKey && el.failedList.children.length > 0) {
    return;
  }
  el.failedList.dataset.renderKey = currentRenderKey;
  el.failedList.innerHTML = '';

  failedSegments.forEach((seg) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'failed-item';
    itemDiv.id = `failed-item-${seg.seg_id}`;
    itemDiv.style.flexDirection = 'column';
    itemDiv.style.alignItems = 'stretch';

    const hasChinese = /[\u4e00-\u9fa5]/.test(seg.text_dub || '');
    const isVnVoice = (el.voiceSelect.value || '').startsWith('BV421') || (el.voiceSelect.value || '').startsWith('BV074') || (el.voiceSelect.value || '').startsWith('vi_');
    const langWarningHtml = (hasChinese && isVnVoice)
      ? `<div class="failed-err-msg" style="color: #F87171; font-size: 11px; margin-top: 4px;">⚠️ Câu này đang là chữ tiếng Trung nên giọng Việt không đọc được. Vui lòng nhập bản dịch tiếng Việt vào ô trên rồi bấm "Thử lại".</div>`
      : '';

    itemDiv.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; width: 100%; flex-wrap: wrap;">
        <div class="failed-item-idx">#${String(seg.seg_id).padStart(2, '0')}</div>
        <input type="text" class="failed-item-input" id="failed-input-${seg.seg_id}" value="${escapeHtml(seg.text_dub)}" placeholder="Nhập câu tiếng Việt thay thế..." style="flex: 1; min-width: 180px;" />
        <button class="failed-item-btn" id="btn-gemini-${seg.seg_id}" style="background: rgba(139, 92, 246, 0.15); color: #C4B5FD; border: 1px solid rgba(139, 92, 246, 0.35); font-weight: 600;" title="Dùng Gemini AI dịch hoặc sửa từ nhạy cảm">
          <span>🪄</span> Dịch AI
        </button>
        <button class="failed-item-btn" id="btn-retry-${seg.seg_id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Thử lại
        </button>
      </div>
      <div class="failed-err-container" id="failed-err-${seg.seg_id}">
        ${langWarningHtml}
      </div>
    `;

    const retryBtn = itemDiv.querySelector(`#btn-retry-${seg.seg_id}`);
    const geminiBtn = itemDiv.querySelector(`#btn-gemini-${seg.seg_id}`);
    const inputEl = itemDiv.querySelector(`#failed-input-${seg.seg_id}`);
    const errContainer = itemDiv.querySelector(`#failed-err-${seg.seg_id}`);

    // Single Gemini AI Translate & Fix Button
    geminiBtn.addEventListener('click', async () => {
      const currentVal = inputEl.value.trim();
      if (!currentVal) return;

      geminiBtn.disabled = true;
      geminiBtn.innerHTML = '🪄 Đang dịch...';
      if (errContainer) errContainer.innerHTML = '<div style="color: #A78BFA; font-size: 11px; margin-top: 4px;">🪄 Đang gọi Gemini AI dịch/sửa câu...</div>';

      try {
        const res = await fetch('/api/gemini/fix_failed_subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments: [{ seg_id: seg.seg_id, text_dub: currentVal }],
            api_keys: getStoredGeminiKeys(),
            model: getStoredGeminiModel(),
          }),
        });
        const data = await res.json();
        const fixedItem = (data.results || [])[0];

        if (fixedItem && fixedItem.fixed_text) {
          inputEl.value = fixedItem.fixed_text;
          inputEl.style.borderColor = '#A78BFA';
          if (errContainer) {
            errContainer.innerHTML = `<div style="color: #34D399; font-size: 11px; margin-top: 4px;">🪄 Đã dịch: "${escapeHtml(fixedItem.fixed_text)}" -> Đang tạo lại giọng đọc...</div>`;
          }
          appendLog(`[GEMINI AI] Câu #${seg.seg_id} đã dịch: "${fixedItem.fixed_text}"`);
          geminiBtn.disabled = false;
          geminiBtn.innerHTML = '<span>🪄</span> Dịch AI';
          // Automatically trigger retry TTS
          retryBtn.click();
        } else {
          geminiBtn.disabled = false;
          geminiBtn.innerHTML = '<span>🪄</span> Dịch AI';
          if (errContainer) errContainer.innerHTML = '<div style="color: #F87171; font-size: 11px; margin-top: 4px;">❌ Không nhận được phản hồi từ Gemini.</div>';
        }
      } catch (err) {
        geminiBtn.disabled = false;
        geminiBtn.innerHTML = '<span>🪄</span> Dịch AI';
        if (errContainer) errContainer.innerHTML = `<div style="color: #F87171; font-size: 11px; margin-top: 4px;">❌ Lỗi gọi Gemini: ${escapeHtml(err.message)}</div>`;
      }
    });

    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.innerHTML = 'Đang tạo...';
      if (errContainer) errContainer.innerHTML = '';

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
          if (geminiBtn) geminiBtn.style.display = 'none';
          inputEl.disabled = true;
          if (errContainer) errContainer.innerHTML = '<div style="color: #34D399; font-size: 11px; margin-top: 4px;">✅ Tạo âm thanh AI thành công!</div>';
          appendLog(`[HỆ THỐNG] Câu #${seg.seg_id} đã tạo âm thanh thành công.`);

          if (data.remaining_failed === 0) {
            appendLog('[HỆ THỐNG] Đã tạo thành công tất cả câu lỗi! Tự động tiếp tục Render Video...');
            setTimeout(resumeDubbingRender, 1000);
          }
        } else {
          retryBtn.disabled = false;
          retryBtn.innerHTML = '❌ Thử lại';
          const errMsg = updatedSeg?.tts_error || 'CapCut từ chối văn bản';
          if (errContainer) {
            errContainer.innerHTML = `<div style="color: #F87171; font-size: 11px; margin-top: 4px;">❌ Lỗi: ${escapeHtml(errMsg)}</div>`;
          }
          appendLog(`[TTS LỖI] Câu #${seg.seg_id}: ${errMsg}`);
        }
      } catch (err) {
        retryBtn.disabled = false;
        retryBtn.innerHTML = '❌ Thử lại';
        if (errContainer) {
          errContainer.innerHTML = `<div style="color: #F87171; font-size: 11px; margin-top: 4px;">❌ Lỗi kết nối: ${escapeHtml(err.message)}</div>`;
        }
        appendLog(`[LỖI] ${err.message}`);
      }
    });

    el.failedList.appendChild(itemDiv);
  });
}

// --- Batch Gemini Fix All Failed Segments with Multi-Threading ---
async function fixAllFailedSegmentsWithGemini() {
  if (!el.failedList || !state.currentJobId) return;
  const items = el.failedList.querySelectorAll('.failed-item:not(.success)');
  if (items.length === 0) {
    resumeDubbingRender();
    return;
  }

  const segmentsToFix = [];
  items.forEach((item) => {
    const segId = parseInt(item.id.replace('failed-item-', ''), 10);
    const inputEl = item.querySelector('.failed-item-input');
    segmentsToFix.push({ seg_id: segId, text_dub: inputEl ? inputEl.value : '' });
  });

  const storedKeys = getStoredGeminiKeys();
  const concurrency = Math.max(1, Math.min(storedKeys.length || 5, 10));

  if (el.btnGeminiFixAllFailed) {
    el.btnGeminiFixAllFailed.disabled = true;
    el.btnGeminiFixAllFailed.innerHTML = `🪄 Đang xoay vòng Gemini Keys dịch ${segmentsToFix.length} câu...`;
  }

  appendLog(`[GEMINI AI] Bắt đầu dịch & sửa đồng loạt ${segmentsToFix.length} câu lỗi (${concurrency} luồng)...`);

  try {
    const res = await fetch('/api/gemini/fix_failed_subtitles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: segmentsToFix,
        api_keys: storedKeys,
        model: getStoredGeminiModel(),
        concurrency: concurrency,
      }),
    });
    const data = await res.json();
    const results = data.results || [];

    results.forEach((r) => {
      const inputEl = document.querySelector(`#failed-input-${r.seg_id}`);
      const errContainer = document.querySelector(`#failed-err-${r.seg_id}`);
      if (inputEl && r.fixed_text) {
        inputEl.value = r.fixed_text;
        inputEl.style.borderColor = '#A78BFA';
      }
      if (errContainer && r.fixed_text) {
        errContainer.innerHTML = `<div style="color: #34D399; font-size: 11px; margin-top: 4px;">🪄 Gemini đã dịch: "${escapeHtml(r.fixed_text)}"</div>`;
      }
    });

    appendLog(`[GEMINI AI] Đã dịch xong toàn bộ ${results.length} câu! Đang tự động thử tạo giọng đọc đồng loạt...`);

    if (el.btnGeminiFixAllFailed) {
      el.btnGeminiFixAllFailed.disabled = false;
      el.btnGeminiFixAllFailed.innerHTML = '<span>🪄</span> Dịch / Sửa tất cả câu lỗi bằng Gemini AI';
    }

    // Automatically trigger retryAllFailedSegments
    setTimeout(retryAllFailedSegments, 500);
  } catch (err) {
    appendLog(`[GEMINI LỖI] ${err.message}`);
    if (el.btnGeminiFixAllFailed) {
      el.btnGeminiFixAllFailed.disabled = false;
      el.btnGeminiFixAllFailed.innerHTML = '<span>🪄</span> Dịch / Sửa tất cả câu lỗi bằng Gemini AI';
    }
  }
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
        const errContainer = itemDiv.querySelector('.failed-err-container');

        if (!updatedSeg.is_failed) {
          itemDiv.classList.add('success');
          if (retryBtn) {
            retryBtn.className = 'failed-item-btn btn-done';
            retryBtn.innerHTML = '✅ Đã tạo';
            retryBtn.disabled = true;
          }
          if (inputEl) inputEl.disabled = true;
          if (errContainer) errContainer.innerHTML = '<div style="color: #34D399; font-size: 11px; margin-top: 4px;">✅ Tạo âm thanh AI thành công!</div>';
        } else {
          if (retryBtn) {
            retryBtn.disabled = false;
            retryBtn.innerHTML = '❌ Thử lại';
          }
          if (errContainer) {
            errContainer.innerHTML = `<div style="color: #F87171; font-size: 11px; margin-top: 4px;">❌ Lỗi: ${escapeHtml(updatedSeg.tts_error || 'Thất bại')}</div>`;
          }
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
  if (el.btnSkipFailedAndRender) {
    el.btnSkipFailedAndRender.disabled = true;
    el.btnSkipFailedAndRender.textContent = 'Đang tiếp tục Render...';
  }
  if (el.failedReviewContainer) el.failedReviewContainer.style.display = 'none';
  el.statusMsg.textContent = 'Đang tiếp tục hòa trộn âm thanh & Render Video...';
  appendLog('[HỆ THỐNG] Bắt đầu tiếp tục render video và bỏ qua các câu lỗi...');

  connectWebSocket(state.currentJobId);

  try {
    const res = await fetch('/api/resume_dubbing_render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: state.currentJobId, skip_failed: true }),
    });
    if (!res.ok) {
      const errText = await res.text();
      let errMsg = 'Không thể tiếp tục render';
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.detail || errMsg;
      } catch (e) {
        errMsg = errText || errMsg;
      }
      throw new Error(errMsg);
    }
    const data = await res.json();
    appendLog('[HỆ THỐNG] Đã kích hoạt thành công giai đoạn Render Video.');
  } catch (err) {
    appendLog(`[LỖI] ${err.message}`);
    el.statusMsg.textContent = `Lỗi render: ${err.message}`;
    if (el.btnSkipFailedAndRender) {
      el.btnSkipFailedAndRender.disabled = false;
      el.btnSkipFailedAndRender.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
        Bỏ qua & Tiếp tục Render Video
      `;
    }
  }
}

// --- Convert Final Timeline to Subtitles List with Synchronized Timecodes ---
function updateSubtitlesFromTimeline(timeline) {
  const newSubs = [];
  let idx = 1;

  timeline.forEach((seg) => {
    if (seg.seg_type === 'dub') {
      const borrowed = seg.borrowed_gap_sec || 0.0;
      const startT = seg.start_sec;
      const endT = seg.start_sec + seg.duration_sec + borrowed;
      const segDur = seg.duration_sec + borrowed;

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
        video_speed_applied: 1.0,
        borrowed_gap_sec: borrowed,
        speed_warning_level: seg.speed_warning_level || 'normal',
        sync_desc: seg.sync_desc,
      });
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
  } catch (e) { }
  if (!savedJobId) return;

  fetch(`/api/job_status/${savedJobId}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((job) => {
      if (!job) {
        try { localStorage.removeItem('active_dubbing_job_id'); } catch (e) { }
        return;
      }
      state.currentJobId = savedJobId;

      if (job.status === 'running' || job.status === 'started' || job.status === 'needs_review') {
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
        handleJobUpdate(job);
      } else if (job.status === 'completed') {
        handleJobUpdate(job);
      }
    })
    .catch(() => { });
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

// --- STT (Speech-to-Text) Auto Subtitle Module ---
let sttSelectedFile = null;
let currentSttResult = null;
let sttPollingTimer = null;

function setupSttEventListeners() {
  if (!el.btnOpenSttModal) return;

  // 1. Open / Close STT Modal
  el.btnOpenSttModal.addEventListener('click', () => {
    resetSttModal();
    el.sttModalBackdrop.style.display = 'flex';
  });

  const closeSttModal = () => {
    if (sttPollingTimer) clearInterval(sttPollingTimer);
    el.sttModalBackdrop.style.display = 'none';
  };

  if (el.btnSttModalCloseX) el.btnSttModalCloseX.addEventListener('click', closeSttModal);
  if (el.btnSttModalCancel) el.btnSttModalCancel.addEventListener('click', closeSttModal);

  // 2. File Dropzone
  if (el.sttDropzone && el.sttFileInput) {
    el.sttDropzone.addEventListener('click', (e) => {
      if (e.target !== el.sttFileInput) el.sttFileInput.click();
    });

    el.sttDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.sttDropzone.classList.add('dragover');
    });

    el.sttDropzone.addEventListener('dragleave', () => {
      el.sttDropzone.classList.remove('dragover');
    });

    el.sttDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.sttDropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleSttFileSelected(e.dataTransfer.files[0]);
      }
    });

    el.sttFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleSttFileSelected(e.target.files[0]);
      }
    });
  }

  // 3. Start STT
  if (el.btnSttStartAction) {
    el.btnSttStartAction.addEventListener('click', () => {
      startSttTranscription();
    });
  }

  // 4. Apply STT Result to Project
  if (el.btnSttApplyToProject) {
    el.btnSttApplyToProject.addEventListener('click', () => {
      applySttResultToProject();
    });
  }
}

function handleSttFileSelected(file) {
  sttSelectedFile = file;
  if (el.sttFileName) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    el.sttFileName.textContent = `✓ Đã chọn: ${file.name} (${sizeMb} MB)`;
    el.sttFileName.style.display = 'block';
  }
  if (el.sttDropzoneText) {
    el.sttDropzoneText.textContent = 'Click hoặc kéo thả để đổi file khác';
  }
}

function resetSttModal() {
  sttSelectedFile = null;
  currentSttResult = null;
  if (sttPollingTimer) clearInterval(sttPollingTimer);

  if (el.sttFileInput) el.sttFileInput.value = '';
  if (el.sttFileName) {
    el.sttFileName.textContent = '';
    el.sttFileName.style.display = 'none';
  }
  if (el.sttDropzoneText) {
    el.sttDropzoneText.textContent = 'Kéo thả hoặc click để chọn File cần bóc phụ đề';
  }
  if (el.sttProgressContainer) el.sttProgressContainer.style.display = 'none';
  if (el.sttProgressBar) el.sttProgressBar.style.width = '0%';
  if (el.sttProgressPercent) el.sttProgressPercent.textContent = '0%';
  if (el.sttResultBox) el.sttResultBox.style.display = 'none';
  if (el.btnSttStartAction) {
    el.btnSttStartAction.disabled = false;
    el.btnSttStartAction.style.display = 'inline-flex';
  }
  if (el.btnSttApplyToProject) el.btnSttApplyToProject.style.display = 'none';
}

async function startSttTranscription() {
  if (!sttSelectedFile) {
    alert('Vui lòng chọn file Video hoặc Âm thanh cần nhận dạng.');
    return;
  }

  const lang = el.sttLangSelect ? el.sttLangSelect.value : 'vi-VN';
  const concurrency = el.sttConcurrencySelect ? parseInt(el.sttConcurrencySelect.value, 10) || 3 : 3;
  const useTrans = el.sttUseTranslation ? el.sttUseTranslation.checked : false;

  el.btnSttStartAction.disabled = true;
  el.sttProgressContainer.style.display = 'block';
  el.sttProgressMessage.textContent = 'Đang tải file lên máy chủ...';
  el.sttProgressPercent.textContent = '5%';
  el.sttProgressBar.style.width = '5%';
  el.sttResultBox.style.display = 'none';

  try {
    const formData = new FormData();
    formData.append('file', sttSelectedFile);
    formData.append('language', lang);
    formData.append('concurrency', String(concurrency));
    formData.append('use_translation', useTrans ? 'true' : 'false');
    formData.append('translation_language', 'vi-VN');
    if (state.currentSessionId) {
      formData.append('session_id', state.currentSessionId);
    }

    const res = await fetch('/api/stt/start', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Lỗi khởi động STT (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const taskId = data.task_id;

    // Poll STT status
    sttPollingTimer = setInterval(async () => {
      try {
        const sRes = await fetch(`/api/stt/status/${taskId}`);
        if (!sRes.ok) return;

        const task = await sRes.json();
        const pct = Math.round(task.percent || 0);

        el.sttProgressPercent.textContent = `${pct}%`;
        el.sttProgressBar.style.width = `${pct}%`;
        el.sttProgressMessage.textContent = task.message || 'Đang xử lý...';

        if (task.status === 'completed') {
          clearInterval(sttPollingTimer);
          currentSttResult = task.result;

          el.sttProgressMessage.textContent = 'Bóc phụ đề hoàn tất!';
          el.sttProgressPercent.textContent = '100%';
          el.sttProgressBar.style.width = '100%';

          if (el.sttResultBox) {
            el.sttResultBox.style.display = 'block';
            if (el.sttResultSummary) {
              el.sttResultSummary.textContent = `✓ Đã bóc thành công ${task.result.total_sentences} câu phụ đề chuẩn xác!`;
            }
          }

          if (el.btnSttApplyToProject) {
            el.btnSttApplyToProject.style.display = 'inline-flex';
          }
          if (el.btnSttStartAction) {
            el.btnSttStartAction.style.display = 'none';
          }

        } else if (task.status === 'failed') {
          clearInterval(sttPollingTimer);
          el.sttProgressMessage.textContent = `Lỗi: ${task.error || task.message}`;
          el.btnSttStartAction.disabled = false;
        }
      } catch (pollErr) {
        console.warn('STT poll error:', pollErr);
      }
    }, 1500);

  } catch (err) {
    el.sttProgressMessage.textContent = `Lỗi: ${err.message}`;
    el.btnSttStartAction.disabled = false;
    alert(`Không thể bắt đầu STT: ${err.message}`);
  }
}

function applySttResultToProject() {
  if (!currentSttResult) {
    alert('Không tìm thấy kết quả nhận dạng STT để áp dụng.');
    return;
  }

  try {
    // 1. Update Subtitles List
    if (Array.isArray(currentSttResult.subtitles) && currentSttResult.subtitles.length > 0) {
      state.subtitles = currentSttResult.subtitles.map((s, idx) => {
        const start = typeof s.start_sec === 'number' ? s.start_sec : (parseFloat(s.start_sec) || 0);
        const end = typeof s.end_sec === 'number' ? s.end_sec : (parseFloat(s.end_sec) || start);
        const dur = typeof s.duration_sec === 'number' ? s.duration_sec : (parseFloat(s.duration_sec) || Math.max(0.1, end - start));
        return {
          index: s.index ?? s.id ?? (idx + 1),
          id: s.id ?? (idx + 1),
          start_sec: start,
          end_sec: end,
          duration_sec: dur,
          text_dub: s.text_dub || '',
          text_orig: s.text_orig || '',
          ratio: s.ratio || 1.0,
          has_cache: s.has_cache || false,
        };
      });
      renderSubtitleList(state.subtitles);
      checkSubtitlesCache();
    }

    // 2. Update Dub SRT Info
    state.srtDubPath = currentSttResult.srt_path;
    state.currentJobId = currentSttResult.project_id || currentSttResult.session_id || state.currentJobId;
    try { localStorage.setItem('active_dubbing_job_id', state.currentJobId); } catch (e) { }

    if (el.srtDubFileName) {
      el.srtDubFileName.textContent = `✓ ${currentSttResult.srt_filename || 'auto_stt.srt'}`;
      el.srtDubFileName.style.display = 'block';
    }

    // 3. Update Video if applicable
    if (currentSttResult.video_path) {
      state.videoPath = currentSttResult.video_path;
      state.videoUrl = currentSttResult.video_url;
      if (el.videoFileName) {
        const displayName = sttSelectedFile ? sttSelectedFile.name : currentSttResult.video_path.split(/[\\/]/).pop();
        el.videoFileName.textContent = `✓ ${displayName}`;
        el.videoFileName.style.display = 'block';
      }
      if (currentSttResult.video_url) {
        loadVideoIntoPlayer(currentSttResult.video_url);
      }
    }

    if (currentSttResult.duration_sec) {
      state.totalDuration = currentSttResult.duration_sec;
      if (el.totalTimeText) el.totalTimeText.textContent = fmtTime(state.totalDuration);
      updatePlayerUI();
    }

    // 4. Close Modal & Toast
    if (el.sttModalBackdrop) {
      el.sttModalBackdrop.classList.remove('show');
      el.sttModalBackdrop.style.display = 'none';
    }
    if (sttPollingTimer) clearInterval(sttPollingTimer);

    appendLog(`[STT] Đã nạp thành công ${currentSttResult.total_sentences} câu phụ đề vào Dự án.`);
    alert(`Đã áp dụng thành công ${currentSttResult.total_sentences} câu phụ đề vào dự án!\nBạn có thể chỉnh sửa câu từ hoặc bấm "Bắt đầu Lồng tiếng & Render" ngay.`);
  } catch (err) {
    console.error('Error applying STT result:', err);
    alert(`Lỗi khi áp dụng phụ đề vào dự án: ${err.message}`);
  }
}

