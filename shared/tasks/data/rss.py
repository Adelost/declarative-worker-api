"""
RSS feed tasks.
"""

from typing import Optional

from ..decorator import task


@task(
    name="rss.fetch",
    tags=["data", "generic"],
    gpu=None,
    timeout=60,
)
def fetch(
    feed_url: str,
    limit: Optional[int] = None,
) -> list[dict]:
    """Fetch and parse RSS feed."""
    import feedparser

    feed = feedparser.parse(feed_url)

    entries = []
    for entry in feed.entries[:limit] if limit else feed.entries:
        entries.append({
            "title": entry.get("title"),
            "link": entry.get("link"),
            "published": entry.get("published"),
            "summary": entry.get("summary"),
            "author": entry.get("author"),
        })

    return entries
