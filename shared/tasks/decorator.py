"""
Task decorator and registry for auto-registration.

Usage:
    from tasks.decorator import task

    @task(
        name="image.detect",
        tags=["image", "ai", "gpu", "detect"],
        gpu="T4",
    )
    def detect(image_path: str, conf: float = 0.25) -> list[dict]:
        ...
"""

from typing import Callable, Optional, Any, Union, Type
from functools import wraps

from .types import TaskMeta, ChunkConfig


# Global task registry
_TASK_REGISTRY: dict[str, TaskMeta] = {}


# Standard tags for consistency
STANDARD_TAGS = {
    # Data types
    "video", "audio", "image", "text", "data",
    # Operations
    "transform", "extract", "embed", "search", "generate", "detect", "convert",
    # AI vs generic
    "ai", "generic",
    # Resources
    "gpu", "cpu", "streaming",
}


def task(
    name: str,
    tags: list[str] = None,
    gpu: Optional[str] = None,
    timeout: int = 300,
    streaming: bool = False,
    chunk: Optional[Union[dict, ChunkConfig]] = None,
    input: Optional[Type] = None,
    output: Optional[Type] = None,
) -> Callable:
    """
    Decorator to register a task function.

    Args:
        name: Task name (e.g., 'audio.transcribe')
        tags: List of tags (e.g., ['audio', 'text', 'ai', 'gpu'])
        gpu: GPU type required (None, 'T4', 'A10G', 'A100')
        timeout: Task timeout in seconds
        streaming: Whether this task yields results incrementally
        chunk: Chunking configuration for long-running tasks
        input: Optional Pydantic model for input validation
        output: Optional Pydantic model for output validation

    Returns:
        Decorated function with _task_meta attribute

    Example (simple):
        @task(name="image.detect", tags=["image", "ai"], gpu="T4")
        def detect(image_path: str, conf: float = 0.25) -> list[dict]:
            ...

    Example (with Pydantic validation):
        class DetectInput(BaseModel):
            image_path: str
            confidence: float = 0.5

        class DetectOutput(BaseModel):
            detections: list[dict]

        @task(name="image.detect", tags=["image", "ai"], gpu="T4",
              input=DetectInput, output=DetectOutput)
        def detect(input: DetectInput) -> DetectOutput:
            ...
    """
    tags = tags or []

    # Auto-add gpu tag if gpu is specified
    if gpu and "gpu" not in tags:
        tags = tags + ["gpu"]

    # Auto-add streaming tag if streaming
    if streaming and "streaming" not in tags:
        tags = tags + ["streaming"]

    # Convert dict to ChunkConfig if needed
    chunk_config = None
    if chunk is not None:
        if isinstance(chunk, dict):
            chunk_config = ChunkConfig(
                input_field=chunk.get("input", chunk.get("input_field", "")),
                default_size=chunk.get("default_size", "10m"),
                overlap=chunk.get("overlap", "0s"),
                merge_strategy=chunk.get("merge", chunk.get("merge_strategy", "concat")),
            )
        else:
            chunk_config = chunk

    def decorator(func: Callable) -> Callable:
        # Extract description from docstring
        description = ""
        if func.__doc__:
            # Get first line of docstring
            lines = func.__doc__.strip().split("\n")
            description = lines[0].strip()

        # Create metadata
        meta = TaskMeta(
            name=name,
            func=func,
            tags=tags,
            gpu=gpu,
            timeout=timeout,
            streaming=streaming,
            chunk=chunk_config,
            description=description,
            input_schema=input,
            output_schema=output,
        )

        # Register task
        _TASK_REGISTRY[name] = meta

        # Attach metadata to function
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)

        wrapper._task_meta = meta
        return wrapper

    return decorator


def get_registry() -> dict[str, TaskMeta]:
    """Get the global task registry."""
    return _TASK_REGISTRY


def get_task(name: str) -> Optional[TaskMeta]:
    """Get a task by name."""
    return _TASK_REGISTRY.get(name)


def list_tasks() -> list[TaskMeta]:
    """List all registered tasks."""
    return list(_TASK_REGISTRY.values())


def filter_by_tag(tag: str) -> list[TaskMeta]:
    """List all tasks with a specific tag."""
    return [t for t in list_tasks() if t.has_tag(tag)]


def filter_by_tags(tags: list[str], match_all: bool = True) -> list[TaskMeta]:
    """
    List tasks matching tags.

    Args:
        tags: Tags to filter by
        match_all: If True, task must have ALL tags. If False, ANY tag matches.
    """
    if match_all:
        return [t for t in list_tasks() if t.has_all_tags(tags)]
    else:
        return [t for t in list_tasks() if t.has_any_tag(tags)]


def list_gpu_tasks() -> list[TaskMeta]:
    """List all tasks requiring GPU."""
    return filter_by_tag("gpu")


def list_streaming_tasks() -> list[TaskMeta]:
    """List all streaming tasks."""
    return filter_by_tag("streaming")


def list_ai_tasks() -> list[TaskMeta]:
    """List all AI tasks."""
    return filter_by_tag("ai")


def list_chunked_tasks() -> list[TaskMeta]:
    """List all tasks with chunking support."""
    return [t for t in list_tasks() if t.is_chunked]


def clear_registry() -> None:
    """Clear the task registry (for testing)."""
    _TASK_REGISTRY.clear()


# Directories to scan for tasks
TASK_DIRECTORIES = [
    "video",
    "audio",
    "image",
    "text",
    "data",
]
