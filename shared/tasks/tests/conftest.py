"""
Pytest configuration for shared tasks tests.
"""

import sys
from pathlib import Path

# Add parent directory to path so we can import tasks
tasks_dir = Path(__file__).parent.parent
sys.path.insert(0, str(tasks_dir))


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line("markers", "gpu: marks tests as requiring GPU")
    config.addinivalue_line("markers", "slow: marks tests as slow running")
