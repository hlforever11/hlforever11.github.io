from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import shutil
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask


APP_VERSION = "1.0.0"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
ALLOWED_HEIGHTS = (1080, 720, 480, 360)
POT_PROVIDER_URL = os.getenv("POT_PROVIDER_URL", "http://127.0.0.1:4416")
MAX_DURATION_SECONDS = int(os.getenv("MAX_DURATION_SECONDS", "1800"))
MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", str(250 * 1024 * 1024)))
MAX_JOB_SECONDS = int(os.getenv("MAX_JOB_SECONDS", "420"))
CORS_ORIGINS = [
    value.strip()
    for value in os.getenv("CORS_ORIGINS", "https://hlforever11.github.io").split(",")
    if value.strip()
]

app = FastAPI(
    title="YouTube 下载助手 API",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

download_lock = asyncio.Lock()
rate_events: dict[str, deque[float]] = defaultdict(deque)


class ResolveRequest(BaseModel):
    url: str = Field(min_length=11, max_length=500)


def extract_video_id(value: str) -> str | None:
    candidate = value.strip()
    if VIDEO_ID_RE.fullmatch(candidate):
        return candidate

    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None

    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]

    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
        return video_id if VIDEO_ID_RE.fullmatch(video_id) else None

    if host not in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        return None

    query = parse_qs(parsed.query)
    video_id = (query.get("v") or [""])[0]
    if not video_id:
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live"}:
            video_id = parts[1]
    return video_id if VIDEO_ID_RE.fullmatch(video_id) else None


def canonical_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def enforce_rate_limit(
    request: Request,
    *,
    scope: str,
    limit: int,
    window_seconds: int,
) -> None:
    now = time.monotonic()
    bucket = rate_events[f"{scope}:{client_ip(request)}"]
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试。")
    bucket.append(now)


def yt_dlp_base() -> list[str]:
    return [
        "yt-dlp",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        "--js-runtimes",
        "node",
        "--remote-components",
        "ejs:github",
        "--extractor-args",
        f"youtubepot-bgutilhttp:base_url={POT_PROVIDER_URL}",
        "--socket-timeout",
        "25",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
    ]


def friendly_error(stderr: str) -> str:
    lowered = stderr.lower()
    if "sign in to confirm" in lowered or "not a bot" in lowered:
        return "YouTube 要求额外的人机验证，当前服务器暂时无法通过。"
    if "private video" in lowered:
        return "这是私密视频，无法下载。"
    if "video unavailable" in lowered:
        return "该视频不可用，可能已删除、受地区限制或不允许访问。"
    if "max-filesize" in lowered or "larger than max-filesize" in lowered:
        return "文件超过本站 250 MB 的单次下载上限。"
    if "requested format is not available" in lowered:
        return "所选清晰度暂时不可用，请换一个清晰度。"
    if "timed out" in lowered or "timeout" in lowered:
        return "连接 YouTube 超时，请稍后重试。"
    return "服务器未能解析该视频，请稍后重试。"


async def run_ytdlp(arguments: list[str], timeout_seconds: int) -> str:
    process = await asyncio.create_subprocess_exec(
        *yt_dlp_base(),
        *arguments,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout_seconds,
        )
    except TimeoutError:
        process.kill()
        await process.communicate()
        raise HTTPException(status_code=504, detail="处理超时，请选择较低清晰度后重试。")

    stderr_text = stderr.decode("utf-8", errors="replace")
    if process.returncode != 0:
        raise HTTPException(status_code=502, detail=friendly_error(stderr_text))
    return stdout.decode("utf-8", errors="replace").strip()


async def extract_metadata(video_id: str) -> dict:
    output = await run_ytdlp(
        ["--dump-single-json", "--skip-download", "--", canonical_url(video_id)],
        timeout_seconds=90,
    )
    try:
        info = json.loads(output)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail="服务器返回了无法识别的视频信息。") from error

    duration = int(info.get("duration") or 0)
    if duration and duration > MAX_DURATION_SECONDS:
        minutes = MAX_DURATION_SECONDS // 60
        raise HTTPException(status_code=413, detail=f"目前仅支持 {minutes} 分钟以内的视频。")
    return info


