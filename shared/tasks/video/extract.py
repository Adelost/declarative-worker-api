"""
Video analysis pipeline tasks.
"""

from typing import Optional
import os

from ..decorator import task


@task(
    name="video.analyze",
    tags=["video", "generic", "extract"],
    gpu="T4",
    timeout=1800,
)
def full(
    video_path: str,
    tracks: Optional[list[str]] = None,
    fps: float = 1.0,
    max_frames: Optional[int] = None,
    device: str = "cuda",
) -> dict:
    """Full video analysis pipeline."""
    # Import the original implementation
    from tasks.video import analyze as video_analyze
    return video_analyze.analyze(
        video_path=video_path,
        tracks=tracks,
        fps=fps,
        max_frames=max_frames,
        device=device,
    )


@task(
    name="video.analyze_quick",
    tags=["video", "generic", "extract"],
    gpu="T4",
    timeout=600,
)
def quick(
    video_path: str,
    device: str = "cuda",
) -> dict:
    """Quick video analysis - visual + audio only."""
    return full(
        video_path=video_path,
        tracks=["visual", "audio"],
        fps=0.5,
        max_frames=100,
        device=device,
    )


@task(
    name="video.extract_frames",
    tags=["video", "generic", "extract"],
    gpu=None,
    timeout=300,
)
def extract_frames(
    video_path: str,
    output_dir: Optional[str] = None,
    fps: float = 1.0,
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
) -> list[str]:
    """Extract frames from video."""
    import subprocess
    import glob
    import time

    if output_dir is None:
        output_dir = f"/tmp/frames_{int(time.time())}"

    os.makedirs(output_dir, exist_ok=True)

    cmd = ["ffmpeg", "-i", video_path]

    if start_time:
        cmd.extend(["-ss", str(start_time)])
    if end_time:
        cmd.extend(["-t", str(end_time - (start_time or 0))])

    cmd.extend([
        "-vf", f"fps={fps}",
        "-q:v", "2",
        os.path.join(output_dir, "frame_%06d.jpg"),
    ])

    subprocess.run(cmd, check=True, capture_output=True)

    frames = sorted(glob.glob(os.path.join(output_dir, "frame_*.jpg")))
    return frames


@task(
    name="video.extract_audio",
    tags=["video", "generic", "extract"],
    gpu=None,
    timeout=300,
)
def extract_audio(
    video_path: str,
    output_path: Optional[str] = None,
    output_format: str = "wav",
) -> str:
    """Extract audio from video."""
    import subprocess
    import time

    if output_path is None:
        output_path = f"/tmp/audio_{int(time.time())}.{output_format}"

    cmd = [
        "ffmpeg", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le" if output_format == "wav" else "libmp3lame",
        "-ar", "16000", "-ac", "1",
        "-y", output_path,
    ]

    subprocess.run(cmd, check=True, capture_output=True)
    return output_path
