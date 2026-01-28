"""
Text chunking tasks.
"""

from typing import Optional

from ..decorator import task


@task(
    name="chunk.text",
    tags=["text", "generic", "transform"],
    gpu=None,
    timeout=60,
)
def text(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 100,
    separator: str = "\n\n",
) -> list[dict]:
    """Split text into overlapping chunks."""
    if len(text) <= chunk_size:
        return [{"index": 0, "text": text, "start": 0, "end": len(text)}]

    chunks = []
    start = 0
    index = 0

    while start < len(text):
        end = start + chunk_size

        # Try to find a separator near the end
        if end < len(text):
            sep_pos = text.rfind(separator, start, end)
            if sep_pos > start:
                end = sep_pos + len(separator)

        chunk_text = text[start:end]
        chunks.append({
            "index": index,
            "text": chunk_text,
            "start": start,
            "end": end,
        })

        start = end - overlap
        index += 1

    return chunks


@task(
    name="chunk.sentences",
    tags=["text", "generic", "transform"],
    gpu=None,
    timeout=60,
)
def sentences(
    text: str,
    max_sentences: int = 5,
    overlap_sentences: int = 1,
) -> list[dict]:
    """Split text into sentence-based chunks."""
    import re

    # Simple sentence splitting
    sentence_pattern = r'(?<=[.!?])\s+'
    sents = re.split(sentence_pattern, text)

    if len(sents) <= max_sentences:
        return [{"index": 0, "sentences": sents, "text": text}]

    chunks = []
    index = 0
    i = 0

    while i < len(sents):
        chunk_sents = sents[i:i + max_sentences]
        chunks.append({
            "index": index,
            "sentences": chunk_sents,
            "text": " ".join(chunk_sents),
        })

        i += max_sentences - overlap_sentences
        index += 1

    return chunks