def build_format_choices(info: dict) -> list[dict]:
    source_formats = info.get("formats") or []
    heights = [
        int(item.get("height") or 0)
        for item in source_formats
        if item.get("vcodec") not in {None, "none"}
    ]
    max_height = max(heights, default=360)
    choices = []
    for height in ALLOWED_HEIGHTS:
        if height <= max_height:
            choices.append(
                {
                    "preset": f"video-{height}",
                    "kind": "video",
                    "label": f"{height}p",
                    "height": height,
                    "extension": "mp4",
                    "detail": "MP4 · 自动合并声音",
                }
            )
    if not choices:
        choices.append(
            {
                "preset": "video-360",
                "kind": "video",
                "label": "360p",
                "height": 360,
                "extension": "mp4",
                "detail": "MP4 · 自动合并声音",
            }
        )
    choices.append(
        {
            "preset": "audio-mp3",
            "kind": "audio",
            "label": "MP3",
            "height": 0,
            "extension": "mp3",
            "detail": "高质量音频",
        }
    )
    return choices


@app.get("/")
async def root() -> dict:
    return {"service": "youtube-downloader-api", "version": APP_VERSION, "status": "ok"}


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "yt_dlp": bool(shutil.which("yt-dlp")),
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "node": bool(shutil.which("node")),
    }


@app.post("/api/resolve")
async def resolve_video(payload: ResolveRequest, request: Request) -> dict:
    enforce_rate_limit(request, scope="resolve", limit=12, window_seconds=60)
    video_id = extract_video_id(payload.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="链接格式不正确。")

    info = await extract_metadata(video_id)
    return {
        "videoId": video_id,
        "title": info.get("title") or "未命名视频",
        "uploader": info.get("uploader") or info.get("channel") or "频道信息未知",
        "duration": int(info.get("duration") or 0),
        "thumbnailUrl": info.get("thumbnail") or "",
        "formats": build_format_choices(info),
    }


def video_selector(height: int) -> str:
    return (
        f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
        f"best[height<={height}][ext=mp4]/"
        f"bestvideo[height<={height}]+bestaudio/"
        f"best[height<={height}]"
    )


@app.get("/api/download")
async def download_video(
    request: Request,
    video_id: str = Query(pattern=r"^[A-Za-z0-9_-]{11}$"),
    preset: str = Query(pattern=r"^(video-(1080|720|480|360)|audio-mp3)$"),
):
    enforce_rate_limit(request, scope="download", limit=4, window_seconds=600)
    if download_lock.locked():
        raise HTTPException(status_code=429, detail="服务器正在处理另一个文件，请稍后重试。")

    async with download_lock:
        info = await extract_metadata(video_id)
        work_dir = Path(tempfile.mkdtemp(prefix="youtube-download-"))
        output_template = str(work_dir / "%(title).120B [%(id)s].%(ext)s")

        if preset == "audio-mp3":
            format_args = [
                "--format",
                "bestaudio/best",
                "--extract-audio",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "2",
            ]
        else:
            height = int(preset.split("-", 1)[1])
            format_args = [
                "--format",
                video_selector(height),
                "--merge-output-format",
                "mp4",
            ]

        try:
            output = await run_ytdlp(
                [
                    *format_args,
                    "--max-filesize",
                    str(MAX_FILE_BYTES),
                    "--output",
                    output_template,
                    "--print",
                    "after_move:filepath",
                    "--",
                    canonical_url(video_id),
                ],
                timeout_seconds=MAX_JOB_SECONDS,
            )
            printed_paths = [Path(line) for line in output.splitlines() if line.strip()]
            candidates = [path for path in printed_paths if path.is_file()]
            if not candidates:
                candidates = [path for path in work_dir.iterdir() if path.is_file()]
            if not candidates:
                raise HTTPException(status_code=502, detail="文件处理完成，但没有生成可下载文件。")

            file_path = max(candidates, key=lambda path: path.stat().st_mtime)
            if file_path.stat().st_size > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="生成的文件超过 250 MB 上限。")

            media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            return FileResponse(
                path=file_path,
                media_type=media_type,
                filename=file_path.name,
                background=BackgroundTask(shutil.rmtree, work_dir, True),
            )
        except Exception:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise
