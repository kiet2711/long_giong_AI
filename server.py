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
from pathlib import Path
from typing import Any, Dict, List, Optional

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

from core.ffmpeg_engine import FFmpegDubbingEngine, get_video_metadata
from core.srt_parser import SRTParser, SubtitleItem
from core.tts_client import CapCutTTSClient, VoiceCatalog

BASE_DIR = Path(__file__).parent.resolve()
TEMP_DIR = BASE_DIR / "temp"
UPLOADS_DIR = TEMP_DIR / "uploads"
OUTPUTS_DIR = TEMP_DIR / "outputs"
STATIC_DIR = BASE_DIR / "static"

TEMP_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

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

tts_client = CapCutTTSClient()
voice_catalog = VoiceCatalog()


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
            for ws in active_connections[job_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead_sockets.append(ws)
            for ws in dead_sockets:
                if ws in active_connections[job_id]:
                    active_connections[job_id].remove(ws)


manager = ConnectionManager()


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


@app.post("/api/upload_files")
async def upload_files(
    video: Optional[UploadFile] = File(None),
    srt_dub: Optional[UploadFile] = File(None),
    srt_orig: Optional[UploadFile] = File(None),
):
    """Upload video and subtitle files."""
    session_id = uuid.uuid4().hex[:8]
    session_dir = UPLOADS_DIR / session_id
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

    return {
        "session_id": session_id,
        "video_path": video_path,
        "video_url": f"/temp/uploads/{session_id}/{Path(video_path).name}" if video_path else None,
        "video_meta": video_meta,
        "srt_dub_path": srt_dub_path,
        "srt_orig_path": srt_orig_path,
        "subtitles": subtitles,
    }


class StartDubbingRequest(BaseModel):
    video_path: str
    srt_dub_path: str
    srt_orig_path: Optional[str] = None
    voice: Optional[str] = "BV421_vivn_streaming"
    voice_rate: Optional[str] = "1.0"
    min_audio_speed: Optional[float] = 0.80
    max_audio_speed: Optional[float] = 1.20
    min_video_speed: Optional[float] = 0.50
    max_video_speed: Optional[float] = 1.50
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
                max_audio_speed=req.max_audio_speed if req.max_audio_speed is not None else 1.20,
                min_video_speed=req.min_video_speed if req.min_video_speed is not None else 0.50,
                max_video_speed=req.max_video_speed if req.max_video_speed is not None else 1.50,
                min_ratio=req.min_ratio,
                max_ratio=req.max_ratio,
                orig_volume=req.orig_volume if req.orig_volume is not None else 0.15,
                dub_volume=req.dub_volume if req.dub_volume is not None else 1.20,
                num_workers=req.num_workers if req.num_workers is not None else 50,
            )

            # Thread-safe async broadcaster loop
            loop = asyncio.new_event_loop()

            def on_progress(payload: Dict[str, Any]):
                with job_locks:
                    jobs_state[job_id]["percent"] = payload["percent"]
                    jobs_state[job_id]["stage"] = payload["stage"]
                    jobs_state[job_id]["message"] = payload["message"]
                    jobs_state[job_id]["data"] = payload.get("data", {})

                # Broadcast via WebSocket
                async def send_ws():
                    await manager.broadcast(job_id, payload)

                try:
                    loop.run_until_complete(send_ws())
                except Exception:
                    pass

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

            async def final_broadcast():
                await manager.broadcast(
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

            try:
                loop.run_until_complete(final_broadcast())
                loop.close()
            except Exception:
                pass

        except Exception as e:
            with job_locks:
                jobs_state[job_id]["status"] = "failed"
                jobs_state[job_id]["error"] = str(e)
                jobs_state[job_id]["message"] = f"Lỗi: {e}"

            async def error_broadcast():
                await manager.broadcast(
                    job_id,
                    {
                        "percent": jobs_state[job_id]["percent"],
                        "stage": "failed",
                        "error": str(e),
                        "message": f"Lỗi trong quá trình xử lý: {e}",
                    },
                )

            try:
                err_loop = asyncio.new_event_loop()
                err_loop.run_until_complete(error_broadcast())
                err_loop.close()
            except Exception:
                pass

    t = threading.Thread(target=worker, daemon=True)
    t.start()

    return {"job_id": job_id, "status": "started"}


class RetrySegmentsRequest(BaseModel):
    job_id: str
    segments: List[Dict[str, Any]]
    voice: Optional[str] = None
    voice_rate: Optional[str] = None


class ResumeRenderRequest(BaseModel):
    job_id: str
    skip_failed: bool = True


@app.post("/api/retry_tts_segments")
async def retry_tts_segments(req: RetrySegmentsRequest):
    """Re-generate TTS for specific failed segments."""
    with job_locks:
        if req.job_id not in jobs_state:
            raise HTTPException(status_code=404, detail="Job not found")
        job = jobs_state[req.job_id]
        engine: FFmpegDubbingEngine = job.get("engine")
        work_dir = Path(job.get("work_dir")) if job.get("work_dir") else None
        timeline_list = job.get("timeline", [])

    if not engine or not work_dir:
        raise HTTPException(status_code=400, detail="Job context expired or not initialized")

    updated = []
    for item in req.segments:
        seg_id = item["seg_id"]
        text_dub = item.get("text_dub", "").strip()
        matching_seg = next((s for s in timeline_list if s.get("seg_id") == seg_id), None)
        if not matching_seg:
            continue

        seg_obj = TimelineSegment(**matching_seg)
        try:
            res_seg = engine.retry_single_tts_segment(
                seg=seg_obj,
                text_dub=text_dub or seg_obj.text_dub,
                work_dir=work_dir,
                voice=req.voice or "BV421_vivn_streaming",
                voice_rate=req.voice_rate or "1.0",
            )
            for i, s in enumerate(timeline_list):
                if s.get("seg_id") == seg_id:
                    timeline_list[i] = res_seg.to_dict()
                    break
            updated.append(res_seg.to_dict())
        except Exception as e:
            updated.append({
                "seg_id": seg_id,
                "is_failed": True,
                "tts_error": str(e),
                "text_dub": text_dub or seg_obj.text_dub,
            })

    with job_locks:
        jobs_state[req.job_id]["timeline"] = timeline_list
        jobs_state[req.job_id]["failed_segments"] = [
            s for s in timeline_list if s.get("seg_type") == "dub" and (s.get("is_failed") or not s.get("audio_path"))
        ]

    return {
        "status": "ok",
        "updated_segments": updated,
        "remaining_failed": len(jobs_state[req.job_id]["failed_segments"]),
    }


@app.post("/api/resume_dubbing_render")
async def resume_dubbing_render(req: ResumeRenderRequest):
    """Resume Step 3 (Audio Mix) and Step 4 (Video Render) after reviewing failed TTS."""
    with job_locks:
        if req.job_id not in jobs_state:
            raise HTTPException(status_code=404, detail="Job not found")
        job = jobs_state[req.job_id]
        engine: FFmpegDubbingEngine = job.get("engine")
        work_dir = Path(job.get("work_dir")) if job.get("work_dir") else None
        out_video_path = Path(job.get("out_video_path")) if job.get("out_video_path") else None
        video_p = Path(job.get("req").video_path) if job.get("req") else None
        timeline_list = job.get("timeline", [])

    if not engine or not work_dir or not out_video_path or not video_p:
        raise HTTPException(status_code=400, detail="Job context missing or expired")

    timeline_objs = [TimelineSegment(**s) for s in timeline_list]
    video_meta = get_video_metadata(video_p)

    def worker_resume():
        loop = asyncio.new_event_loop()

        def on_progress(payload: Dict[str, Any]):
            with job_locks:
                jobs_state[req.job_id]["percent"] = payload["percent"]
                jobs_state[req.job_id]["stage"] = payload["stage"]
                jobs_state[req.job_id]["message"] = payload["message"]
                jobs_state[req.job_id]["data"] = payload.get("data", {})

            async def send_ws():
                await manager.broadcast(req.job_id, payload)

            try:
                loop.run_until_complete(send_ws())
            except Exception:
                pass

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
                jobs_state[req.job_id]["output_path"] = str(out_video_path)
                jobs_state[req.job_id]["output_url"] = video_url
                jobs_state[req.job_id]["output_srt_url"] = srt_url
                jobs_state[req.job_id]["result"] = result

            async def final_broadcast():
                await manager.broadcast(
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

            try:
                loop.run_until_complete(final_broadcast())
                loop.close()
            except Exception:
                pass

        except Exception as e:
            with job_locks:
                jobs_state[req.job_id]["status"] = "failed"
                jobs_state[req.job_id]["error"] = str(e)
                jobs_state[req.job_id]["message"] = f"Lỗi render: {e}"

    t = threading.Thread(target=worker_resume, daemon=True)
    t.start()

    return {"job_id": req.job_id, "status": "resumed"}


@app.get("/api/job_status/{job_id}")
async def get_job_status(job_id: str):
    """Poll job status directly."""
    with job_locks:
        if job_id not in jobs_state:
            raise HTTPException(status_code=404, detail="Job not found")
        return jobs_state[job_id]


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


def cleanup_temp_files(max_age_hours: int = 6, clear_all_jobs: bool = False, clear_outputs: bool = False) -> Dict[str, Any]:
    """Clean up old temporary job folders, preview audio, and temp files."""
    now = time.time()
    deleted_count = 0
    freed_bytes = 0

    if not TEMP_DIR.exists():
        return {"deleted_count": 0, "freed_mb": 0.0}

    with job_locks:
        active_job_dirs = [f"job_{jid}" for jid, j in jobs_state.items() if j.get("status") == "running"]

    for item in TEMP_DIR.iterdir():
        if item.name == "outputs" and not clear_outputs:
            continue
        if item.name == "uploads" and not clear_outputs:
            continue

        try:
            if item.is_dir():
                if item.name in active_job_dirs:
                    continue
                # If clear_all_jobs is True or folder is older than max_age_hours
                mtime = item.stat().st_mtime
                if clear_all_jobs or (now - mtime) > (max_age_hours * 3600):
                    size = sum(f.stat().st_size for f in item.glob("**/*") if f.is_file())
                    shutil.rmtree(item, ignore_errors=True)
                    deleted_count += 1
                    freed_bytes += size
            elif item.is_file():
                # Preview audio or stray mp3/m4a/txt
                mtime = item.stat().st_mtime
                if clear_all_jobs or (now - mtime) > (max_age_hours * 3600):
                    freed_bytes += item.stat().st_size
                    item.unlink(missing_ok=True)
                    deleted_count += 1
        except Exception:
            pass

    return {
        "deleted_count": deleted_count,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2),
    }


def _background_cleanup_worker():
    """Periodic background daemon that cleans old temp files every 2 hours."""
    while True:
        try:
            time.sleep(7200)  # Every 2 hours
            cleanup_temp_files(max_age_hours=6)
        except Exception:
            pass


@app.on_event("startup")
async def on_startup():
    """Run initial cleanup on server launch and start periodic worker."""
    cleanup_temp_files(max_age_hours=6)
    t = threading.Thread(target=_background_cleanup_worker, daemon=True)
    t.start()


@app.post("/api/cleanup")
async def api_cleanup(clear_outputs: bool = False):
    """Manually clear temporary job folders and cache."""
    res = cleanup_temp_files(max_age_hours=0, clear_all_jobs=True, clear_outputs=clear_outputs)
    return {
        "success": True,
        "deleted_count": res["deleted_count"],
        "freed_mb": res["freed_mb"],
        "message": f"Đã dọn dẹp {res['deleted_count']} mục tạm, giải phóng {res['freed_mb']} MB bộ nhớ!",
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
        with job_locks:
            if job_id in jobs_state:
                await websocket.send_json(jobs_state[job_id])
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
