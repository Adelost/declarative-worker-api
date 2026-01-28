"""
Scene detection tasks.
"""

from typing import Optional

from ..decorator import task


@task(
    name="video.detect_scenes",
    tags=["video", "ai", "detect"],
    gpu="T4",
    timeout=600,
)
def detect(
    video_path: str,
    threshold: float = 0.3,
    min_scene_len: int = 10,
    fps: float = 1.0,
    device: str = "cuda",
) -> list[dict]:
    """Detect scene changes in video."""
    import numpy as np

    # Extract frames first
    from .extract import extract_frames
    frames = extract_frames(video_path, fps=fps)

    if not frames:
        return []

    # Get embeddings for similarity comparison
    from tasks.vision import siglip
    embeddings = siglip.embed_batch(frames, device=device)

    # Compute frame-to-frame similarity
    embeddings_np = np.array(embeddings)
    similarities = []
    for i in range(1, len(embeddings_np)):
        sim = np.dot(embeddings_np[i], embeddings_np[i - 1])
        similarities.append(float(sim))

    # Find scene boundaries
    scenes = []
    current_start = 0

    for i, sim in enumerate(similarities):
        if sim < (1 - threshold):
            if i - current_start >= min_scene_len:
                scenes.append({
                    "start_frame": current_start,
                    "end_frame": i,
                    "start_time": current_start / fps,
                    "end_time": i / fps,
                    "duration": (i - current_start) / fps,
                })
            current_start = i + 1

    # Add final scene
    if len(frames) - current_start >= min_scene_len:
        scenes.append({
            "start_frame": current_start,
            "end_frame": len(frames) - 1,
            "start_time": current_start / fps,
            "end_time": (len(frames) - 1) / fps,
            "duration": (len(frames) - 1 - current_start) / fps,
        })

    return scenes
