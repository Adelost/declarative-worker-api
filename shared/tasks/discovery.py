"""
Auto-discovery and import of task modules.

Usage:
    from tasks.discovery import ensure_discovered

    ensure_discovered()  # Import all task modules to trigger registration
"""

import importlib
import pkgutil
import logging
from pathlib import Path
from typing import Optional

from .decorator import TASK_DIRECTORIES, get_registry


logger = logging.getLogger(__name__)

_discovered = False


def discover_tasks(base_path: Optional[Path] = None) -> int:
    """
    Import all task modules to trigger @task decorator registration.

    Args:
        base_path: Base path for task modules (defaults to this directory)

    Returns:
        Number of tasks discovered
    """
    global _discovered

    if base_path is None:
        base_path = Path(__file__).parent

    count_before = len(get_registry())
    errors = []

    for directory in TASK_DIRECTORIES:
        dir_path = base_path / directory

        if not dir_path.exists():
            logger.debug(f"Task directory not found: {directory}")
            continue

        if not dir_path.is_dir():
            continue

        # Import all modules in directory
        for module_info in pkgutil.iter_modules([str(dir_path)]):
            if module_info.name.startswith("_"):
                continue

            module_name = f"tasks.{directory}.{module_info.name}"
            try:
                importlib.import_module(module_name)
                logger.debug(f"Imported: {module_name}")
            except ImportError as e:
                errors.append((module_name, str(e)))
                logger.warning(f"Failed to import {module_name}: {e}")
            except Exception as e:
                errors.append((module_name, str(e)))
                logger.error(f"Error importing {module_name}: {e}")

    _discovered = True
    count_after = len(get_registry())

    if errors:
        logger.warning(f"Discovery completed with {len(errors)} errors")

    return count_after - count_before


def ensure_discovered() -> None:
    """Ensure all tasks have been discovered. Safe to call multiple times."""
    global _discovered
    if not _discovered:
        discover_tasks()


def is_discovered() -> bool:
    """Check if discovery has been performed."""
    return _discovered


def reset_discovery() -> None:
    """Reset discovery state (for testing)."""
    global _discovered
    _discovered = False
