#!/usr/bin/env python3
"""
IronSight Upload & Analysis Server

Lightweight HTTP server that runs on the Pi and accepts:
  - Photos from iPhone (JPEG, PNG, HEIC)
  - Videos from iPhone (MOV, MP4)
  - Commands (trigger analysis, get status)

Endpoints:
  POST /upload          — Upload photo or video for AI analysis
  POST /analyze         — Upload + immediately analyze with Claude
  GET  /status          — Current IronSight system status (JSON)
  GET  /               — Simple upload page (works in iPhone Safari)

The server listens on all interfaces so it works via:
  - USB tethering (172.20.10.2:8420)
  - WiFi (whatever IP the Pi has)
  - Tailscale (100.112.68.52:8420)

Port: 8420 (IRON → 1R0N → 8420)

Usage:
  python3 scripts/ironsight-server.py              # Start server
  python3 scripts/ironsight-server.py --port 8080  # Custom port

From iPhone:
  Safari: http://172.20.10.2:8420
  Shortcuts: POST to http://172.20.10.2:8420/upload with image body
  curl: curl -X POST -F "file=@photo.jpg" http://172.20.10.2:8420/upload
"""

import datetime
import email.parser
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# ─────────────────────────────────────────────────────────────
#  Config
# ─────────────────────────────────────────────────────────────

PORT = 8420
PROJECT_DIR = Path("/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC")
UPLOAD_DIR = PROJECT_DIR / "uploads" / "photos"
ANALYSIS_DIR = PROJECT_DIR / "uploads" / "analyses"
LATEST_UPLOAD = Path("/tmp/ironsight-latest-upload")
MAX_UPLOAD_MB = 100
STATUS_SCRIPT = PROJECT_DIR / "scripts" / "ironsight-status.py"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────
#  Analysis helpers
# ─────────────────────────────────────────────────────────────

