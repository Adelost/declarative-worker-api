"""
File download tasks.
"""

from typing import Optional, Callable
import os

from ..decorator import task


@task(
    name="download.file",
    tags=["data", "generic", "fetch"],
    gpu=None,
    timeout=300,
)
def file(
    url: str,
    output_path: Optional[str] = None,
    output_dir: Optional[str] = None,
    timeout: int = 300,
) -> str:
    """Download a file from URL."""
    import requests
    from urllib.parse import urlparse, unquote
    import time

    if output_path is None:
        parsed = urlparse(url)
        filename = unquote(os.path.basename(parsed.path)) or f"download_{int(time.time())}"

        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, filename)
        else:
            output_path = os.path.join("/tmp", filename)

    response = requests.get(url, stream=True, timeout=timeout)
    response.raise_for_status()

    with open(output_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    return output_path


@task(
    name="download.youtube",
    tags=["data", "generic", "fetch"],
    gpu=None,
    timeout=600,
)
def youtube(
    url: str,
    output_dir: str = "/tmp",
    format: str = "bestaudio",
    extract_audio: bool = True,
) -> dict:
    """Download video/audio from YouTube."""
    import yt_dlp

    os.makedirs(output_dir, exist_ok=True)

    ydl_opts = {
        "format": format,
        "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
    }

    if extract_audio:
        ydl_opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }]

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

        if extract_audio:
            output_path = os.path.join(output_dir, f"{info['title']}.mp3")
        else:
            output_path = os.path.join(output_dir, f"{info['title']}.{info['ext']}")

    return {
        "path": output_path,
        "title": info.get("title"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader"),
        "description": info.get("description"),
        "thumbnail": info.get("thumbnail"),
    }


@task(
    name="download.batch",
    tags=["data", "generic", "fetch"],
    gpu=None,
    timeout=900,
)
def batch(
    urls: list[str],
    output_dir: str = "/tmp",
) -> list[str]:
    """Download multiple files."""
    paths = []
    for url in urls:
        path = file(url, output_dir=output_dir)
        paths.append(path)
    return paths
