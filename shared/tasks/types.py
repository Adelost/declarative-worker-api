"""
Type definitions for the task decorator system.
"""

from dataclasses import dataclass, field
from typing import Callable, Optional, Any, Generator, Type

# Optional Pydantic support
try:
    from pydantic import BaseModel
    HAS_PYDANTIC = True
except ImportError:
    BaseModel = None  # type: ignore
    HAS_PYDANTIC = False


@dataclass
class ChunkConfig:
    """Configuration for chunking long-running tasks."""

    input_field: str
    """The payload field containing the input to chunk (e.g., 'audio_path')."""

    default_size: str
    """Default chunk size (e.g., '10m' for 10 minutes, '1h' for 1 hour)."""

    overlap: str = "0s"
    """Overlap between chunks (e.g., '5s' for 5 seconds)."""

    merge_strategy: str = "concat"
    """How to merge results: 'concat', 'concat_segments', 'aggregate'."""


@dataclass
class TaskMeta:
    """Metadata for a registered task."""

    name: str
    """Task name (e.g., 'audio.transcribe')."""

    func: Callable[..., Any]
    """The actual task function."""

    tags: list[str] = field(default_factory=list)
    """Task tags (e.g., ['audio', 'text', 'ai', 'gpu'])."""

    gpu: Optional[str] = None
    """GPU type required (None, 'T4', 'A10G', 'A100')."""

    timeout: int = 300
    """Task timeout in seconds."""

    streaming: bool = False
    """Whether this task yields results incrementally."""

    chunk: Optional[ChunkConfig] = None
    """Chunking configuration for long-running tasks."""

    description: str = ""
    """Task description (from docstring)."""

    input_schema: Optional[Type] = None
    """Optional Pydantic model for input validation."""

    output_schema: Optional[Type] = None
    """Optional Pydantic model for output validation."""

    @property
    def is_gpu_task(self) -> bool:
        """Check if task requires GPU."""
        return self.gpu is not None

    @property
    def is_chunked(self) -> bool:
        """Check if task supports chunking."""
        return self.chunk is not None

    def has_tag(self, tag: str) -> bool:
        """Check if task has a specific tag."""
        return tag in self.tags

    def has_all_tags(self, tags: list[str]) -> bool:
        """Check if task has all specified tags."""
        return all(t in self.tags for t in tags)

    def has_any_tag(self, tags: list[str]) -> bool:
        """Check if task has any of the specified tags."""
        return any(t in self.tags for t in tags)

    @property
    def has_schema(self) -> bool:
        """Check if task has Pydantic schemas for validation."""
        return self.input_schema is not None

    def validate_input(self, data: dict) -> Any:
        """Validate input data against schema (if defined)."""
        if self.input_schema and HAS_PYDANTIC and issubclass(self.input_schema, BaseModel):
            return self.input_schema.model_validate(data)
        return data

    def validate_output(self, data: Any) -> Any:
        """Validate output data against schema (if defined)."""
        if self.output_schema and HAS_PYDANTIC and issubclass(self.output_schema, BaseModel):
            if isinstance(data, self.output_schema):
                return data
            return self.output_schema.model_validate(data)
        return data

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        result = {
            "name": self.name,
            "tags": self.tags,
            "gpu": self.gpu,
            "timeout": self.timeout,
            "streaming": self.streaming,
            "chunk": {
                "input_field": self.chunk.input_field,
                "default_size": self.chunk.default_size,
                "overlap": self.chunk.overlap,
                "merge_strategy": self.chunk.merge_strategy,
            } if self.chunk else None,
            "description": self.description,
        }

        # Add JSON Schema if Pydantic models are defined
        if self.input_schema and HAS_PYDANTIC and issubclass(self.input_schema, BaseModel):
            result["input_schema"] = self.input_schema.model_json_schema()
        if self.output_schema and HAS_PYDANTIC and issubclass(self.output_schema, BaseModel):
            result["output_schema"] = self.output_schema.model_json_schema()

        return result
