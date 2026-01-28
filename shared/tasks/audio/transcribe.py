"""
Audio transcription tasks.
Uses faster-whisper for optimized GPU inference.
"""

from typing import Optional, Generator

from ..decorator import task


# Model cache for faster-whisper
_faster_whisper_model = None


@task(
    name="audio.transcribe",
    tags=["audio", "text", "ai", "transcribe"],
    gpu="T4",
    timeout=600,
    chunk={
        "input": "audio_path",
        "default_size": "10m",
        "overlap": "5s",
        "merge": "concat_segments",
    },
)
def transcribe(
    audio_path: str,
    model_size: str = "large-v3",
    language: Optional[str] = None,
    word_timestamps: bool = True,
    vad_filter: bool = True,
    device: str = "cuda",
    compute_type: str = "float16",
) -> dict:
    """Transcribe audio using faster-whisper."""
    global _faster_whisper_model
    from faster_whisper import WhisperModel

    # Cache model
    if _faster_whisper_model is None or _faster_whisper_model.model_size != model_size:
        _faster_whisper_model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
        )

    segments, info = _faster_whisper_model.transcribe(
        audio_path,
        language=language,
        word_timestamps=word_timestamps,
        vad_filter=vad_filter,
    )

    result_segments = []
    all_words = []
    full_text_parts = []

    for segment in segments:
        seg_data = {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
        }

        if word_timestamps and segment.words:
            seg_data["words"] = [
                {
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                    "probability": w.probability,
                }
                for w in segment.words
            ]
            all_words.extend(seg_data["words"])

        result_segments.append(seg_data)
        full_text_parts.append(segment.text)

    return {
        "text": " ".join(full_text_parts).strip(),
        "segments": result_segments,
        "words": all_words if word_timestamps else [],
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
    }


@task(
    name="audio.transcribe_stream",
    tags=["audio", "text", "ai", "transcribe"],
    gpu="T4",
    timeout=600,
    streaming=True,
)
def transcribe_stream(
    audio_path: str,
    model_size: str = "large-v3",
    language: Optional[str] = None,
    device: str = "cuda",
) -> Generator[dict, None, None]:
    """Transcribe audio with streaming segment output."""
    global _faster_whisper_model
    from faster_whisper import WhisperModel

    if _faster_whisper_model is None or _faster_whisper_model.model_size != model_size:
        _faster_whisper_model = WhisperModel(
            model_size,
            device=device,
            compute_type="float16",
        )

    segments, info = _faster_whisper_model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        vad_filter=True,
    )

    for segment in segments:
        yield {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
            "words": [
                {"word": w.word, "start": w.start, "end": w.end}
                for w in (segment.words or [])
            ],
        }


@task(
    name="audio.detect_language",
    tags=["audio", "text", "ai", "transcribe"],
    gpu="T4",
    timeout=60,
)
def detect_language(
    audio_path: str,
    model_size: str = "base",
    device: str = "cuda",
) -> dict:
    """Detect spoken language in audio."""
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device=device, compute_type="float16")
    segments, info = model.transcribe(audio_path, task="detect_language")

    return {
        "language": info.language,
        "language_probability": info.language_probability,
    }


@task(
    name="audio.transcribe_openai",
    tags=["audio", "text", "ai", "transcribe"],
    gpu=None,
    timeout=300,
)
def transcribe_openai(
    audio_path: str,
    model: str = "whisper-1",
    language: Optional[str] = None,
    prompt: Optional[str] = None,
) -> str:
    """Transcribe audio using OpenAI Whisper API."""
    import openai

    kwargs = {"model": model}
    if language:
        kwargs["language"] = language
    if prompt:
        kwargs["prompt"] = prompt

    with open(audio_path, "rb") as f:
        response = openai.audio.transcriptions.create(file=f, **kwargs)

    return response.text


def clear_cache():
    """Clear model cache."""
    global _faster_whisper_model
    _faster_whisper_model = None
