"""
Resource tracking utilities for VRAM and memory management.
"""

import os
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class GpuInfo:
    """Information about a GPU."""
    index: int
    name: str
    vram_total: int  # MB
    vram_used: int  # MB
    vram_free: int  # MB
    utilization: float  # 0-100%


@dataclass
class ResourceSnapshot:
    """Snapshot of system resources."""
    gpus: list[GpuInfo] = field(default_factory=list)
    ram_total: int = 0  # MB
    ram_used: int = 0  # MB
    ram_free: int = 0  # MB

    @property
    def total_vram(self) -> int:
        return sum(g.vram_total for g in self.gpus)

    @property
    def used_vram(self) -> int:
        return sum(g.vram_used for g in self.gpus)

    @property
    def free_vram(self) -> int:
        return sum(g.vram_free for g in self.gpus)


def get_gpu_info() -> list[GpuInfo]:
    """Get GPU information using nvidia-smi or torch."""
    gpus = []

    try:
        import torch
        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(i)
                # Get memory info
                mem_total = props.total_memory // (1024 * 1024)  # MB
                mem_used = torch.cuda.memory_allocated(i) // (1024 * 1024)
                mem_free = mem_total - mem_used

                gpus.append(GpuInfo(
                    index=i,
                    name=props.name,
                    vram_total=mem_total,
                    vram_used=mem_used,
                    vram_free=mem_free,
                    utilization=0.0,  # torch doesn't provide this easily
                ))
    except ImportError:
        # Try nvidia-smi fallback
        try:
            import subprocess
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                for line in result.stdout.strip().split("\n"):
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 6:
                        gpus.append(GpuInfo(
                            index=int(parts[0]),
                            name=parts[1],
                            vram_total=int(parts[2]),
                            vram_used=int(parts[3]),
                            vram_free=int(parts[4]),
                            utilization=float(parts[5]),
                        ))
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    return gpus


def get_ram_info() -> tuple[int, int, int]:
    """Get RAM info (total, used, free) in MB."""
    try:
        import psutil
        mem = psutil.virtual_memory()
        return (
            mem.total // (1024 * 1024),
            mem.used // (1024 * 1024),
            mem.available // (1024 * 1024),
        )
    except ImportError:
        # Fallback to /proc/meminfo on Linux
        try:
            with open("/proc/meminfo") as f:
                info = {}
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2:
                        key = parts[0].rstrip(":")
                        value = int(parts[1]) // 1024  # kB to MB
                        info[key] = value

                total = info.get("MemTotal", 0)
                free = info.get("MemAvailable", info.get("MemFree", 0))
                used = total - free
                return total, used, free
        except FileNotFoundError:
            return 0, 0, 0


def get_resources() -> ResourceSnapshot:
    """Get current resource snapshot."""
    gpus = get_gpu_info()
    ram_total, ram_used, ram_free = get_ram_info()

    return ResourceSnapshot(
        gpus=gpus,
        ram_total=ram_total,
        ram_used=ram_used,
        ram_free=ram_free,
    )


def check_vram_available(required_mb: int, gpu_index: int = 0) -> bool:
    """Check if enough VRAM is available."""
    gpus = get_gpu_info()
    if gpu_index < len(gpus):
        return gpus[gpu_index].vram_free >= required_mb
    return False


def check_ram_available(required_mb: int) -> bool:
    """Check if enough RAM is available."""
    _, _, ram_free = get_ram_info()
    return ram_free >= required_mb


