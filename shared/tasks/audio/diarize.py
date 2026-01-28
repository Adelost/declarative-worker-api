"""
Speaker diarization tasks.
Uses pyannote for speaker identification.
"""

from typing import Optional

from ..decorator import task


@task(
    name="diarize.speakers",
    tags=["audio", "ai", "diarize"],
    gpu="T4",
    timeout=600,
)
def speakers(
    audio_path: str,
    num_speakers: Optional[int] = None,
) -> list[dict]:
    """Speaker diarization - identify who speaks when."""
    from pyannote.audio import Pipeline

    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")

    kwargs = {}
    if num_speakers:
        kwargs["num_speakers"] = num_speakers

    diarization = pipeline(audio_path, **kwargs)

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "start": turn.start,
            "end": turn.end,
            "speaker": speaker,
        })

    return segments


@task(
    name="diarize.with_transcript",
    tags=["audio", "ai", "diarize"],
    gpu="T4",
    timeout=900,
)
def with_transcript(
    audio_path: str,
    model_size: str = "large-v3",
    num_speakers: Optional[int] = None,
    device: str = "cuda",
) -> dict:
    """Transcribe audio with speaker diarization."""
    from .whisper import transcribe
    from pyannote.audio import Pipeline

    # Get transcription with word timestamps
    transcription = transcribe(
        audio_path,
        model_size=model_size,
        word_timestamps=True,
        device=device,
    )

    # Get diarization
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
    kwargs = {}
    if num_speakers:
        kwargs["num_speakers"] = num_speakers
    diarization = pipeline(audio_path, **kwargs)

    diarization_segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        diarization_segments.append({
            "start": turn.start,
            "end": turn.end,
            "speaker": speaker,
        })

    # Assign speakers to words based on timestamps
    def get_speaker_at_time(t: float) -> Optional[str]:
        for seg in diarization_segments:
            if seg["start"] <= t <= seg["end"]:
                return seg["speaker"]
        return None

    # Assign speakers to transcript segments
    for segment in transcription["segments"]:
        mid_time = (segment["start"] + segment["end"]) / 2
        segment["speaker"] = get_speaker_at_time(mid_time)

        if "words" in segment:
            for word in segment["words"]:
                word_mid = (word["start"] + word["end"]) / 2
                word["speaker"] = get_speaker_at_time(word_mid)

    transcription["speakers"] = list(set(
        s["speaker"] for s in diarization_segments
    ))
    transcription["diarization"] = diarization_segments

    return transcription
