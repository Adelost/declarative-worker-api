"""
Format conversion tasks.
"""

from typing import Optional

from ..decorator import task


@task(
    name="audio.convert",
    tags=["audio", "generic", "convert"],
    gpu=None,
    timeout=300,
)
def audio(
    input_path: str,
    output_format: str = "mp3",
    output_path: Optional[str] = None,
    sample_rate: Optional[int] = None,
    channels: Optional[int] = None,
) -> str:
    """Convert audio to different format."""
    import subprocess
    import time

    if output_path is None:
        output_path = f"/tmp/converted_{int(time.time())}.{output_format}"

    cmd = ["ffmpeg", "-i", input_path, "-y"]

    if sample_rate:
        cmd.extend(["-ar", str(sample_rate)])
    if channels:
        cmd.extend(["-ac", str(channels)])

    cmd.append(output_path)

    subprocess.run(cmd, check=True, capture_output=True)
    return output_path


@task(
    name="video.convert",
    tags=["video", "generic", "convert"],
    gpu=None,
    timeout=600,
)
def video(
    input_path: str,
    output_format: str = "mp4",
    output_path: Optional[str] = None,
    resolution: Optional[str] = None,
    codec: Optional[str] = None,
) -> str:
    """Convert video to different format."""
    import subprocess
    import time

    if output_path is None:
        output_path = f"/tmp/converted_{int(time.time())}.{output_format}"

    cmd = ["ffmpeg", "-i", input_path, "-y"]

    if resolution:
        cmd.extend(["-s", resolution])
    if codec:
        cmd.extend(["-c:v", codec])

    cmd.append(output_path)

    subprocess.run(cmd, check=True, capture_output=True)
    return output_path
