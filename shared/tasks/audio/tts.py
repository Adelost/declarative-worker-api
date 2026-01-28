"""
ElevenLabs TTS tasks.
High-quality voice synthesis with cloning support.
"""

from typing import Optional
import os

from ..decorator import task


@task(
    name="elevenlabs.synthesize",
    tags=["audio", "text", "ai", "generate", "tts"],
    gpu=None,
    timeout=120,
)
def synthesize(
    text: str,
    voice_id: str = "21m00Tcm4TlvDq8ikWAM",  # Rachel
    model_id: str = "eleven_multilingual_v2",
    stability: float = 0.5,
    similarity_boost: float = 0.75,
    output_path: Optional[str] = None,
) -> str:
    """Synthesize speech using ElevenLabs."""
    import requests
    import time

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise ValueError("ELEVENLABS_API_KEY environment variable not set")

    if output_path is None:
        output_path = f"/tmp/tts_elevenlabs_{int(time.time())}.mp3"

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key,
    }

    data = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": stability,
            "similarity_boost": similarity_boost,
        },
    }

    response = requests.post(url, json=data, headers=headers)
    response.raise_for_status()

    with open(output_path, "wb") as f:
        f.write(response.content)

    return output_path


@task(
    name="elevenlabs.clone_voice",
    tags=["audio", "text", "ai", "generate", "tts"],
    gpu=None,
    timeout=300,
)
def clone_voice(
    name: str,
    audio_paths: list[str],
    description: str = "",
) -> str:
    """Clone a voice from audio samples."""
    import requests

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise ValueError("ELEVENLABS_API_KEY environment variable not set")

    url = "https://api.elevenlabs.io/v1/voices/add"
    headers = {"xi-api-key": api_key}

    files = []
    for path in audio_paths:
        files.append(("files", open(path, "rb")))

    data = {
        "name": name,
        "description": description,
    }

    response = requests.post(url, headers=headers, data=data, files=files)
    response.raise_for_status()

    # Close file handles
    for _, f in files:
        f.close()

    return response.json()["voice_id"]


def list_voices() -> list[dict]:
    """List available ElevenLabs voices."""
    import requests

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise ValueError("ELEVENLABS_API_KEY environment variable not set")

    url = "https://api.elevenlabs.io/v1/voices"
    headers = {"xi-api-key": api_key}

    response = requests.get(url, headers=headers)
    response.raise_for_status()

    data = response.json()

    return [
        {
            "id": v["voice_id"],
            "name": v["name"],
            "description": v.get("description", ""),
            "labels": v.get("labels", {}),
        }
        for v in data.get("voices", [])
    ]
"""
OpenAI TTS tasks.
Cloud-based text-to-speech synthesis.
"""

from typing import Optional

from ..decorator import task


@task(
    name="openai.tts",
    tags=["audio", "text", "ai", "generate", "tts"],
    gpu=None,
    timeout=120,
)
def synthesize(
    text: str,
    voice: str = "alloy",
    model: str = "tts-1",
    speed: float = 1.0,
    output_path: Optional[str] = None,
) -> str:
    """Synthesize speech using OpenAI TTS."""
    import openai
    import time

    if output_path is None:
        output_path = f"/tmp/tts_openai_{int(time.time())}.mp3"

    response = openai.audio.speech.create(
        model=model,
        voice=voice,
        input=text,
        speed=speed,
    )

    response.stream_to_file(output_path)
    return output_path


@task(
    name="openai.tts_hd",
    tags=["audio", "text", "ai", "generate", "tts"],
    gpu=None,
    timeout=120,
)
def synthesize_hd(
    text: str,
    voice: str = "alloy",
    speed: float = 1.0,
    output_path: Optional[str] = None,
) -> str:
    """Synthesize high-quality speech using OpenAI TTS-HD."""
    return synthesize(
        text=text,
        voice=voice,
        model="tts-1-hd",
        speed=speed,
        output_path=output_path,
    )


def list_voices() -> list[dict]:
    """List available OpenAI TTS voices."""
    return [
        {"id": "alloy", "name": "Alloy", "description": "Neutral, balanced"},
        {"id": "echo", "name": "Echo", "description": "Male, warm"},
        {"id": "fable", "name": "Fable", "description": "British, storyteller"},
        {"id": "onyx", "name": "Onyx", "description": "Male, deep"},
        {"id": "nova", "name": "Nova", "description": "Female, energetic"},
        {"id": "shimmer", "name": "Shimmer", "description": "Female, soft"},
    ]
