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
  btnRetryAllFailed: document.getElementById('btnRetryAllFailed'),
  btnSkipFailedAndRender: document.getElementById('btnSkipFailedAndRender'),

  // Live Render HUD
  renderStatsHud: document.getElementById('renderStatsHud'),
  hudFrames: document.getElementById('hudFrames'),
  hudFps: document.getElementById('hudFps'),
  hudTime: document.getElementById('hudTime'),
  hudSlices: document.getElementById('hudSlices'),

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
  updateOrigVolUI();
  updateDubVolUI();
  updateSpeedLimitsUI();
  updateCacheStatsBadge();
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
  } catch (e) {}
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
  } catch (e) {}
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
    try { localStorage.setItem('active_dubbing_job_id', state.currentJobId); } catch (e) {}

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
      checkSubtitlesCache();
    }
    updateCacheStatsBadge();
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
    const cacheTagHtml = item.has_cache 
      ? `<span class="sub-cache-tag cached" title="Đã có âm thanh trong Cache (Tải 0s)">⚡ Sẵn sàng</span>` 
      : `<span class="sub-cache-tag missing" title="Chưa tạo âm thanh">⏳ Chưa tạo</span>`;

    div.innerHTML = `
      <div class="srt-idx">${String(item.index).padStart(2, '0')}</div>
      <div class="srt-body">
        <div class="srt-time">
          <span>${fmtTime(item.start_sec)} → ${fmtTime(item.end_sec)} (${item.duration_sec.toFixed(1)}s)</span>
          ${cacheTagHtml}
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
    } catch (e) {}
  }, 1500);
}

let lastLoggedMessage = '';

function handleJobUpdate(msg) {
  if (!msg) return;

  if (msg.percent !== undefined) {
    el.progressBarFill.style.width = `${msg.percent}%`;
    if (el.floatingJobPct) el.floatingJobPct.textContent = `${Math.round(msg.percent)}%`;
  }
  if (msg.message) {
    el.statusMsg.textContent = msg.message;
    if (el.floatingJobTitle) el.floatingJobTitle.textContent = msg.message;
    if ((msg.stage || msg.status) && msg.message !== lastLoggedMessage) {
      lastLoggedMessage = msg.message;
      appendLog(`[${(msg.stage || msg.status || 'INFO').toUpperCase()}] ${msg.message}`);
    }
  }

  // Live update HUD in Video Render Stage
  if (msg.stage === 'video_render' && msg.data) {
    if (el.renderStatsHud) el.renderStatsHud.style.display = 'flex';
    if (el.hudFrames && msg.data.frame) {
      el.hudFrames.textContent = parseInt(msg.data.frame, 10).toLocaleString();
    }
    if (el.hudFps && msg.data.fps) {
      el.hudFps.textContent = `${msg.data.fps} fps`;
    }
    if (el.hudTime && msg.data.cur_sec !== undefined && msg.data.total_sec !== undefined) {
      el.hudTime.textContent = `${fmtTime(msg.data.cur_sec)} / ${fmtTime(msg.data.total_sec)}`;
    }
    if (el.hudSlices && msg.data.total_slices) {
      el.hudSlices.textContent = `${msg.data.total_slices.toLocaleString()} dải`;
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
      <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
        <div class="failed-item-idx">#${String(seg.seg_id).padStart(2, '0')}</div>
        <input type="text" class="failed-item-input" id="failed-input-${seg.seg_id}" value="${escapeHtml(seg.text_dub)}" placeholder="Nhập câu tiếng Việt thay thế..." />
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
    const inputEl = itemDiv.querySelector(`#failed-input-${seg.seg_id}`);
    const errContainer = itemDiv.querySelector(`#failed-err-${seg.seg_id}`);

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
  if (!currentSttResult) return;

  // 1. Update Subtitles List
  if (Array.isArray(currentSttResult.subtitles) && currentSttResult.subtitles.length > 0) {
    state.subtitles = currentSttResult.subtitles;
    renderSubtitleList(state.subtitles);
  }

  // 2. Update Dub SRT Info
  state.srtDubPath = currentSttResult.srt_path;
  state.currentSessionId = currentSttResult.session_id || state.currentSessionId;

  if (el.srtDubFileName) {
    el.srtDubFileName.textContent = `✓ ${currentSttResult.srt_filename || 'auto_stt.srt'}`;
    el.srtDubFileName.style.display = 'block';
  }

  // 3. Update Video if applicable
  if (currentSttResult.is_video && currentSttResult.video_url) {
    state.videoPath = currentSttResult.video_path;
    if (el.videoFileName) {
      el.videoFileName.textContent = `✓ ${sttSelectedFile ? sttSelectedFile.name : 'video'}`;
      el.videoFileName.style.display = 'block';
    }
    if (el.mainVideo) {
      el.mainVideo.src = currentSttResult.video_url;
      el.mainVideo.style.display = 'block';
      if (el.videoPlaceholder) el.videoPlaceholder.style.display = 'none';
    }
  }

  // 4. Close Modal & Toast
  el.sttModalBackdrop.style.display = 'none';
  if (sttPollingTimer) clearInterval(sttPollingTimer);

  appendLog(`[STT] Đã nạp thành công ${currentSttResult.total_sentences} câu phụ đề vào Dự án.`);
  alert(`Đã áp dụng thành công ${currentSttResult.total_sentences} câu phụ đề vào dự án! Bạn có thể chỉnh sửa câu từ hoặc bấm "Bắt đầu tạo giọng đọc & Render" ngay.`);
}