def post_status(phase: str, message: str, level: str = "info"):
    """Post to the IronSight display status bus."""
    try:
        subprocess.Popen(
            ["python3", str(STATUS_SCRIPT), "upload", phase, message, "--level", level],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except Exception:
        pass


def extract_video_frames(video_path: str, max_frames: int = 5) -> list:
    """Extract key frames from a video using ffmpeg."""
    frames = []
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


def analyze_with_claude(file_path: str, prompt: str = None,
                        is_video: bool = False) -> dict:
    """Send an image or video to Claude for analysis."""
    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    result = {
        "file": os.path.basename(file_path),
        "timestamp": timestamp,
        "type": "video" if is_video else "image",
        "analysis": "",
        "error": None,
    }

    if not prompt:
        prompt = """You are IronSight, an AI monitoring system for TPS (Tie Plate System)
equipment on railroad trucks. Analyze this image and describe what you see.
Focus on:
- Any PLC equipment, wiring, or industrial components
- Tie plates, railroad track, or dropper mechanisms
- Any visible issues, damage, or anomalies
- Encoder or sensor equipment
- Cable connections or loose components
Be specific and technical. If you see register values or screen displays, read them."""

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
Describe what's happening across the frames — any motion, changes, or patterns.
Frame files: {frame_refs}"""

            # Run Claude with the frames
            cmd = ["/usr/local/bin/claude", "-p", full_prompt,
                   "--dangerously-skip-permissions", "--output-format", "text"]
            # Add each frame as a file for Claude to read
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


# ─────────────────────────────────────────────────────────────
#  HTTP Handler
# ─────────────────────────────────────────────────────────────

UPLOAD_PAGE = """<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IronSight</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, system-ui, sans-serif;
    background: #1e1e23; color: #e0e0e0;
    padding: 16px; max-width: 480px; margin: 0 auto;
  }
  h1 { color: #2878dc; font-size: 24px; margin-bottom: 4px; }
  .sub { color: #888; font-size: 13px; margin-bottom: 20px; }
  .status {
    background: #2a2a30; border-radius: 12px; padding: 16px;
    margin-bottom: 16px;
  }
  .status-row { display: flex; justify-content: space-between; margin: 6px 0; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .green { background: #00c850; }
  .red { background: #dc3232; }
  .upload-area {
    background: #2a2a30; border: 2px dashed #555; border-radius: 12px;
    padding: 32px 16px; text-align: center; margin-bottom: 16px;
  }
  .upload-area.active { border-color: #2878dc; background: #252535; }
  input[type=file] { display: none; }
  .btn {
    display: block; width: 100%; padding: 14px; border: none;
    border-radius: 10px; font-size: 16px; font-weight: 600;
    cursor: pointer; margin-bottom: 10px;
  }
  .btn-primary { background: #2878dc; color: white; }
  .btn-secondary { background: #3a3a42; color: #ccc; }
  .btn:active { opacity: 0.8; }
  .progress-bar {
    width: 100%; background: #2a2a30; border-radius: 6px;
    overflow: hidden; height: 24px; margin: 10px 0; display: none;
  }
  .progress-bar.show { display: block; }
  .progress-fill {
    height: 100%; background: #2878dc; border-radius: 6px;
    transition: width 0.3s ease; display: flex; align-items: center;
    justify-content: center; font-size: 12px; color: white; font-weight: 600;
    min-width: 40px;
  }
  .progress-text {
    text-align: center; font-size: 12px; color: #888; margin-bottom: 8px;
  }
  .result {
    background: #1a1a20; border-radius: 10px; padding: 14px;
    font-size: 13px; line-height: 1.5; white-space: pre-wrap;
    max-height: 400px; overflow-y: auto; margin-top: 12px;
    display: none;
  }
  .result.show { display: block; }
  .spinner { display: none; margin: 12px auto; }
  .spinner.show { display: block; }
  .preview { max-width: 100%; border-radius: 8px; margin: 10px 0; display: none; }
  .preview.show { display: block; }
  textarea {
    width: 100%; background: #2a2a30; color: #e0e0e0; border: 1px solid #444;
    border-radius: 8px; padding: 10px; font-size: 14px; resize: vertical;
    min-height: 60px; margin-bottom: 10px;
  }
</style>
</head>
<body>

<h1>IRONSIGHT</h1>
<p class="sub" id="statusText">TPS Remote Monitor</p>

<div class="status" id="sysStatus">Loading...</div>

<div class="upload-area" id="dropZone" onclick="document.getElementById('fileInput').click()">
  <p style="font-size: 40px; margin-bottom: 8px;">📷</p>
  <p>Tap to take a photo or choose file</p>
  <p style="color: #666; font-size: 12px; margin-top: 8px;">Photo, video, or document</p>
</div>

<input type="file" id="fileInput" accept="image/*,video/*,.heic,.ckp,*/*" multiple>
<img class="preview" id="preview">

<textarea id="prompt" placeholder="Optional: what should I look for? (e.g. 'check the encoder mounting' or 'read the register values on screen')"></textarea>

<button class="btn btn-primary" id="analyzeBtn" onclick="uploadAndAnalyze()">
  Analyze with AI
</button>
<button class="btn btn-secondary" onclick="uploadOnly()">
  Upload Only (no analysis)
</button>

<div class="progress-text" id="progressText"></div>
<div class="progress-bar" id="progressBar">
  <div class="progress-fill" id="progressFill" style="width: 0%">0%</div>
</div>

<div class="spinner" id="spinner">
  <p style="text-align:center; color: #2878dc;">⏳ Analyzing... this may take a minute</p>
</div>

<div class="result" id="result"></div>

<script>
const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');
const resultDiv = document.getElementById('result');
const spinner = document.getElementById('spinner');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
let selectedFiles = [];

function showProgress(pct, text) {
  progressBar.classList.add('show');
  progressFill.style.width = pct + '%';
  progressFill.textContent = pct + '%';
  if (text) { progressText.textContent = text; progressText.style.display = 'block'; }
}
function hideProgress() {
  progressBar.classList.remove('show');
  progressText.style.display = 'none';
}

function uploadWithProgress(url, formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        showProgress(pct, 'Uploading... ' + (e.loaded/1024/1024).toFixed(1) + ' / ' + (e.total/1024/1024).toFixed(1) + ' MB');
      }
    };
    xhr.onload = () => {
      try { resolve(JSON.parse(xhr.responseText)); }
      catch(e) { reject(new Error('Invalid response')); }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.timeout = 300000;
    xhr.send(formData);
  });
}

fileInput.addEventListener('change', (e) => {
  selectedFiles = Array.from(e.target.files);
  if (selectedFiles.length === 0) return;

  if (selectedFiles.length === 1 && selectedFiles[0].type.startsWith('image/')) {
    preview.src = URL.createObjectURL(selectedFiles[0]);
    preview.classList.add('show');
  } else {
    preview.classList.remove('show');
  }

  const totalMB = selectedFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
  const names = selectedFiles.map(f => f.name).join(', ');
  const truncNames = names.length > 60 ? names.slice(0, 57) + '...' : names;
  document.getElementById('dropZone').innerHTML =
    '<p style="font-size: 24px;">✅</p>' +
    '<p>' + selectedFiles.length + ' file' + (selectedFiles.length > 1 ? 's' : '') + ' selected</p>' +
    '<p style="color:#aaa;font-size:11px;">' + truncNames + '</p>' +
    '<p style="color:#666;font-size:12px;">' + totalMB.toFixed(1) + ' MB total</p>';
});

async function uploadAndAnalyze() {
  if (selectedFiles.length === 0) { alert('Select files first'); return; }
  resultDiv.classList.remove('show');
  document.getElementById('analyzeBtn').disabled = true;

  const prompt = document.getElementById('prompt').value;
  let allResults = [];

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    showProgress(0, 'Uploading ' + (i+1) + '/' + selectedFiles.length + ': ' + file.name);

    const formData = new FormData();
    formData.append('file', file);
    if (prompt) formData.append('prompt', prompt);

    try {
      const data = await uploadWithProgress('/analyze', formData);
      showProgress(100, 'Analyzing ' + (i+1) + '/' + selectedFiles.length + '...');
      spinner.classList.add('show');
      spinner.innerHTML = '<p style="text-align:center; color: #2878dc;">⏳ Waiting for AI analysis of ' + file.name + '...</p>';

      if (data.error) {
        allResults.push('❌ ' + file.name + ': ' + data.error);
      } else {
        allResults.push('📷 ' + file.name + ':\\n' + data.analysis);
      }
    } catch(e) {
      allResults.push('❌ ' + file.name + ': ' + e.message);
    }
    spinner.classList.remove('show');
  }

  hideProgress();
  resultDiv.textContent = allResults.join('\\n\\n───────────────────\\n\\n');
  resultDiv.classList.add('show');
  document.getElementById('analyzeBtn').disabled = false;
}

async function uploadOnly() {
  if (selectedFiles.length === 0) { alert('Select files first'); return; }
  let results = [];
  document.getElementById('analyzeBtn').disabled = true;

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    showProgress(0, 'Uploading ' + (i+1) + '/' + selectedFiles.length + ': ' + file.name);

    const formData = new FormData();
    formData.append('file', file);
    try {
      const data = await uploadWithProgress('/upload', formData);
      results.push('✅ ' + data.filename);
    } catch(e) {
      results.push('❌ ' + file.name + ': ' + e.message);
    }
  }

  hideProgress();
  resultDiv.textContent = results.join('\\n');
  resultDiv.classList.add('show');
  document.getElementById('analyzeBtn').disabled = false;
}

// Load system status
async function loadStatus() {
  try {
    const resp = await fetch('/status');
    const s = await resp.json();
    const dot = (ok) => '<span class="dot ' + (ok ? 'green' : 'red') + '"></span>';
    document.getElementById('sysStatus').innerHTML =
      '<div class="status-row"><span>' + dot(s.viam_server) + ' viam-server</span><span>' + (s.viam_server ? 'active' : 'stopped') + '</span></div>' +
      '<div class="status-row"><span>' + dot(s.plc_reachable) + ' PLC</span><span>' + s.plc_ip + '</span></div>' +
      '<div class="status-row"><span>' + dot(s.internet) + ' Internet</span><span>' + (s.internet ? 'connected' : 'offline') + '</span></div>' +
      '<div class="status-row"><span>' + dot(s.eth0_carrier) + ' Ethernet</span><span>' + (s.eth0_carrier ? 'linked' : 'no carrier') + '</span></div>' +
      '<div class="status-row"><span>📊 Travel</span><span>' + (s.travel_ft||0).toFixed(1) + ' ft</span></div>' +
      '<div class="status-row"><span>🔧 Plates</span><span>' + (s.plate_count||0) + ' (' + (s.plates_per_min||0).toFixed(1) + '/min)</span></div>';
  } catch(e) {
    document.getElementById('sysStatus').innerHTML = '<p style="color:#666">Could not load status</p>';
  }
}
loadStatus();
setInterval(loadStatus, 10000);
</script>
</body>
</html>"""


class IronSightHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        """Quieter logging."""
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")

    def _send_json(self, data: dict, code: int = 200):
        body = json.dumps(data, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str):
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _save_upload(self) -> tuple:
        """Parse multipart upload and save file. Returns (filepath, prompt)."""
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", 0))

        if "multipart/form-data" in content_type:
            # Parse boundary from content-type
            boundary = None
            for part in content_type.split(";"):
                part = part.strip()
                if part.startswith("boundary="):
                    boundary = part[9:].strip('"')
            if not boundary:
                return None, None

            # Read the entire body
            body = self.rfile.read(content_length)

            # Split by boundary
            boundary_bytes = f"--{boundary}".encode()
            parts = body.split(boundary_bytes)

            prompt = None
            file_data = None
            filename = None

            for part in parts:
                if not part or part == b"--\r\n" or part == b"--":
                    continue

                # Split headers from body (separated by \r\n\r\n)
                header_end = part.find(b"\r\n\r\n")
                if header_end < 0:
                    continue

                headers_raw = part[:header_end].decode("utf-8", errors="replace")
                part_body = part[header_end + 4:]
                # Remove trailing \r\n
                if part_body.endswith(b"\r\n"):
                    part_body = part_body[:-2]

                # Parse Content-Disposition
                name_match = re.search(r'name="([^"]*)"', headers_raw)
                filename_match = re.search(r'filename="([^"]*)"', headers_raw)

                field_name = name_match.group(1) if name_match else ""

                if field_name == "prompt":
                    prompt = part_body.decode("utf-8", errors="replace")
                elif field_name == "file" and filename_match:
                    filename = filename_match.group(1)
                    file_data = part_body

            if file_data and filename:
                ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
                ext = os.path.splitext(filename)[1].lower() or ".jpg"
                safe_name = f"upload-{ts}{ext}"
                save_path = UPLOAD_DIR / safe_name

                with open(save_path, "wb") as f:
                    f.write(file_data)

                # Write latest upload pointer so the current CLI session can find it
                LATEST_UPLOAD.write_text(str(save_path))
                return str(save_path), prompt

        # Raw body upload (from iOS Shortcuts)
        elif content_length > 0:
            ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            ext_map = {
                "image/jpeg": ".jpg", "image/png": ".png",
                "image/heic": ".heic", "video/quicktime": ".mov",
                "video/mp4": ".mp4", "application/octet-stream": ".bin",
            }
            ext = ext_map.get(content_type.split(";")[0], ".bin")
            # Preserve original extension for unknown types
            orig_name = self.headers.get("X-Filename", "")
            if ext == ".bin" and "." in orig_name:
                ext = "." + orig_name.rsplit(".", 1)[-1].lower()
            safe_name = f"upload-{ts}{ext}"
            save_path = UPLOAD_DIR / safe_name

            with open(save_path, "wb") as f:
                remaining = content_length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)

            # Write latest upload pointer
            LATEST_UPLOAD.write_text(str(save_path))
            prompt = parse_qs(urlparse(self.path).query).get("prompt", [None])[0]
            return str(save_path), prompt

        return None, None

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/" or path == "/index.html":
            self._send_html(UPLOAD_PAGE)

        elif path == "/status":
            # Return system status as JSON
            status = self._get_system_status()
            self._send_json(status)

        elif path == "/analyses":
            # List recent analyses
            analyses = []
            for f in sorted(ANALYSIS_DIR.glob("analysis-*.json"), reverse=True)[:20]:
                try:
                    analyses.append(json.loads(f.read_text()))
                except Exception:
                    pass
            self._send_json({"analyses": analyses})

        else:
            self.send_error(404)

    def do_POST(self):
        try:
            self._handle_post()
        except (ConnectionResetError, BrokenPipeError) as e:
            print(f"[{time.strftime('%H:%M:%S')}] Connection lost during upload: {e}")
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] POST error: {e}")
            try:
                self._send_json({"ok": False, "error": str(e)}, 500)
            except Exception:
                pass

    def _handle_post(self):
        path = urlparse(self.path).path

        if path == "/upload":
            file_path, _ = self._save_upload()
            if file_path:
                post_status("uploaded", f"Received: {os.path.basename(file_path)}", "success")
                self._send_json({
                    "ok": True,
                    "filename": os.path.basename(file_path),
                    "path": file_path,
                    "size_mb": round(os.path.getsize(file_path) / 1024 / 1024, 2),
                })
            else:
                self._send_json({"ok": False, "error": "No file received"}, 400)

        elif path == "/analyze":
            file_path, prompt = self._save_upload()
            if file_path:
                ext = os.path.splitext(file_path)[1].lower()
                is_video = ext in (".mov", ".mp4", ".avi", ".mkv", ".webm")

                post_status("analyzing",
                           f"Analyzing {os.path.basename(file_path)}...", "info")

                result = analyze_with_claude(file_path, prompt=prompt,
                                            is_video=is_video)
                self._send_json(result)
            else:
                self._send_json({"ok": False, "error": "No file received"}, 400)

        else:
            self.send_error(404)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _get_system_status(self) -> dict:
        """Quick system status for the web UI."""
        status = {
            "viam_server": False,
            "plc_reachable": False,
            "plc_ip": "unknown",
            "internet": False,
            "eth0_carrier": False,
            "travel_ft": 0.0,
            "plate_count": 0,
            "plates_per_min": 0.0,
            "truck_id": "unknown",
        }

        try:
            r = subprocess.run(["systemctl", "is-active", "viam-server"],
                              capture_output=True, text=True, timeout=3)
            status["viam_server"] = r.stdout.strip() == "active"
        except Exception:
            pass

        try:
            r = subprocess.run(["ping", "-c", "1", "-W", "1", "8.8.8.8"],
                              capture_output=True, timeout=3)
            status["internet"] = r.returncode == 0
        except Exception:
            pass

        try:
            status["eth0_carrier"] = Path("/sys/class/net/eth0/carrier").read_text().strip() == "1"
        except Exception:
            pass

        try:
            config = json.loads((PROJECT_DIR / "config" / "viam-server.json").read_text())
            for comp in config.get("components", []):
                if comp.get("name") == "plc-monitor":
                    status["plc_ip"] = comp["attributes"]["host"]
                    status["truck_id"] = comp["attributes"].get("truck_id", "unknown")
        except Exception:
            pass

        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex((status["plc_ip"], 502))
            sock.close()
            status["plc_reachable"] = result == 0
        except Exception:
            pass

        # Latest reading
        try:
            buf_dir = Path.home() / ".viam" / "offline-buffer"
            if buf_dir.exists():
                jsonl_files = sorted(buf_dir.glob("readings_*.jsonl"))
                if jsonl_files:
                    with open(jsonl_files[-1], "rb") as f:
                        f.seek(0, 2)
                        pos = f.tell()
                        buf = b""
                        while pos > 0:
                            pos = max(0, pos - 1024)
                            f.seek(pos)
                            buf = f.read() + buf
                            lines = buf.strip().split(b"\n")
                            if len(lines) >= 2 or pos == 0:
                                break
                        if lines:
                            data = json.loads(lines[-1])
                            status["travel_ft"] = data.get("encoder_distance_ft", 0)
                            status["plate_count"] = data.get("plate_drop_count", 0)
                            status["plates_per_min"] = data.get("plates_per_minute", 0)
        except Exception:
            pass

        return status


# ─────────────────────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight Upload & Analysis Server")
    parser.add_argument("--port", type=int, default=PORT, help=f"Port (default: {PORT})")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    args = parser.parse_args()

    class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

    server = ThreadedHTTPServer((args.host, args.port), IronSightHandler)

    print(f"""
╔═══════════════════════════════════════╗
║   IRONSIGHT Upload & Analysis Server  ║
╚═══════════════════════════════════════╝

Listening on port {args.port}

  USB:       http://172.20.10.2:{args.port}
  WiFi:      http://<pi-ip>:{args.port}
  Tailscale: http://100.112.68.52:{args.port}

  Upload dir: {UPLOAD_DIR}

  Open in Safari on your iPhone to:
  - Take photos and upload them
  - Send video for AI frame analysis
  - See live IronSight status
""")

    post_status("server", f"Upload server running on port {args.port}", "success")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