"""
Chatterbox TTS tasks.
Local multilingual TTS with voice cloning (GPU required).
"""

from typing import Optional

from ..decorator import task


# Global model cache
_model = None
_model_type = None


def _get_model(model_type: str = "multilingual", device: str = "cuda"):
    """Get or create Chatterbox model."""
    global _model, _model_type

    if _model is None or _model_type != model_type:
        if _model is not None:
            del _model
            import torch
            torch.cuda.empty_cache()

        from chatterbox.tts import ChatterboxTTS

        if model_type == "turbo":
            _model = ChatterboxTTS.from_pretrained("chatterbox-turbo", device=device)
        else:
            _model = ChatterboxTTS.from_pretrained("chatterbox-multilingual", device=device)

        _model_type = model_type

    return _model


@task(
    name="chatterbox.synthesize",
    tags=["audio", "text", "ai", "generate", "tts"],
    gpu="A10G",
    timeout=300,
)
def synthesize(
    text: str,
    voice_ref: Optional[str] = None,
    lang: str = "en",
    exaggeration: float = 0.5,
    cfg_weight: float = 0.5,
    temperature: float = 0.8,
    model_type: str = "multilingual",
    device: str = "cuda",
    output_path: Optional[str] = None,
) -> str:
    """Synthesize speech using Chatterbox (local GPU)."""
    import torchaudio
    import time

    if output_path is None:
        output_path = f"/tmp/tts_chatterbox_{int(time.time())}.wav"

    model = _get_model(model_type, device)

    if voice_ref:
        wav = model.generate(
            text,
            audio_prompt_path=voice_ref,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            temperature=temperature,
        )
    else:
        wav = model.generate(
            text,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            temperature=temperature,
        )

    torchaudio.save(output_path, wav.unsqueeze(0).cpu(), model.sr)
    return output_path


@task(
    name="chatterbox.synthesize_turbo",
    tags=["audio", "text", "ai", "generate", "tts"],
    gpu="T4",
    timeout=120,
)
def synthesize_turbo(
    text: str,
    voice_ref: Optional[str] = None,
    exaggeration: float = 0.5,
    device: str = "cuda",
    output_path: Optional[str] = None,
) -> str:
    """Synthesize using Chatterbox Turbo (faster, English only)."""
    return synthesize(
        text=text,
        voice_ref=voice_ref,
        exaggeration=exaggeration,
        model_type="turbo",
        device=device,
        output_path=output_path,
    )


@task(
    name="chatterbox.clone_voice",
    tags=["audio", "text", "ai", "generate", "tts"],
    gpu=None,
    timeout=60,
)
def clone_voice(
    audio_path: str,
    output_path: Optional[str] = None,
) -> str:
    """Extract voice reference for cloning."""
    import torchaudio
    import time

    if output_path is None:
        output_path = f"/tmp/voice_ref_{int(time.time())}.wav"

    waveform, sample_rate = torchaudio.load(audio_path)

    if sample_rate != 24000:
        resampler = torchaudio.transforms.Resample(sample_rate, 24000)
        waveform = resampler(waveform)

    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    torchaudio.save(output_path, waveform, 24000)
    return output_path


def list_languages() -> list[dict]:
    """List supported languages for multilingual model."""
    return [
        {"code": "en", "name": "English"},
        {"code": "sv", "name": "Swedish"},
        {"code": "de", "name": "German"},
        {"code": "fr", "name": "French"},
        {"code": "es", "name": "Spanish"},
        {"code": "it", "name": "Italian"},
        {"code": "pt", "name": "Portuguese"},
        {"code": "nl", "name": "Dutch"},
        {"code": "pl", "name": "Polish"},
        {"code": "ru", "name": "Russian"},
        {"code": "zh", "name": "Chinese"},
        {"code": "ja", "name": "Japanese"},
        {"code": "ko", "name": "Korean"},
    ]


def clear_cache():
    """Clear model cache to free VRAM."""
    global _model, _model_type
    _model = None
    _model_type = None

    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
