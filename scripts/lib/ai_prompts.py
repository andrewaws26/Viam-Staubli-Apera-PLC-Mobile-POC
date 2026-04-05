"""
AI analysis prompts and utilities for IronSight Upload & Analysis Server.

Extracted from ironsight-server.py. Contains:
  - Default analysis prompts
  - Video frame extraction
  - Claude CLI analysis integration
  - Status bus posting
"""

import datetime
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional


# ─────────────────────────────────────────────────────────────
#  Config (can be overridden by importer)
# ─────────────────────────────────────────────────────────────

PROJECT_DIR = Path("/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC")
ANALYSIS_DIR = PROJECT_DIR / "uploads" / "analyses"
STATUS_SCRIPT = PROJECT_DIR / "scripts" / "ironsight-status.py"

ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_PROMPT = """You are IronSight, an AI monitoring system for TPS (Tie Plate System)
equipment on railroad trucks. Analyze this image and describe what you see.
Focus on:
- Any PLC equipment, wiring, or industrial components
- Tie plates, railroad track, or dropper mechanisms
- Any visible issues, damage, or anomalies
- Encoder or sensor equipment
- Cable connections or loose components
Be specific and technical. If you see register values or screen displays, read them."""


# ─────────────────────────────────────────────────────────────
#  Status bus
# ─────────────────────────────────────────────────────────────

def post_status(phase: str, message: str, level: str = "info") -> None:
    """Post to the IronSight display status bus."""
    try:
        subprocess.Popen(
            ["python3", str(STATUS_SCRIPT), "upload", phase, message, "--level", level],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
#  Video frame extraction
# ─────────────────────────────────────────────────────────────

def extract_video_frames(video_path: str, max_frames: int = 5) -> tuple:
    """Extract key frames from a video using ffmpeg.

    Args:
        video_path: Path to the video file.
        max_frames: Maximum number of frames to extract.

    Returns:
        Tuple of (list of frame file paths, temp directory path).
    """
    frames: list[str] = []
    frame_dir = tempfile.mkdtemp(prefix="ironsight-frames-")

    try:
        # Get video duration
        probe = subprocess.check_output([
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", video_path
        ], text=True, timeout=30)
        duration = float(json.loads(probe)["format"].get("duration", 10))

        # Extract frames evenly spaced through the video
        interval = max(1, duration / max_frames)

        subprocess.run([
            "ffmpeg", "-i", video_path,
            "-vf", f"fps=1/{interval}",
            "-frames:v", str(max_frames),
            "-q:v", "2",
            f"{frame_dir}/frame_%03d.jpg"
        ], capture_output=True, timeout=60)

        # Collect frame paths
        for f in sorted(Path(frame_dir).glob("frame_*.jpg")):
            frames.append(str(f))

    except Exception as e:
        print(f"Frame extraction error: {e}")

    return frames, frame_dir


# ─────────────────────────────────────────────────────────────
#  Claude analysis
# ─────────────────────────────────────────────────────────────

def analyze_with_claude(file_path: str, prompt: Optional[str] = None,
                        is_video: bool = False) -> dict:
    """Send an image or video to Claude for analysis.

    Args:
        file_path: Path to the image or video file.
        prompt: Custom analysis prompt (uses DEFAULT_PROMPT if None).
        is_video: Whether the file is a video.

    Returns:
        Dict with keys: file, timestamp, type, analysis, error.
    """
    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    result = {
        "file": os.path.basename(file_path),
        "timestamp": timestamp,
        "type": "video" if is_video else "image",
        "analysis": "",
        "error": None,
    }

    if not prompt:
        prompt = DEFAULT_PROMPT

    frame_dir = None
    try:
        if is_video:
            post_status("analyzing", "Extracting video frames...", "info")
            frames, frame_dir = extract_video_frames(file_path)
            if not frames:
                result["error"] = "Could not extract frames from video"
                return result

            # Build prompt with all frames
            frame_refs = " ".join(frames)
            full_prompt = f"""{prompt}

This is a video. I've extracted {len(frames)} key frames for you to analyze.
Describe what's happening across the frames -- any motion, changes, or patterns.
Frame files: {frame_refs}"""

            # Run Claude with the frames
            cmd = ["/usr/local/bin/claude", "-p", full_prompt,
                   "--dangerously-skip-permissions", "--output-format", "text"]
            for frame in frames:
                cmd.extend(["--file", frame])

        else:
            # Single image
            full_prompt = f"""{prompt}

Analyze the image at: {file_path}"""
            cmd = ["/usr/local/bin/claude", "-p", full_prompt,
                   "--dangerously-skip-permissions", "--output-format", "text"]

        post_status("analyzing", f"Claude analyzing {result['type']}...", "info")

        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
            cwd=str(PROJECT_DIR)
        )

        if proc.returncode == 0:
            result["analysis"] = proc.stdout.strip()
            post_status("complete", "Analysis complete", "success")
        else:
            result["error"] = proc.stderr.strip()[:500]
            post_status("error", "Analysis failed", "error")

    except subprocess.TimeoutExpired:
        result["error"] = "Analysis timed out (120s)"
        post_status("timeout", "Analysis timed out", "warning")
    except Exception as e:
        result["error"] = str(e)
        post_status("error", f"Analysis error: {e}", "error")
    finally:
        # Clean up temp frames
        if frame_dir and os.path.exists(frame_dir):
            shutil.rmtree(frame_dir, ignore_errors=True)

    # Save analysis result
    result_path = ANALYSIS_DIR / f"analysis-{timestamp}.json"
    try:
        result_path.write_text(json.dumps(result, indent=2))
    except Exception:
        pass

    return result
