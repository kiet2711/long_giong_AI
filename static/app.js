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
  minAudioSpeedSlider: document.getElementById('minAudioSpeedSlider'),
  minAudioSpeedBadge: document.getElementById('minAudioSpeedBadge'),
  maxAudioSpeedSlider: document.getElementById('maxAudioSpeedSlider'),
  maxAudioSpeedBadge: document.getElementById('maxAudioSpeedBadge'),
  minVideoSpeedSlider: document.getElementById('minVideoSpeedSlider'),
  minVideoSpeedBadge: document.getElementById('minVideoSpeedBadge'),
  maxVideoSpeedSlider: document.getElementById('maxVideoSpeedSlider'),
  maxVideoSpeedBadge: document.getElementById('maxVideoSpeedBadge'),
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
});

function updateSpeedLimitsUI() {
  if (el.minAudioSpeedSlider && el.minAudioSpeedBadge) {
    const minASpeed = parseFloat(el.minAudioSpeedSlider.value) || 0.80;
    const pct = Math.round((1.0 - minASpeed) * 100);
    el.minAudioSpeedBadge.textContent = `${minASpeed.toFixed(2)}x (${pct === 0 ? 'Không giảm' : `-${pct}%`})`;
  }
  if (el.maxAudioSpeedSlider && el.maxAudioSpeedBadge) {
    const aSpeed = parseFloat(el.maxAudioSpeedSlider.value) || 1.20;
    const pct = Math.round((aSpeed - 1.0) * 100);
    el.maxAudioSpeedBadge.textContent = `${aSpeed.toFixed(2)}x (${pct === 0 ? 'Không tăng' : `+${pct}%`})`;
  }
  if (el.minVideoSpeedSlider && el.minVideoSpeedBadge) {
    const vSpeed = parseFloat(el.minVideoSpeedSlider.value) || 0.50;
    const pct = Math.round((1.0 - vSpeed) * 100);
    el.minVideoSpeedBadge.textContent = `${vSpeed.toFixed(2)}x (${pct === 0 ? 'Không chậm' : `Chậm tối đa ${pct}%`})`;
  }
  if (el.maxVideoSpeedSlider && el.maxVideoSpeedBadge) {
    const maxVSpeed = parseFloat(el.maxVideoSpeedSlider.value) || 1.50;
    const pct = Math.round((maxVSpeed - 1.0) * 100);
    el.maxVideoSpeedBadge.textContent = `${maxVSpeed.toFixed(2)}x (${pct === 0 ? 'Không tăng' : `+${pct}%`})`;
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
  if (el.minAudioSpeedSlider) {
    el.minAudioSpeedSlider.addEventListener('input', () => {
      updateSpeedLimitsUI();
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    });
  }

  if (el.maxAudioSpeedSlider) {
    el.maxAudioSpeedSlider.addEventListener('input', () => {
      updateSpeedLimitsUI();
      if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
    });
  }

  if (el.minVideoSpeedSlider) {
    el.minVideoSpeedSlider.addEventListener('input', () => {
      updateSpeedLimitsUI();
    });
  }

  if (el.maxVideoSpeedSlider) {
    el.maxVideoSpeedSlider.addEventListener('input', () => {
      updateSpeedLimitsUI();
    });
  }

  // Quick preset buttons
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const val = btn.dataset.val;
      if (target === 'orig' && el.origVolSlider) {
        el.origVolSlider.value = val;
        updateOrigVolUI();
      } else if (target === 'dub' && el.dubVolSlider) {
        el.dubVolSlider.value = val;
        updateDubVolUI();
      } else if (target === 'min_audiospeed' && el.minAudioSpeedSlider) {
        el.minAudioSpeedSlider.value = val;
        updateSpeedLimitsUI();
        if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
      } else if (target === 'max_audiospeed' && el.maxAudioSpeedSlider) {
        el.maxAudioSpeedSlider.value = val;
        updateSpeedLimitsUI();
        if (state.subtitles.length > 0) renderSubtitleList(state.subtitles);
      } else if (target === 'min_videospeed' && el.minVideoSpeedSlider) {
        el.minVideoSpeedSlider.value = val;
        updateSpeedLimitsUI();
      } else if (target === 'max_videospeed' && el.maxVideoSpeedSlider) {
        el.maxVideoSpeedSlider.value = val;
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
  el.btnModalClose.addEventListener('click', () => {
    el.modalBackdrop.classList.remove('show');
  });
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

  try {
    const res = await fetch('/api/start_dubbing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Không thể bắt đầu job');

    state.currentJobId = data.job_id;
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
      }
      if (msg.message) {
        el.statusMsg.textContent = msg.message;
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

      // Completed
      if (msg.stage === 'completed') {
        el.modalTitle.textContent = '🎉 Hoàn tất Lồng tiếng & Render!';
        el.progressBarFill.style.width = '100%';
        el.btnStartDubbing.disabled = false;
        
        if (msg.output_url) {
          el.btnDownloadResult.style.display = 'inline-flex';
          el.btnDownloadResult.onclick = () => {
            window.open(msg.output_url, '_blank');
          };
          // Automatically load final dubbed video into player
          loadVideoIntoPlayer(msg.output_url);
        }
      } else if (msg.stage === 'failed') {
        el.modalTitle.textContent = '❌ Quá trình Render gặp lỗi';
        el.btnStartDubbing.disabled = false;
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };

  ws.onerror = (e) => {
    console.error('WS Error:', e);
  };
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