# VRAM requirements for common models (in MB)
MODEL_VRAM_REQUIREMENTS = {
    # Whisper
    "whisper-tiny": 1000,
    "whisper-base": 1000,
    "whisper-small": 2000,
    "whisper-medium": 5000,
    "whisper-large": 10000,
    "whisper-large-v3": 10000,

    # Vision models
    "yolov8n": 500,
    "yolov8s": 1000,
    "yolov8m": 2000,
    "yolov8l": 4000,
    "yolov8x": 8000,
    "sam2-tiny": 4000,
    "sam2-small": 6000,
    "sam2-base": 8000,
    "sam2-large": 12000,
    "florence-2-base": 4000,
    "florence-2-large": 8000,
    "depth-anything-small": 2000,
    "depth-anything-base": 4000,
    "depth-anything-large": 8000,
    "siglip-base": 2000,
    "siglip-large": 4000,
    "insightface": 2000,

    # TTS models
    "chatterbox-turbo": 7000,
    "chatterbox-multilingual": 11000,
    "sesame-csm": 5000,

    # Image generation
    "stable-diffusion-1.5": 4000,
    "stable-diffusion-xl": 12000,
    "sdxl-turbo": 8000,

    # Embeddings
    "e5-large": 2000,
    "e5-base": 1000,
}


def get_model_vram(model_name: str) -> int:
    """Get VRAM requirement for a model in MB."""
    # Normalize model name
    model_lower = model_name.lower()

    # Check exact match first
    if model_lower in MODEL_VRAM_REQUIREMENTS:
        return MODEL_VRAM_REQUIREMENTS[model_lower]

    # Check partial matches
    for key, vram in MODEL_VRAM_REQUIREMENTS.items():
        if key in model_lower or model_lower in key:
            return vram

    # Default fallback
    return 4000  # Assume 4GB if unknown


class ResourceTracker:
    """
    Track resource usage across task executions.

    Usage:
        tracker = ResourceTracker()

        with tracker.track_task("whisper-large-v3"):
            result = transcribe_faster(audio_path)

        print(tracker.peak_vram)  # Peak VRAM during execution
    """

    def __init__(self):
        self.tasks: list[dict] = []
        self.peak_vram: int = 0
        self.peak_ram: int = 0
        self._current_task: Optional[str] = None

    def track_task(self, task_name: str, model: Optional[str] = None):
        """Context manager for tracking a task."""
        return _TaskTracker(self, task_name, model)

    def record(self, task_name: str, model: Optional[str], vram_before: int,
               vram_after: int, ram_before: int, ram_after: int,
               duration: float, error: Optional[str] = None):
        """Record task execution stats."""
        vram_delta = vram_after - vram_before
        ram_delta = ram_after - ram_before

        self.tasks.append({
            "task": task_name,
            "model": model,
            "vram_before": vram_before,
            "vram_after": vram_after,
            "vram_delta": vram_delta,
            "ram_before": ram_before,
            "ram_after": ram_after,
            "ram_delta": ram_delta,
            "duration": duration,
            "error": error,
        })

        self.peak_vram = max(self.peak_vram, vram_after)
        self.peak_ram = max(self.peak_ram, ram_after)

    def summary(self) -> dict:
        """Get summary of tracked tasks."""
        return {
            "total_tasks": len(self.tasks),
            "peak_vram_mb": self.peak_vram,
            "peak_ram_mb": self.peak_ram,
            "tasks": self.tasks,
        }

    def reset(self):
        """Reset tracker."""
        self.tasks = []
        self.peak_vram = 0
        self.peak_ram = 0


class _TaskTracker:
    """Context manager for tracking a single task."""

    def __init__(self, tracker: ResourceTracker, task_name: str, model: Optional[str]):
        self.tracker = tracker
        self.task_name = task_name
        self.model = model
        self.vram_before = 0
        self.ram_before = 0
        self.start_time = 0.0

    def __enter__(self):
        import time
        self.start_time = time.time()
        snapshot = get_resources()
        self.vram_before = snapshot.used_vram
        self.ram_before = snapshot.ram_used
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        import time
        duration = time.time() - self.start_time
        snapshot = get_resources()

        self.tracker.record(
            self.task_name,
            self.model,
            self.vram_before,
            snapshot.used_vram,
            self.ram_before,
            snapshot.ram_used,
            duration,
            str(exc_val) if exc_val else None,
        )

        return False  # Don't suppress exceptions
