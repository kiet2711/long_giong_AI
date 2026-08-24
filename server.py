"""
FastAPI Server for AI Dubbing & Video Sync Tool.
Provides REST APIs for file uploads, voice catalog, TTS preview,
and WebSocket for real-time FFmpeg render progress streaming.
"""

import asyncio
import json
import os
import shutil
import subprocess
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core.capcut_stt import ChunkedSTTPipeline
from core.ffmpeg_engine import FFmpegDubbingEngine, get_video_metadata
from core.gemini_client import AVAILABLE_GEMINI_MODELS, GeminiClient, GeminiKeyPool
from core.project_manager import ProjectManager
from core.srt_parser import SRTParser, SubtitleItem, TimelineSegment
from core.tts_client import CapCutTTSClient, VoiceCatalog

BASE_DIR = Path(__file__).parent.resolve()
TEMP_DIR = BASE_DIR / "temp"
UPLOADS_DIR = TEMP_DIR / "uploads"
OUTPUTS_DIR = TEMP_DIR / "outputs"
PROJECTS_DIR = TEMP_DIR / "projects"
TTS_CACHE_DIR = TEMP_DIR / "tts_cache"
STATIC_DIR = BASE_DIR / "static"

TEMP_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)
PROJECTS_DIR.mkdir(exist_ok=True)
TTS_CACHE_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

tts_client = CapCutTTSClient(cache_dir=TTS_CACHE_DIR)
voice_catalog = VoiceCatalog()
project_manager = ProjectManager(base_dir=BASE_DIR, tts_client=tts_client)
stt_pipeline = ChunkedSTTPipeline(temp_dir=TEMP_DIR / "stt_pipeline", max_workers=3)
stt_tasks: Dict[str, Dict[str, Any]] = {}

gemini_key_pool = GeminiKeyPool()
gemini_client = GeminiClient(gemini_key_pool, default_model="gemini-2.5-flash-lite")


app = FastAPI(title="AI Dubbing & Video Sync Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/temp", StaticFiles(directory=str(TEMP_DIR)), name="temp")

# Active Job Manager
jobs_state: Dict[str, Dict[str, Any]] = {}
active_connections: Dict[str, List[WebSocket]] = {}
job_locks = threading.Lock()
MAIN_EVENT_LOOP: Optional[asyncio.AbstractEventLoop] = None


@app.on_event("startup")
async def on_startup():
    global MAIN_EVENT_LOOP
    try:
        MAIN_EVENT_LOOP = asyncio.get_running_loop()
    except Exception:
        pass

    # Auto open browser
    if os.environ.get("AUTO_OPEN", "true").lower() != "false":
        threading.Timer(1.2, lambda: webbrowser.open("http://127.0.0.1:8000")).start()


def get_job_public_state(raw_job: Dict[str, Any]) -> Dict[str, Any]:
    """Extract strictly JSON-serializable status fields for API & WebSocket clients."""
    return {
        "job_id": raw_job.get("job_id"),
        "status": raw_job.get("status"),
        "percent": raw_job.get("percent", 0.0),
        "stage": raw_job.get("stage"),
        "message": raw_job.get("message"),
        "output_path": raw_job.get("output_path"),
        "output_url": raw_job.get("output_url"),
        "output_srt_url": raw_job.get("output_srt_url"),
        "error": raw_job.get("error"),
        "data": raw_job.get("data", {}),
        "failed_segments": raw_job.get("failed_segments", []),
        "result": raw_job.get("result"),
    }


class ConnectionManager:
    @staticmethod
    async def connect(job_id: str, websocket: WebSocket):
        await websocket.accept()
        if job_id not in active_connections:
            active_connections[job_id] = []
        active_connections[job_id].append(websocket)

    @staticmethod
    def disconnect(job_id: str, websocket: WebSocket):
        if job_id in active_connections and websocket in active_connections[job_id]:
            active_connections[job_id].remove(websocket)

    @staticmethod
    async def broadcast(job_id: str, message: Dict[str, Any]):
        if job_id in active_connections:
            dead_sockets = []
            for ws in list(active_connections[job_id]):
                try:
                    await ws.send_json(message)
                except Exception:
                    dead_sockets.append(ws)
            for ws in dead_sockets:
                if ws in active_connections[job_id]:
                    active_connections[job_id].remove(ws)


manager = ConnectionManager()


def broadcast_sync(job_id: str, message: Dict[str, Any]):
    """Thread-safe WebSocket broadcaster called from background worker threads."""
    if MAIN_EVENT_LOOP and MAIN_EVENT_LOOP.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(job_id, message), MAIN_EVENT_LOOP)
    else:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(manager.broadcast(job_id, message))
        except RuntimeError:
            pass


@app.get("/")
async def get_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse({"status": "ok", "message": "Dubbing server running"})


@app.get("/api/voices")
async def list_voices(lang: Optional[str] = None):
    """List available TTS voices with Vietnamese voices prioritized."""
    all_voices = voice_catalog.get_all()
    # Sort Vietnamese voices first
    vn_voices = [v for v in all_voices if v.get("lang", "").lower() == "vi-vn"]
    other_voices = [v for v in all_voices if v.get("lang", "").lower() != "vi-vn"]
    return {
        "voices": vn_voices + other_voices,
        "total": len(all_voices),
    }


class PreviewTTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "BV421_vivn_streaming"
    rate: Optional[str] = "1.0"


