"""
Shared task implementations for declarative-worker-api.

Tasks are organized by DATA TYPE and use tags for flexible filtering.

Data types:
- video/    Video processing (extract frames, transcode, scene detection)
- audio/    Audio processing (convert, transcribe, TTS, diarize)
- image/    Image processing (transform, detect objects)
- text/     Text processing (chunk, LLM)
- data/     Data operations (fetch, RSS, semantic search)

Tags describe task properties:
- Data type: video, audio, image, text, data
- Operation: transform, extract, embed, search, generate, detect, convert
- AI/Generic: ai, generic
- Resources: gpu, streaming

Example filtering:
    filter_by_tag("gpu")           # All GPU tasks
    filter_by_tag("audio")         # All audio-related tasks
    filter_by_tags(["ai", "image"]) # AI tasks for images
"""

from .decorator import (
    task,
    get_task,
    list_tasks,
    filter_by_tag,
    filter_by_tags,
    list_gpu_tasks,
    list_ai_tasks,
    STANDARD_TAGS,
)
from .discovery import discover_tasks, reset_discovery

__all__ = [
    "task",
    "get_task",
    "list_tasks",
    "filter_by_tag",
    "filter_by_tags",
    "list_gpu_tasks",
    "list_ai_tasks",
    "discover_tasks",
    "reset_discovery",
    "STANDARD_TAGS",
]
