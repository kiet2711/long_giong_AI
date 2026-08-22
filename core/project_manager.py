"""
Project Manager for Dubbing & Video Sync Studio.
Handles persistent project state, indexing existing audio cache,
listing, loading, and continuing previous projects.
"""

import json
import logging
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from core.srt_parser import SRTParser, SubtitleItem
from core.tts_client import CapCutTTSClient

logger = logging.getLogger(__name__)


class ProjectManager:
    """Manages persistent dubbing projects and audio cache indexing."""

    def __init__(self, base_dir: Optional[Union[str, Path]] = None, tts_client: Optional[CapCutTTSClient] = None):
        if base_dir is None:
            self.base_dir = Path(__file__).parent.parent.resolve()
        else:
            self.base_dir = Path(base_dir).resolve()

        self.temp_dir = self.base_dir / "temp"
        self.projects_dir = self.temp_dir / "projects"
        self.uploads_dir = self.temp_dir / "uploads"
        self.outputs_dir = self.temp_dir / "outputs"
        self.tts_cache_dir = self.temp_dir / "tts_cache"

        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        self.tts_cache_dir.mkdir(parents=True, exist_ok=True)

        self.tts_client = tts_client or CapCutTTSClient(cache_dir=self.tts_cache_dir)

    def scan_and_index_existing_jobs(self) -> int:
        """
        Auto-discover previous jobs in temp/job_* and uploads/
        to recover all existing MP3 audios into global tts_cache.
        """
        indexed_count = 0
        try:
            # 1. Find all SRT files in uploads
            srt_files = list(self.uploads_dir.glob("**/*.srt"))
            # 2. Find all job audios dirs
            job_audio_dirs = list(self.temp_dir.glob("job_*/audios"))

            for srt_p in srt_files:
                try:
                    subs = SRTParser.parse_srt_file(srt_p)
                    # Build timeline segments to accurately map audio_seg_XXXX.mp3 seg_id
                    timeline = SRTParser.build_timeline_segments(subs)
                    dub_map = {s.seg_id: s for s in timeline if s.seg_type == "dub"}

                    for j_aud_dir in job_audio_dirs:
                        mp3_files = list(j_aud_dir.glob("audio_seg_*.mp3"))
                        for mp3_p in mp3_files:
                            try:
                                seg_id_str = mp3_p.stem.replace("audio_seg_", "")
                                seg_id = int(seg_id_str)
                                if seg_id in dub_map:
                                    seg_item = dub_map[seg_id]
                                    if seg_item.text_dub and mp3_p.stat().st_size > 500:
                                        self.tts_client.save_to_cache(
                                            text=seg_item.text_dub,
                                            audio_source=mp3_p,
                                            voice="BV421_vivn_streaming",
                                            rate="1.0",
                                        )
                                        indexed_count += 1
                            except Exception:
                                pass

                    # Auto-create project for existing uploads if not exists
                    session_dir = srt_p.parent
                    video_candidates = [f for f in session_dir.glob("*.*") if f.suffix.lower() in (".mp4", ".mkv", ".mov", ".avi", ".webm", ".ts")]
                    if video_candidates:
                        video_p = video_candidates[0]
                        proj_id = session_dir.name
                        self.create_or_update_project(
                            project_id=proj_id,
                            name=video_p.stem,
                            video_path=str(video_p),
                            srt_dub_path=str(srt_p),
                            voice="BV421_vivn_streaming",
                            voice_rate="1.0",
                            status="ready",
                        )
                except Exception as e:
                    logger.debug(f"Scan upload srt error: {e}")

        except Exception as e:
            logger.warning(f"Error scanning existing jobs for cache indexing: {e}")

        return indexed_count

    def create_or_update_project(
        self,
        project_id: str,
        name: str,
        video_path: Optional[str] = None,
        srt_dub_path: Optional[str] = None,
        srt_orig_path: Optional[str] = None,
        voice: str = "BV421_vivn_streaming",
        voice_rate: str = "1.0",
        video_meta: Optional[Dict[str, Any]] = None,
        subtitles: Optional[List[Dict[str, Any]]] = None,
        status: str = "ready",
        output_path: Optional[str] = None,
        output_url: Optional[str] = None,
        output_srt_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Save or update project metadata in temp/projects/{project_id}/project.json."""
        proj_dir = self.projects_dir / project_id
        proj_dir.mkdir(parents=True, exist_ok=True)
        proj_file = proj_dir / "project.json"

        data: Dict[str, Any] = {}
        if proj_file.exists():
            try:
                with open(proj_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}

        now_str = time.strftime("%Y-%m-%d %H:%M:%S")

        data.update({
            "project_id": project_id,
            "name": name or data.get("name", "Dự án lồng tiếng"),
            "video_path": video_path or data.get("video_path"),
            "srt_dub_path": srt_dub_path or data.get("srt_dub_path"),
            "srt_orig_path": srt_orig_path or data.get("srt_orig_path"),
            "voice": voice or data.get("voice", "BV421_vivn_streaming"),
            "voice_rate": voice_rate or data.get("voice_rate", "1.0"),
            "video_meta": video_meta or data.get("video_meta"),
            "status": status or data.get("status", "ready"),
            "output_path": output_path or data.get("output_path"),
            "output_url": output_url or data.get("output_url"),
            "output_srt_url": output_srt_url or data.get("output_srt_url"),
            "updated_at": now_str,
            "created_at": data.get("created_at", now_str),
        })

        if subtitles:
            data["subtitles"] = subtitles
            data["total_subtitles"] = len(subtitles)
        elif "subtitles" not in data and srt_dub_path and os.path.exists(srt_dub_path):
            try:
                parsed = SRTParser.parse_paired_srt(srt_dub_path, srt_orig_path)
                data["subtitles"] = [s.to_dict() for s in parsed]
                data["total_subtitles"] = len(parsed)
            except Exception:
                pass

        with open(proj_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return data

    def list_projects(self) -> List[Dict[str, Any]]:
        """List all available saved projects with cache statistics."""
        projects = []
        for p_dir in self.projects_dir.iterdir():
            if p_dir.is_dir():
                p_file = p_dir / "project.json"
                if p_file.exists():
                    try:
                        with open(p_file, "r", encoding="utf-8") as f:
                            p_data = json.load(f)

                        # Calculate cache status
                        subtitles = p_data.get("subtitles", [])
                        voice = p_data.get("voice", "BV421_vivn_streaming")
                        rate = p_data.get("voice_rate", "1.0")

                        cached_count = 0
                        for s in subtitles:
                            text = s.get("text_dub", "")
                            if text and self.tts_client.get_cached_audio_path(text, voice, rate):
                                cached_count += 1

                        total_subs = len(subtitles)
                        pct = round((cached_count / max(1, total_subs)) * 100.0, 1)

                        p_data["total_segments"] = total_subs
                        p_data["cached_segments"] = cached_count
                        p_data["missing_segments"] = max(0, total_subs - cached_count)
                        p_data["cached_percent"] = pct

                        projects.append(p_data)
                    except Exception as e:
                        logger.debug(f"Failed to read project {p_dir.name}: {e}")

        # Sort by updated_at descending
        projects.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return projects

    def load_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Load full project state and analyze subtitle cache status."""
        p_file = self.projects_dir / project_id / "project.json"
        if not p_file.exists():
            return None

        try:
            with open(p_file, "r", encoding="utf-8") as f:
                p_data = json.load(f)

            # Check / parse subtitles if missing
            subtitles = p_data.get("subtitles", [])
            srt_dub_p = p_data.get("srt_dub_path")
            srt_orig_p = p_data.get("srt_orig_path")

            if not subtitles and srt_dub_p and os.path.exists(srt_dub_p):
                parsed = SRTParser.parse_paired_srt(srt_dub_p, srt_orig_p)
                subtitles = [s.to_dict() for s in parsed]
                p_data["subtitles"] = subtitles

            voice = p_data.get("voice", "BV421_vivn_streaming")
            rate = p_data.get("voice_rate", "1.0")

            # Enrich each subtitle item with cache indicator
            cached_count = 0
            for s in subtitles:
                text = s.get("text_dub", "")
                has_cached = bool(text and self.tts_client.get_cached_audio_path(text, voice, rate))
                s["has_cache"] = has_cached
                if has_cached:
                    cached_count += 1

            total_subs = len(subtitles)
            p_data["subtitles"] = subtitles
            p_data["total_segments"] = total_subs
            p_data["cached_segments"] = cached_count
            p_data["missing_segments"] = max(0, total_subs - cached_count)
            p_data["cached_percent"] = round((cached_count / max(1, total_subs)) * 100.0, 1)

            # URL builders
            video_p = p_data.get("video_path")
            if video_p and os.path.exists(video_p):
                p_data["video_exists"] = True
                try:
                    rel_p = Path(video_p).resolve().relative_to(self.temp_dir.resolve())
                    p_data["video_url"] = f"/temp/{rel_p.as_posix()}"
                except Exception:
                    p_data["video_url"] = None
            else:
                p_data["video_exists"] = False

            return p_data
        except Exception as e:
            logger.error(f"Error loading project {project_id}: {e}")
            return None

    def delete_project(self, project_id: str) -> bool:
        """Delete a project directory."""
        p_dir = self.projects_dir / project_id
        if p_dir.exists():
            shutil.rmtree(p_dir, ignore_errors=True)
            return True
        return False

    def check_subtitles_cache(
        self,
        subtitles: List[Dict[str, Any]],
        voice: str = "BV421_vivn_streaming",
        voice_rate: str = "1.0",
    ) -> Dict[str, Any]:
        """Inspect list of subtitles against global tts_cache."""
        cached_count = 0
        total = len(subtitles)

        enriched_subs = []
        for s in subtitles:
            s_copy = dict(s)
            text = s_copy.get("text_dub", "")
            has_c = bool(text and self.tts_client.get_cached_audio_path(text, voice, voice_rate))
            s_copy["has_cache"] = has_c
            if has_c:
                cached_count += 1
            enriched_subs.append(s_copy)

        return {
            "total": total,
            "cached_count": cached_count,
            "missing_count": max(0, total - cached_count),
            "cached_percent": round((cached_count / max(1, total)) * 100.0, 1),
            "subtitles": enriched_subs,
        }