@app.post("/api/preview_tts")
async def preview_tts(req: PreviewTTSRequest):
    """Generate audio snippet for voice preview."""
    try:
        preview_filename = f"preview_{uuid.uuid4().hex[:8]}.mp3"
        preview_path = TEMP_DIR / preview_filename
        tts_client.generate_speech_to_file(
            text=req.text,
            output_file=preview_path,
            voice=req.voice,
            rate=req.rate,
        )
        return {
            "status": "success",
            "audio_url": f"/temp/{preview_filename}",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects")
async def get_projects():
    """List saved projects with cache completion percentage."""
    return {
        "projects": project_manager.list_projects(),
        "cache_stats": tts_client.get_cache_stats(),
    }


class LoadProjectRequest(BaseModel):
    project_id: str


@app.post("/api/projects/load")
async def load_project(req: LoadProjectRequest):
    """Load a specific project and return full metadata and subtitle cache indicators."""
    project_data = project_manager.load_project(req.project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_data


class DeleteProjectRequest(BaseModel):
    project_id: str


@app.post("/api/projects/delete")
async def delete_project(req: DeleteProjectRequest):
    """Delete a saved project."""
    success = project_manager.delete_project(req.project_id)
    return {"success": success, "project_id": req.project_id}


class CheckCacheRequest(BaseModel):
    subtitles: List[Dict[str, Any]]
    voice: Optional[str] = "BV421_vivn_streaming"
    voice_rate: Optional[str] = "1.0"


@app.post("/api/check_cache")
async def check_cache(req: CheckCacheRequest):
    """Check how many subtitles are already cached in persistent TTS cache."""
    return project_manager.check_subtitles_cache(
        subtitles=req.subtitles,
        voice=req.voice or "BV421_vivn_streaming",
        voice_rate=req.voice_rate or "1.0",
    )


@app.get("/api/cache_stats")
async def get_cache_stats():
    """Get persistent TTS cache statistics."""
    return tts_client.get_cache_stats()


# =========================================================================
# Gemini AI API Endpoints (Standardized Key Pool & Multi-Model Execution)
# =========================================================================

@app.get("/api/gemini/models")
async def get_gemini_models():
    """Get list of supported Gemini AI models and active key pool statistics."""
    return {
        "models": AVAILABLE_GEMINI_MODELS,
        "active_keys_count": gemini_key_pool.total_keys,
        "keys_info": gemini_key_pool.get_keys_info(),
        "default_model": gemini_client.default_model,
    }


class GeminiTestRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = "gemini-2.5-flash-lite"


@app.post("/api/gemini/test")
async def test_gemini_connection(req: GeminiTestRequest):
    """Test connection to Gemini API and measure response latency."""
    return gemini_client.test_connection(api_key=req.api_key, model=req.model)


class GeminiGenerateRequest(BaseModel):
    prompt: str
    system_instruction: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = 0.7
    max_output_tokens: Optional[int] = 4096
    json_mode: Optional[bool] = False
    api_keys: Optional[Union[List[str], str]] = None


@app.post("/api/gemini/generate")
async def generate_gemini_content(req: GeminiGenerateRequest):
    """Generic Gemini content generation endpoint."""
    if req.api_keys:
        local_pool = GeminiKeyPool(req.api_keys)
        client = GeminiClient(local_pool, default_model=req.model or "gemini-2.5-flash-lite")
    else:
        client = gemini_client

    try:
        result = client.generate_content(
            prompt=req.prompt,
            system_instruction=req.system_instruction,
            model=req.model,
            temperature=req.temperature if req.temperature is not None else 0.7,
            max_output_tokens=req.max_output_tokens or 4096,
            json_mode=req.json_mode or False,
        )
        return {"success": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class GeminiFixFailedRequest(BaseModel):
    segments: List[Dict[str, Any]]
    model: Optional[str] = "gemini-2.5-flash-lite"
    api_keys: Optional[Union[List[str], str]] = None
    concurrency: Optional[int] = 5


@app.post("/api/gemini/fix_failed_subtitles")
async def fix_failed_subtitles(req: GeminiFixFailedRequest):
    """Translate and fix failed/sensitive subtitle segments using Gemini AI."""
    if req.api_keys:
        local_pool = GeminiKeyPool(req.api_keys)
        client = GeminiClient(local_pool, default_model=req.model or "gemini-2.5-flash-lite")
    else:
        client = gemini_client

    concurrency = max(1, min(req.concurrency or 5, client.key_pool.total_keys if client.key_pool.total_keys > 0 else 5))
    try:
        fixed_results = client.fix_and_translate_failed_segments(
            items=req.segments,
            model=req.model,
            concurrency=concurrency,
        )
        return {"success": True, "results": fixed_results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




@app.post("/api/upload_files")
async def upload_files(
    video: Optional[UploadFile] = File(None),
    srt_dub: Optional[UploadFile] = File(None),
    srt_orig: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
):
    """Upload video and subtitle files and automatically index/detect cache."""
    effective_session = session_id or uuid.uuid4().hex[:8]
    session_dir = UPLOADS_DIR / effective_session
    session_dir.mkdir(parents=True, exist_ok=True)

    video_path = None
    srt_dub_path = None
    srt_orig_path = None
    video_meta = None

    if video and video.filename:
        v_dest = session_dir / video.filename
        with open(v_dest, "wb") as f:
            shutil.copyfileobj(video.file, f)
        video_path = str(v_dest)
        try:
            meta = get_video_metadata(v_dest)
            video_meta = {
                "duration": meta.duration,
                "width": meta.width,
                "height": meta.height,
                "fps": meta.fps,
                "has_audio": meta.has_audio,
            }
        except Exception:
            pass

    if srt_dub and srt_dub.filename:
        s_dest = session_dir / srt_dub.filename
        with open(s_dest, "wb") as f:
            shutil.copyfileobj(srt_dub.file, f)
        srt_dub_path = str(s_dest)

    if srt_orig and srt_orig.filename:
        so_dest = session_dir / srt_orig.filename
        with open(so_dest, "wb") as f:
            shutil.copyfileobj(srt_orig.file, f)
        srt_orig_path = str(so_dest)

    subtitles = []
    if srt_dub_path:
        try:
            sub_items = SRTParser.parse_paired_srt(srt_dub_path, srt_orig_path)
            subtitles = [s.to_dict() for s in sub_items]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse SRT: {e}")

    # Create persistent project entry ONLY when valid subtitles exist or are uploaded
    if (subtitles and len(subtitles) > 0) or srt_dub_path:
        project_manager.create_or_update_project(
            project_id=effective_session,
            name=Path(video_path).stem if video_path else "Dự án mới",
            video_path=video_path,
            srt_dub_path=srt_dub_path,
            srt_orig_path=srt_orig_path,
            video_meta=video_meta,
            subtitles=subtitles,
            status="ready",
        )

    # Check cache status for subtitles
    cache_info = project_manager.check_subtitles_cache(subtitles, "BV421_vivn_streaming", "1.0")

    return {
        "session_id": effective_session,
        "project_id": effective_session,
        "video_path": video_path,
        "video_url": f"/temp/uploads/{effective_session}/{Path(video_path).name}" if video_path else None,
        "video_meta": video_meta,
        "srt_dub_path": srt_dub_path,
        "srt_orig_path": srt_orig_path,
        "subtitles": cache_info.get("subtitles", subtitles),
        "cache_info": {
            "cached_count": cache_info.get("cached_count", 0),
            "missing_count": cache_info.get("missing_count", len(subtitles)),
            "cached_percent": cache_info.get("cached_percent", 0.0),
        },
    }


@app.post("/api/stt/start")
async def start_stt(
    file: UploadFile = File(...),
    language: str = Form("vi-VN"),
    use_translation: bool = Form(False),
    translation_language: str = Form("vi-VN"),
    concurrency: int = Form(3),
    session_id: Optional[str] = Form(None),
):
    """
    Upload audio or video file and run multi-threaded chunked STT transcription in background.
    """
    task_id = uuid.uuid4().hex[:10]
    effective_session = session_id or uuid.uuid4().hex[:8]
    session_dir = UPLOADS_DIR / effective_session
    session_dir.mkdir(parents=True, exist_ok=True)

    dest_file = session_dir / file.filename
    with open(dest_file, "wb") as f:
        shutil.copyfileobj(file.file, f)

    task_obj = {
        "task_id": task_id,
        "session_id": effective_session,
        "filename": file.filename,
        "file_path": str(dest_file),
        "status": "processing",
        "percent": 5.0,
        "message": "Đang chuẩn bị file âm thanh/video...",
        "language": language,
        "concurrency": concurrency,
        "result": None,
        "error": None,
        "created_at": time.time(),
    }
    stt_tasks[task_id] = task_obj

    def _worker():
        try:
            def _on_prog(p):
                task_obj["percent"] = p.get("percent", 50.0)
                task_obj["message"] = p.get("message", "Đang xử lý...")

            res = stt_pipeline.transcribe_media_file(
                media_path=dest_file,
                language=language,
                translation_language=translation_language,
                use_translation=use_translation,
                chunk_duration_sec=600.0,
                max_workers=concurrency,
                progress_callback=_on_prog,
            )

            # Save generated SRT file
            srt_filename = f"{dest_file.stem}_auto_stt.srt"
            srt_path = session_dir / srt_filename
            srt_path.write_text(res["srt_content"], encoding="utf-8")

            # Extract video metadata if it's a video
            video_meta = None
            video_exts = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".ts", ".flv", ".wmv", ".m4v"}
            is_video = dest_file.suffix.lower() in video_exts
            try:
                meta = get_video_metadata(dest_file)
                if meta.width > 0:
                    is_video = True
                    video_meta = {
                        "duration": meta.duration,
                        "width": meta.width,
                        "height": meta.height,
                        "fps": meta.fps,
                        "has_audio": meta.has_audio,
                    }
            except Exception:
                pass

            # Update or create project
            project_manager.create_or_update_project(
                project_id=effective_session,
                name=dest_file.stem,
                video_path=str(dest_file) if is_video else None,
                srt_dub_path=str(srt_path),
                srt_orig_path=None,
                video_meta=video_meta,
                subtitles=res["subtitles"],
                status="ready",
            )

            task_obj["status"] = "completed"
            task_obj["percent"] = 100.0
            task_obj["message"] = f"Bóc phụ đề thành công! ({res['total_sentences']} câu)"
            task_obj["result"] = {
                "session_id": effective_session,
                "project_id": effective_session,
                "srt_path": str(srt_path),
                "srt_filename": srt_filename,
                "srt_content": res["srt_content"],
                "full_text": res["full_text"],
                "subtitles": res["subtitles"],
                "total_sentences": res["total_sentences"],
                "duration_sec": res["duration_sec"],
                "is_video": is_video,
                "video_path": str(dest_file) if is_video else None,
                "video_url": f"/temp/uploads/{effective_session}/{dest_file.name}" if is_video else None,
            }

        except Exception as err:
            logger.exception(f"STT worker error: {err}")
            task_obj["status"] = "failed"
            task_obj["error"] = str(err)
            task_obj["message"] = f"Lỗi nhận dạng: {err}"

    threading.Thread(target=_worker, daemon=True).start()

    return {
        "success": True,
        "task_id": task_id,
        "session_id": effective_session,
        "message": "Đã khởi động tác vụ nhận dạng STT đa luồng",
    }


@app.get("/api/stt/status/{task_id}")
async def get_stt_status(task_id: str):
    """Query progress and result of STT task."""
    task = stt_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="STT task not found")

    return {
        "task_id": task_id,
        "status": task["status"],
        "percent": task["percent"],
        "message": task["message"],
        "result": task.get("result"),
        "error": task.get("error"),
    }


class StartDubbingRequest(BaseModel):
    video_path: str
    srt_dub_path: str
    srt_orig_path: Optional[str] = None
    voice: Optional[str] = "BV421_vivn_streaming"
    voice_rate: Optional[str] = "1.0"
    min_audio_speed: Optional[float] = 0.80
    max_audio_speed: Optional[float] = 1.40
    max_gap_borrow: Optional[float] = 0.80
    safety_gap_buffer: Optional[float] = 0.15
    use_adaptive_prosody: Optional[bool] = True
    min_video_speed: Optional[float] = 1.0
    max_video_speed: Optional[float] = 1.0
    min_ratio: Optional[float] = None
    max_ratio: Optional[float] = None
    orig_volume: Optional[float] = 0.15
    dub_volume: Optional[float] = 1.20
    num_workers: Optional[int] = 50


@app.post("/api/start_dubbing")
async def start_dubbing(req: StartDubbingRequest):
    """Start full dubbing pipeline in a background worker."""
    if not os.path.exists(req.video_path):
        raise HTTPException(status_code=404, detail="Video file not found")
    if not os.path.exists(req.srt_dub_path):
        raise HTTPException(status_code=404, detail="Dubbed SRT file not found")

    job_id = uuid.uuid4().hex[:10]
    work_dir = TEMP_DIR / f"job_{job_id}"
    work_dir.mkdir(parents=True, exist_ok=True)

    # Group each video & SRT into its own dedicated project folder
    video_stem = Path(req.video_path).stem
    safe_stem = "".join(c for c in video_stem if c.isalnum() or c in ("-", "_", " ")).strip() or "video"
    time_tag = time.strftime("%Y%m%d_%H%M%S")
    folder_name = f"{safe_stem}_{time_tag}"
    job_output_dir = OUTPUTS_DIR / folder_name
    job_output_dir.mkdir(parents=True, exist_ok=True)

    out_video_path = job_output_dir / f"{safe_stem}_dubbed.mp4"

    sub_items = SRTParser.parse_paired_srt(req.srt_dub_path, req.srt_orig_path)

    with job_locks:
        jobs_state[job_id] = {
            "job_id": job_id,
            "status": "running",
            "percent": 0.0,
            "stage": "starting",
            "message": "Khởi tạo tiến trình lồng tiếng...",
            "output_path": None,
            "output_url": None,
            "error": None,
            "data": {},
        }

    # Worker thread
    def worker():
        try:
            engine = FFmpegDubbingEngine(
                tts_client=tts_client,
                min_audio_speed=req.min_audio_speed if req.min_audio_speed is not None else 0.80,
                max_audio_speed=req.max_audio_speed if req.max_audio_speed is not None else 1.40,
                max_gap_borrow=req.max_gap_borrow if req.max_gap_borrow is not None else 0.80,
                safety_gap_buffer=req.safety_gap_buffer if req.safety_gap_buffer is not None else 0.15,
                use_adaptive_prosody=req.use_adaptive_prosody if req.use_adaptive_prosody is not None else True,
                orig_volume=req.orig_volume if req.orig_volume is not None else 0.15,
                dub_volume=req.dub_volume if req.dub_volume is not None else 1.20,
                num_workers=req.num_workers if req.num_workers is not None else 50,
            )


            def on_progress(payload: Dict[str, Any]):
                with job_locks:
                    jobs_state[job_id]["percent"] = payload["percent"]
                    jobs_state[job_id]["stage"] = payload["stage"]
                    jobs_state[job_id]["message"] = payload["message"]
                    jobs_state[job_id]["data"] = payload.get("data", {})

                broadcast_sync(job_id, payload)

            result = engine.process_dubbing_pipeline(
                video_path=req.video_path,
                subtitles=sub_items,
                output_video_path=out_video_path,
                work_dir=work_dir,
                voice=req.voice or "BV421_vivn_streaming",
                voice_rate=req.voice_rate or "1.0",
                progress_cb=on_progress,
            )

            with job_locks:
                jobs_state[job_id]["engine"] = engine
                jobs_state[job_id]["req"] = req
                jobs_state[job_id]["work_dir"] = str(work_dir)
                jobs_state[job_id]["out_video_path"] = str(out_video_path)
                jobs_state[job_id]["timeline"] = result.get("timeline", [])

            # If failed TTS segments require user review, pause here
            if result.get("status") == "needs_review":
                with job_locks:
                    jobs_state[job_id]["status"] = "needs_review"
                    jobs_state[job_id]["stage"] = "tts_needs_review"
                    jobs_state[job_id]["failed_segments"] = result.get("failed_segments", [])
                return

            out_srt_path = out_video_path.with_suffix(".srt")
            srt_url = f"/temp/outputs/{folder_name}/{out_srt_path.name}" if out_srt_path.exists() else None
            video_url = f"/temp/outputs/{folder_name}/{out_video_path.name}"

            with job_locks:
                jobs_state[job_id]["status"] = "completed"
                jobs_state[job_id]["percent"] = 100.0
                jobs_state[job_id]["stage"] = "completed"
                jobs_state[job_id]["output_path"] = str(out_video_path)
                jobs_state[job_id]["output_url"] = video_url
                jobs_state[job_id]["output_srt_url"] = srt_url
                jobs_state[job_id]["result"] = result

            broadcast_sync(
                job_id,
                {
                    "percent": 100.0,
                    "stage": "completed",
                    "message": "Hoàn tất! Video & Phụ đề SRT đã sẵn sàng tải về.",
                    "output_url": video_url,
                    "output_srt_url": srt_url,
                    "result": result,
                },
            )

        except Exception as e:
            with job_locks:
                jobs_state[job_id]["status"] = "failed"
                jobs_state[job_id]["error"] = str(e)
                jobs_state[job_id]["message"] = f"Lỗi: {e}"

            broadcast_sync(
                job_id,
                {
                    "percent": jobs_state[job_id].get("percent", 0.0),
                    "stage": "failed",
                    "error": str(e),
                    "message": f"Lỗi trong quá trình xử lý: {e}",
                },
            )

    t = threading.Thread(target=worker, daemon=True)
    t.start()

    return {"job_id": job_id, "status": "started"}


class RetrySegmentsRequest(BaseModel):
    job_id: Optional[str] = None
    segments: List[Dict[str, Any]]
    voice: Optional[str] = "BV421_vivn_streaming"
    voice_rate: Optional[str] = "1.0"


class ResumeRenderRequest(BaseModel):
    job_id: str
    skip_failed: bool = True


@app.post("/api/retry_tts_segments")
async def retry_tts_segments(req: RetrySegmentsRequest):
    """Re-generate TTS for specific failed segments with 100% standalone reliability and permanent cache saving."""
    job_id = req.job_id or uuid.uuid4().hex[:10]
    work_dir = TEMP_DIR / f"job_{job_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    audio_dir = work_dir / "audios"
    audio_dir.mkdir(parents=True, exist_ok=True)

    with job_locks:
        if job_id not in jobs_state:
            jobs_state[job_id] = {
                "job_id": job_id,
                "status": "needs_review",
                "work_dir": str(work_dir),
                "timeline": [],
                "failed_segments": [],
            }
        job = jobs_state[job_id]
        engine: Optional[FFmpegDubbingEngine] = job.get("engine")
        if not engine:
            engine = FFmpegDubbingEngine(tts_client=tts_client)
            job["engine"] = engine
        timeline_list = job.get("timeline", [])

    voice = req.voice or "BV421_vivn_streaming"
    voice_rate = req.voice_rate or "1.0"
    is_vn_voice = voice.startswith(("BV421", "BV074", "vi_"))

    updated = []
    for item in req.segments:
        seg_id = item.get("seg_id", 1)
        final_text = str(item.get("text_dub", "")).strip()

        if not final_text:
            updated.append({
                "seg_id": seg_id,
                "is_failed": True,
                "tts_error": "Nội dung câu không được để trống!",
                "text_dub": final_text,
            })
            continue

        # Check for Chinese characters with Vietnamese voice
        has_chinese = any("\u4e00" <= char <= "\u9fff" for char in final_text)
        if is_vn_voice and has_chinese:
            updated.append({
                "seg_id": seg_id,
                "is_failed": True,
                "tts_error": "Câu này đang là chữ tiếng Trung, giọng tiếng Việt không đọc được. Vui lòng nhập bản dịch tiếng Việt vào ô trên!",
                "text_dub": final_text,
            })
            continue

        audio_file = audio_dir / f"audio_seg_{seg_id:04d}.mp3"
        try:
            # Remove old failed audio if present
            if audio_file.exists():
                try:
                    audio_file.unlink()
                except Exception:
                    pass

            # Generate speech directly
            tts_client.generate_speech_to_file(
                text=final_text,
                output_file=audio_file,
                voice=voice,
                rate=voice_rate,
            )

            from core.ffmpeg_engine import get_audio_duration
            aud_dur = get_audio_duration(audio_file)

            # Save into persistent cache
            tts_client.save_to_cache(
                text=final_text,
                audio_source=audio_file,
                voice=voice,
                rate=voice_rate,
            )

            # Update segment in timeline if present
            matching_seg = next((s for s in timeline_list if s.get("seg_id") == seg_id), None)
            if matching_seg:
                matching_seg["text_dub"] = final_text
                matching_seg["audio_path"] = str(audio_file)
                matching_seg["audio_duration_sec"] = round(aud_dur, 3)
                matching_seg["ratio"] = round(matching_seg.get("duration_sec", 5.0) / max(0.01, aud_dur), 2)
                matching_seg["tts_error"] = None
                matching_seg["is_failed"] = False
                res_dict = matching_seg
            else:
                res_dict = {
                    "seg_id": seg_id,
                    "text_dub": final_text,
                    "audio_path": str(audio_file),
                    "audio_duration_sec": round(aud_dur, 3),
                    "is_failed": False,
                    "tts_error": None,
                }

            updated.append(res_dict)

        except Exception as exc:
            updated.append({
                "seg_id": seg_id,
                "is_failed": True,
                "tts_error": str(exc),
                "text_dub": final_text,
            })

    with job_locks:
        jobs_state[job_id]["timeline"] = timeline_list
        jobs_state[job_id]["failed_segments"] = [
            s for s in timeline_list if s.get("seg_type") == "dub" and (s.get("is_failed") or not s.get("audio_path"))
        ]
        remaining = len(jobs_state[job_id]["failed_segments"])

    return {
        "status": "ok",
        "job_id": job_id,
        "updated_segments": updated,
        "remaining_failed": remaining,
    }


@app.post("/api/resume_dubbing_render")
async def resume_dubbing_render(req: ResumeRenderRequest):
    """Resume Step 3 (Audio Mix) and Step 4 (Video Render) after reviewing failed TTS."""
    with job_locks:
        if req.job_id not in jobs_state:
            # Try to restore from project_manager
            proj = project_manager.load_project(req.job_id)
            if proj:
                work_p = TEMP_DIR / f"job_{req.job_id}"
                work_p.mkdir(parents=True, exist_ok=True)
                out_v = OUTPUTS_DIR / f"dubbed_{req.job_id}.mp4"

                # Parse timeline if needed
                tl = []
                if proj.get("srt_dub_path") and Path(proj["srt_dub_path"]).exists():
                    sub_items = SRTParser.parse_srt_file(proj["srt_dub_path"])
                    tl_objs = SRTParser.build_timeline_segments(sub_items)
                    tl = [s.to_dict() for s in tl_objs]

                jobs_state[req.job_id] = {
                    "job_id": req.job_id,
                    "status": "needs_review",
                    "work_dir": str(work_p),
                    "out_video_path": str(out_v),
                    "timeline": tl,
                    "req": {
                        "video_path": proj.get("video_path"),
                        "voice": proj.get("voice", "BV421_vivn_streaming"),
                        "voice_rate": proj.get("voice_rate", "1.0"),
                    }
                }
            else:
                work_p = TEMP_DIR / f"job_{req.job_id}"
                if work_p.exists():
                    jobs_state[req.job_id] = {
                        "job_id": req.job_id,
                        "status": "needs_review",
                        "work_dir": str(work_p),
                        "out_video_path": str(OUTPUTS_DIR / f"dubbed_{req.job_id}.mp4"),
                        "timeline": [],
                    }
                else:
                    raise HTTPException(status_code=404, detail="Không tìm thấy tiến trình hoặc dự án để tiếp tục render.")

        job = jobs_state[req.job_id]
        engine: Optional[FFmpegDubbingEngine] = job.get("engine")
        work_dir_val = job.get("work_dir") or str(TEMP_DIR / f"job_{req.job_id}")
        out_video_path_val = job.get("out_video_path") or str(OUTPUTS_DIR / f"dubbed_{req.job_id}.mp4")
        req_obj = job.get("req")
        timeline_list = job.get("timeline", [])

    work_dir = Path(work_dir_val)
    out_video_path = Path(out_video_path_val)
    work_dir.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    video_path_str = None
    if req_obj:
        if hasattr(req_obj, "video_path"):
            video_path_str = req_obj.video_path
        elif isinstance(req_obj, dict):
            video_path_str = req_obj.get("video_path")

    if not video_path_str or not Path(video_path_str).exists():
        # Fallback 1: check project manager
        try:
            proj_data = project_manager.load_project(req.job_id)
            if proj_data and proj_data.get("video_path") and Path(proj_data["video_path"]).exists():
                video_path_str = proj_data["video_path"]
        except Exception:
            pass

    if not video_path_str or not Path(video_path_str).exists():
        # Fallback 2: look in uploads directory for this job/project
        upload_job_dir = UPLOADS_DIR / req.job_id
        if upload_job_dir.exists():
            for v_ext in ("*.mp4", "*.mkv", "*.mov", "*.avi", "*.webm"):
                found = list(upload_job_dir.glob(v_ext))
                if found:
                    video_path_str = str(found[0])
                    break

    if not video_path_str or not Path(video_path_str).exists():
        raise HTTPException(status_code=400, detail="Không tìm thấy file video gốc để tiếp tục render. Vui lòng tải lại video!")

    video_p = Path(video_path_str)

    if not engine:
        engine = FFmpegDubbingEngine(
            tts_client=tts_client,
            min_audio_speed=getattr(req_obj, "min_audio_speed", 0.80) if req_obj else 0.80,
            max_audio_speed=getattr(req_obj, "max_audio_speed", 1.40) if req_obj else 1.40,
            max_gap_borrow=getattr(req_obj, "max_gap_borrow", 0.80) if req_obj else 0.80,
            safety_gap_buffer=getattr(req_obj, "safety_gap_buffer", 0.15) if req_obj else 0.15,
            use_adaptive_prosody=getattr(req_obj, "use_adaptive_prosody", True) if req_obj else True,
            orig_volume=getattr(req_obj, "orig_volume", 0.15) if req_obj else 0.15,
            dub_volume=getattr(req_obj, "dub_volume", 1.20) if req_obj else 1.20,
            num_workers=getattr(req_obj, "num_workers", 50) if req_obj else 50,
        )

        with job_locks:
            jobs_state[req.job_id]["engine"] = engine

    # Convert timeline items to TimelineSegment objects
    timeline_objs: List[TimelineSegment] = []
    for s in timeline_list:
        if isinstance(s, TimelineSegment):
            timeline_objs.append(s)
        elif isinstance(s, dict):
            timeline_objs.append(TimelineSegment(**s))

    video_meta = get_video_metadata(video_p)

    with job_locks:
        jobs_state[req.job_id]["status"] = "running"
        jobs_state[req.job_id]["percent"] = 45.0
        jobs_state[req.job_id]["stage"] = "audio_render"
        jobs_state[req.job_id]["message"] = "Đang tiếp tục hòa trộn âm thanh & Render Video..."

    broadcast_sync(
        req.job_id,
        {
            "percent": 45.0,
            "stage": "audio_render",
            "message": "Đang tiếp tục hòa trộn âm thanh & Render Video...",
        },
    )

    def worker_resume():
        def on_progress(payload: Dict[str, Any]):
            with job_locks:
                jobs_state[req.job_id]["percent"] = payload["percent"]
                jobs_state[req.job_id]["stage"] = payload["stage"]
                jobs_state[req.job_id]["message"] = payload["message"]
                jobs_state[req.job_id]["data"] = payload.get("data", {})

            broadcast_sync(req.job_id, payload)

        try:
            result = engine.render_remaining_pipeline(
                video_p=video_p,
                timeline_segs=timeline_objs,
                output_video_path=out_video_path,
                work_p=work_dir,
                video_meta=video_meta,
                progress_cb=on_progress,
            )

            out_srt_path = out_video_path.with_suffix(".srt")
            job_folder_name = out_video_path.parent.name
            srt_url = f"/temp/outputs/{job_folder_name}/{out_srt_path.name}" if out_srt_path.exists() else None
            video_url = f"/temp/outputs/{job_folder_name}/{out_video_path.name}"

            with job_locks:
                jobs_state[req.job_id]["status"] = "completed"
                jobs_state[req.job_id]["percent"] = 100.0
                jobs_state[req.job_id]["stage"] = "completed"
                jobs_state[req.job_id]["message"] = "Hoàn tất! Video & Phụ đề SRT đã sẵn sàng tải về."
                jobs_state[req.job_id]["output_path"] = str(out_video_path)
                jobs_state[req.job_id]["output_url"] = video_url
                jobs_state[req.job_id]["output_srt_url"] = srt_url
                jobs_state[req.job_id]["result"] = result

            broadcast_sync(
                req.job_id,
                {
                    "percent": 100.0,
                    "stage": "completed",
                    "message": "Hoàn tất! Video & Phụ đề SRT đã sẵn sàng tải về.",
                    "output_url": video_url,
                    "output_srt_url": srt_url,
                    "result": result,
                },
            )

        except Exception as e:
            with job_locks:
                jobs_state[req.job_id]["status"] = "failed"
                jobs_state[req.job_id]["error"] = str(e)
                jobs_state[req.job_id]["message"] = f"Lỗi render: {e}"

            broadcast_sync(
                req.job_id,
                {
                    "percent": jobs_state[req.job_id].get("percent", 45.0),
                    "stage": "failed",
                    "error": str(e),
                    "message": f"Lỗi trong quá trình render: {e}",
                },
            )

    t = threading.Thread(target=worker_resume, daemon=True)
    t.start()

    return {"job_id": req.job_id, "status": "resumed"}


@app.get("/api/job_status/{job_id}")
async def get_job_status(job_id: str):
    """Poll job status directly."""
    with job_locks:
        if job_id not in jobs_state:
            raise HTTPException(status_code=404, detail="Job not found")
        return get_job_public_state(jobs_state[job_id])


@app.get("/api/download/{job_id}")
async def download_video(job_id: str):
    """Download final dubbed video."""
    with job_locks:
        if job_id not in jobs_state:
            raise HTTPException(status_code=404, detail="Job not found")
        job = jobs_state[job_id]
        if job.get("status") != "completed" or not job.get("output_path"):
            raise HTTPException(status_code=400, detail="Job not ready for download")
        out_path = Path(job["output_path"])
        if not out_path.exists():
            raise HTTPException(status_code=404, detail="Output file missing")
        return FileResponse(
            str(out_path),
            media_type="video/mp4",
            filename=f"dubbed_video_{job_id}.mp4",
        )


def cleanup_temp_files(max_age_hours: int = 0, clear_all_jobs: bool = True, clear_outputs: bool = False, clear_uploads: bool = True) -> Dict[str, Any]:
    """
    Clean up all temporary files, uploads, projects, cache, and intermediate folders EXCEPT the 'outputs/' directory.
    Outputs folder (exported finished videos & SRTs) is ALWAYS strictly preserved unless clear_outputs=True.
    """
    now = time.time()
    deleted_count = 0
    freed_bytes = 0

    if not TEMP_DIR.exists():
        return {"deleted_count": 0, "freed_mb": 0.0}

    with job_locks:
        active_job_dirs = [f"job_{jid}" for jid, j in jobs_state.items() if j.get("status") == "running"]

    for item in TEMP_DIR.iterdir():
        # NEVER delete outputs directory unless explicitly requested
        if item.name == "outputs" and not clear_outputs:
            continue

        try:
            if item.is_dir():
                if item.name in active_job_dirs:
                    continue  # Skip currently running job
                
                mtime = item.stat().st_mtime
                if clear_all_jobs or (now - mtime) > (max_age_hours * 3600):
                    size = sum(f.stat().st_size for f in item.glob("**/*") if f.is_file())
                    shutil.rmtree(item, ignore_errors=True)
                    deleted_count += 1
                    freed_bytes += size
            elif item.is_file():
                mtime = item.stat().st_mtime
                if clear_all_jobs or (now - mtime) > (max_age_hours * 3600):
                    freed_bytes += item.stat().st_size
                    item.unlink(missing_ok=True)
                    deleted_count += 1
        except Exception:
            pass

    # Ensure required base directory structure exists
    TEMP_DIR.mkdir(exist_ok=True)
    UPLOADS_DIR.mkdir(exist_ok=True)
    OUTPUTS_DIR.mkdir(exist_ok=True)
    PROJECTS_DIR.mkdir(exist_ok=True)
    TTS_CACHE_DIR.mkdir(exist_ok=True)

    return {
        "deleted_count": deleted_count,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
    }


def _background_cleanup_worker():
    """Periodic background daemon that cleans old intermediate temp files every 6 hours."""
    while True:
        try:
            time.sleep(21600)  # Every 6 hours
            cleanup_temp_files(max_age_hours=12, clear_all_jobs=False, clear_outputs=False, clear_uploads=True)
        except Exception:
            pass


@app.on_event("startup")
async def on_startup():
    """Run initial cache indexing and start periodic worker."""
    global MAIN_EVENT_LOOP
    MAIN_EVENT_LOOP = asyncio.get_running_loop()
    try:
        indexed = project_manager.scan_and_index_existing_jobs()
    except Exception:
        pass
    t = threading.Thread(target=_background_cleanup_worker, daemon=True)
    t.start()


@app.post("/api/cleanup")
async def api_cleanup(clear_outputs: bool = False):
    """Manually clear all temporary files, cache, uploads, and projects while protecting outputs/."""
    res = cleanup_temp_files(max_age_hours=0, clear_all_jobs=True, clear_outputs=clear_outputs, clear_uploads=True)
    return {
        "success": True,
        "deleted_count": res["deleted_count"],
        "freed_mb": res["freed_mb"],
        "message": f"Đã dọn dẹp sạch toàn bộ {res['deleted_count']} mục rác và tệp tạm, giải phóng {res['freed_mb']} MB. (Thư mục video thành phẩm 'outputs' được giữ nguyên an toàn!)",
    }


class OpenFileRequest(BaseModel):
    job_id: Optional[str] = None
    target: str = "folder"  # "folder", "video", "srt"


@app.post("/api/open_file")
async def open_local_file_or_folder(req: OpenFileRequest):
    """Open output folder or video directly on Windows host OS."""
    out_video_path = None
    out_srt_path = None

    if req.job_id:
        with job_locks:
            if req.job_id in jobs_state:
                job = jobs_state[req.job_id]
                if job.get("output_path"):
                    out_video_path = Path(job["output_path"])
        if not out_video_path:
            candidate = OUTPUTS_DIR / f"dubbed_{req.job_id}.mp4"
            if candidate.exists():
                out_video_path = candidate
        if out_video_path:
            out_srt_path = out_video_path.with_suffix(".srt")

    try:
        if req.target == "video" and out_video_path and out_video_path.exists():
            os.startfile(str(out_video_path.resolve()))
            return {"status": "ok", "message": f"Đã mở file: {out_video_path.name}"}

        elif req.target == "srt" and out_srt_path and out_srt_path.exists():
            os.startfile(str(out_srt_path.resolve()))
            return {"status": "ok", "message": f"Đã mở file: {out_srt_path.name}"}

        elif req.target == "folder":
            if out_video_path and out_video_path.parent.exists():
                subprocess.Popen(f'explorer "{str(out_video_path.parent.resolve())}"')
            else:
                subprocess.Popen(f'explorer "{str(OUTPUTS_DIR.resolve())}"')
            return {"status": "ok", "message": "Đã mở thư mục chứa video và phụ đề"}

        else:
            subprocess.Popen(f'explorer "{str(OUTPUTS_DIR.resolve())}"')
            return {"status": "ok", "message": "Đã mở thư mục outputs"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể mở file/thư mục: {e}")


@app.websocket("/ws/progress/{job_id}")
async def ws_progress(websocket: WebSocket, job_id: str):
    """WebSocket endpoint to push live progress."""
    await manager.connect(job_id, websocket)
    try:
        # Send current state immediately on connect
        pub_state = None
        with job_locks:
            if job_id in jobs_state:
                pub_state = get_job_public_state(jobs_state[job_id])
        if pub_state:
            await websocket.send_json(pub_state)
        while True:
            # Keep alive
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(job_id, websocket)
    except Exception:
        manager.disconnect(job_id, websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
