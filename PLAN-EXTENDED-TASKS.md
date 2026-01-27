# Plan: Extended Tasks for declarative-worker-api

Based on analysis of podtotxt, voiceme, and ai-dsl.

## Task Categories

### 1. Audio Tasks (audio.*)

| Task | Description | GPU | VRAM | Source |
|------|-------------|-----|------|--------|
| `audio.transcribe` | Whisper API | ❌ | - | all |
| `audio.transcribe_local` | faster-whisper local | ✅ | 2-4GB | podtotxt |
| `audio.transcribe_timestamps` | Word-level timestamps | ✅ | 2-4GB | podtotxt |
| `audio.tts` | OpenAI TTS API | ❌ | - | voiceme |
| `audio.tts_elevenlabs` | ElevenLabs API | ❌ | - | voiceme |
| `audio.tts_chatterbox` | Chatterbox multilingual | ✅ | 11GB | voiceme |
| `audio.tts_turbo` | Chatterbox Turbo (en) | ✅ | 7GB | voiceme |
| `audio.tts_sesame` | Sesame CSM | ✅ | 5GB | voiceme |
| `audio.clone_voice` | Voice cloning setup | ✅ | 11GB | voiceme |
| `audio.diarize` | Speaker diarization | ✅ | 2GB | podtotxt |

### 2. LLM Tasks (llm.*)

| Task | Description | GPU | Source |
|------|-------------|-----|--------|
| `llm.chat` | Chat completion | ❌ | all |
| `llm.embed` | Text embeddings (OpenAI) | ❌ | all |
| `llm.embed_e5` | E5-large multilingual | ✅ | podtotxt |
| `llm.summarize` | Text summarization | ❌ | podtotxt |
| `llm.extract` | Structured extraction | ❌ | podtotxt |
| `llm.generate_speech_text` | Text optimized for TTS | ❌ | voiceme |

### 3. Image Tasks (image.*)

| Task | Description | GPU | VRAM | Source |
|------|-------------|-----|------|--------|
| `image.generate` | DALL-E API | ❌ | - | existing |
| `image.generate_sd` | Stable Diffusion | ✅ | 8GB | existing |
| `image.generate_sdxl` | SDXL | ✅ | 12GB | existing |
| `image.describe` | GPT-4 Vision | ❌ | - | existing |
| `image.detect` | Object detection | ✅ | 2-4GB | ai-dsl |
| `image.detect_yolo` | YOLO detection | ✅ | 2GB | ai-dsl |
| `image.detect_florence` | Florence-2 detection | ✅ | 4GB | ai-dsl |
| `image.detect_grounding` | Grounding DINO | ✅ | 4GB | ai-dsl |
| `image.segment` | SAM2 segmentation | ✅ | 4GB | ai-dsl |
| `image.segment_yolo` | YOLO segmentation | ✅ | 2GB | ai-dsl |
| `image.depth` | Depth estimation | ✅ | 2GB | ai-dsl |
| `image.classify` | Zero-shot classification | ✅ | 2GB | ai-dsl |
| `image.embed` | SigLIP/CLIP embeddings | ✅ | 2GB | ai-dsl |
| `image.ocr` | Florence-2 OCR | ✅ | 4GB | ai-dsl |
| `image.caption` | Florence-2 captioning | ✅ | 4GB | ai-dsl |
| `image.faces` | Face detection | ✅ | 2GB | ai-dsl |
| `image.pose` | Pose estimation | ✅ | 2GB | ai-dsl |

### 4. Video Tasks (video.*)

| Task | Description | GPU | Source |
|------|-------------|-----|--------|
| `video.analyze` | Full pipeline analysis | ✅ | ai-dsl |
| `video.transcribe` | Audio track transcription | ✅ | ai-dsl |
| `video.detect_objects` | Per-frame detection | ✅ | ai-dsl |
| `video.detect_scenes` | Scene boundary detection | ✅ | ai-dsl |
| `video.extract_keyframes` | Keyframe extraction | ✅ | ai-dsl |
| `video.track_objects` | SAM2 object tracking | ✅ | ai-dsl |
| `video.extract_faces` | Face clustering | ✅ | ai-dsl |
| `video.describe_events` | VLM event descriptions | ✅ | ai-dsl |
| `video.embed` | Video embeddings | ✅ | ai-dsl |

### 5. Process Tasks (process.*)

| Task | Description | GPU | Source |
|------|-------------|-----|--------|
| `process.download` | HTTP file download | ❌ | podtotxt |
| `process.download_youtube` | YouTube download | ❌ | new |
| `process.fetch_rss` | RSS feed parsing | ❌ | podtotxt |
| `process.convert_audio` | Audio format conversion | ❌ | all |
| `process.convert_video` | Video format conversion | ❌ | ai-dsl |
| `process.extract_audio` | Extract audio from video | ❌ | ai-dsl |
| `process.chunk_text` | Text chunking | ❌ | podtotxt |

### 6. Search Tasks (search.*)

| Task | Description | GPU | Source |
|------|-------------|-----|--------|
| `search.semantic` | Semantic text search | ❌ | podtotxt |
| `search.multimodal` | Cross-modal search | ❌ | ai-dsl |
| `search.similarity` | Vector similarity | ❌ | all |

---

## GPU Resource Groups

For VRAM management, tasks are grouped:

### Light GPU (2-4GB)
- audio.transcribe_local
- image.detect_yolo
- image.classify
- image.embed
- image.depth
- image.faces
- image.pose

