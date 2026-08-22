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
  minRatioInput: document.getElementById('minRatioInput'),
  maxRatioInput: document.getElementById('maxRatioInput'),
  origVolInput: document.getElementById('origVolInput'),
  dubVolInput: document.getElementById('dubVolInput'),
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
});

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

  el.threadsSlider.addEventListener('input', () => {
    el.threadsValue.textContent = `${el.threadsSlider.value} luồng`;
  });

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

    const ratio = item.ratio || 1.0;
    const rClass = getRatioClass(ratio);

    div.innerHTML = `
      <div class="srt-idx">${String(item.index).padStart(2, '0')}</div>
      <div class="srt-body">
        <div class="srt-time">
          <span>${fmtTime(item.start_sec)} → ${fmtTime(item.end_sec)} (${item.duration_sec.toFixed(1)}s)</span>
          <span class="ratio ${rClass}" id="ratio-badge-${item.index}">${ratio ? ratio.toFixed(2) + 'x' : '--'}</span>
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

function getRatioClass(r) {
  if (!r) return 'ok';
  if (r >= 0.90 && r <= 1.15) return 'ok';
  if (r >= 0.75 && r <= 1.30) return 'warn';
  return 'bad';
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

  const payload = {
    video_path: state.videoPath,
    srt_dub_path: state.srtDubPath,
    srt_orig_path: state.srtOrigPath,
    voice: el.voiceSelect.value,
    voice_rate: el.voiceRateSelect.value,
    min_ratio: parseFloat(el.minRatioInput.value) || 0.90,
    max_ratio: parseFloat(el.maxRatioInput.value) || 1.15,
    orig_volume: parseFloat(el.origVolInput.value) || 0.15,
    dub_volume: parseFloat(el.dubVolInput.value) || 1.20,
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

      // Live update ratio badge in table
      if (msg.data && msg.data.seg_id && msg.data.ratio) {
        const badge = document.getElementById(`ratio-badge-${msg.data.seg_id}`);
        if (badge) {
          badge.textContent = `${msg.data.ratio.toFixed(2)}x`;
          badge.className = `ratio ${getRatioClass(msg.data.ratio)}`;
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