### Medium GPU (4-8GB)
- image.detect_florence
- image.detect_grounding
- image.segment
- image.ocr
- image.caption
- image.generate_sd

### Heavy GPU (8-12GB)
- audio.tts_chatterbox
- audio.tts_turbo
- image.generate_sdxl

### Extra Heavy GPU (12GB+)
- video.describe_events (Qwen VL)
- audio.tts_chatterbox (with cloning)

---

## Implementation Priority

### Phase 1: Core Audio (from podtotxt/voiceme)
- [ ] `audio.transcribe_local` - faster-whisper with timestamps
- [ ] `audio.tts` - OpenAI TTS (already exists)
- [ ] `audio.tts_elevenlabs` - ElevenLabs API
- [ ] `audio.diarize` - Speaker diarization

### Phase 2: Core Vision (from ai-dsl)
- [ ] `image.detect_yolo` - YOLO v8/v11
- [ ] `image.segment` - SAM2
- [ ] `image.depth` - Depth Anything v2
- [ ] `image.embed` - SigLIP embeddings

### Phase 3: Local TTS (from voiceme)
- [ ] `audio.tts_chatterbox` - Multilingual TTS
- [ ] `audio.tts_sesame` - Conversational TTS
- [ ] `audio.clone_voice` - Voice cloning

### Phase 4: Advanced Vision (from ai-dsl)
- [ ] `image.detect_florence` - Florence-2
- [ ] `image.ocr` - Florence-2 OCR
- [ ] `image.caption` - Image captioning
- [ ] `image.faces` - Face detection/clustering
- [ ] `image.pose` - Pose estimation

### Phase 5: Video Pipeline (from ai-dsl)
- [ ] `video.analyze` - Full analysis pipeline
- [ ] `video.detect_scenes` - Scene detection
- [ ] `video.track_objects` - Object tracking
- [ ] `video.describe_events` - VLM descriptions

### Phase 6: Search & Embeddings (from podtotxt/ai-dsl)
- [ ] `llm.embed_e5` - E5-large embeddings
- [ ] `search.semantic` - Text semantic search
- [ ] `search.multimodal` - Cross-modal search

---

## Shared Python Modules to Add

```
shared/tasks/
├── __init__.py
├── llm.py          # existing
├── audio.py        # existing + extend
├── image.py        # existing + extend
├── video.py        # NEW
├── vision/         # NEW - ai-dsl backends
│   ├── __init__.py
│   ├── yolo.py
│   ├── sam2.py
│   ├── florence.py
│   ├── depth.py
│   ├── siglip.py
│   └── faces.py
├── tts/            # NEW - voiceme engines
│   ├── __init__.py
│   ├── openai.py
│   ├── elevenlabs.py
│   ├── chatterbox.py
│   └── sesame.py
└── process/        # NEW - utilities
    ├── __init__.py
    ├── download.py
    ├── rss.py
    └── convert.py
```

---

## Modal Backend Updates

```python
# New images needed
vision_image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04")
    .pip_install("torch", "ultralytics", "transformers", "sam2", ...)
)

tts_image = (
    modal.Image.debian_slim()
    .pip_install("torch", "torchaudio", "chatterbox", ...)
)

# New GPU functions
@app.function(image=vision_image, gpu="T4")
def run_vision_task(task_type: str, payload: dict) -> dict:
    ...

@app.function(image=tts_image, gpu="A10G")
def run_tts_task(task_type: str, payload: dict) -> dict:
    ...
```

---

## Example Pipelines

### Podcast Analysis (podtotxt replacement)
```typescript
{
  type: "podcast-analysis",
  steps: [
    { task: "process.fetch_rss", input: { url: "{{payload.feed_url}}" } },
    { task: "process.download", input: { url: "{{steps.0.episodes[0].audio}}" } },
    { task: "audio.transcribe_local", input: { path: "{{steps.1.path}}" } },
    { task: "llm.summarize", input: { text: "{{steps.2.text}}" } },
    { task: "llm.extract", input: { text: "{{steps.2.text}}", schema: {...} } },
    { task: "llm.embed_e5", input: { chunks: "{{steps.2.segments}}" } }
  ]
}
```

### Voice Generation (voiceme replacement)
```typescript
{
  type: "voice-generation",
  steps: [
    { task: "llm.generate_speech_text", input: { topic: "{{payload.topic}}" } },
    { task: "audio.tts_chatterbox", input: {
        text: "{{steps.0.text}}",
        voice_ref: "{{payload.voice_sample}}"
    } }
  ]
}
```

### Video Analysis (ai-dsl replacement)
```typescript
{
  type: "video-analysis",
  steps: [
    { task: "video.extract_keyframes", input: { path: "{{payload.video}}" } },
    { task: "video.transcribe", input: { path: "{{payload.video}}" } },
    { task: "image.detect_yolo", input: { frames: "{{steps.0.keyframes}}" } },
    { task: "image.embed", input: { frames: "{{steps.0.keyframes}}" } },
    { task: "video.detect_scenes", input: { embeddings: "{{steps.3.embeddings}}" } }
  ]
}
```

---

## Next Steps

1. Start with Phase 1 (Core Audio) since it overlaps most projects
2. Add vision backends from ai-dsl one by one
3. Integrate TTS engines from voiceme
4. Build video pipeline abstraction
5. Add search/embedding layer
