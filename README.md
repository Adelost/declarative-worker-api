# Declarative Worker API (DWA)

Declarative task/worker system with parallel DAG execution, supporting Modal and Ray backends.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Declarative Task Definition                   │
│  { type: "image.detect", backend: "modal", payload: {...} }     │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Node.js Orchestrator                        │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────────┐ │
│  │ BullMQ     │  │ DAG        │  │ Effect Registry            │ │
│  │ (Queue)    │  │ Scheduler  │  │ (toast, webhook, etc)      │ │
│  └────────────┘  └────────────┘  └────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌─────────────────────────────────────────────────┐
│         @task Decorator Auto-Registration       │
│  shared/tasks/{video,audio,image,text,data}/*.py│
│         ↓ pnpm gen:types                        │
│  packages/core/src/types/generated.ts           │
└───────────────────────────────┬─────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│    Modal Backend        │         │     Ray Backend         │
│  Auto-registered tasks  │         │  ray start / ray up     │
└─────────────────────────┘         └─────────────────────────┘
```

## Quick Start

```bash
# 1. Install
pnpm install

# 2. Start Redis
docker run -d -p 6379:6379 redis:alpine

# 3. Deploy Modal backend
cd backends/modal && modal serve app.py

# 4. Start Orchestrator
MODAL_URL=https://your-app.modal.run pnpm dev

# 5. Submit a task
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"type": "text.chat", "payload": {"prompt": "Hello!"}}'
```

## Core Concepts

### Simple Task

```typescript
const task: Task = {
  type: "text.chat",
  backend: "modal",
  payload: { prompt: "Explain quantum computing" },
  onSuccess: [{ $event: "toast", text: "Done!" }]
};
```

### Pipeline (Sequential)

```typescript
const pipeline: Task = {
  type: "podcast-transcription",
  payload: { url: "https://example.com/episode.mp3" },
  steps: [
    { task: "data.download", input: { url: "{{payload.url}}" } },
    { task: "audio.transcribe", input: { audio_path: "{{steps.0.path}}" } },
    { task: "text.summarize", input: { text: "{{steps.1.text}}" } }
  ]
};
```

### Pipeline (Parallel DAG)

Steps with `id` and `dependsOn` run in parallel when dependencies are satisfied:

```typescript
const videoAnalysis: Task = {
  type: "video-analysis",
  payload: { url: "https://example.com/video.mp4" },
  steps: [
    { id: "download", task: "data.download", input: { url: "{{payload.url}}" } },

    // These run in parallel after download
    { id: "frames", task: "video.extract_frames", dependsOn: ["download"] },
    { id: "audio", task: "video.extract_audio", dependsOn: ["download"] },

    // These run in parallel after frames
    { id: "detect", task: "image.detect", dependsOn: ["frames"] },
    { id: "embed", task: "embed.image", dependsOn: ["frames"] },

    // This runs after audio
    { id: "transcribe", task: "audio.transcribe", dependsOn: ["audio"] },

    // Final aggregation waits for all
    { id: "merge", task: "data.aggregate", dependsOn: ["detect", "embed", "transcribe"] }
  ]
};
```

**Execution flow:**
```
download
   ├── frames ──┬── detect ───┐
   │            └── embed ────┼── merge
   └── audio ───── transcribe─┘
```

### forEach Iteration

Process arrays in parallel with concurrency control:

```typescript
{
  id: "describe_scenes",
  task: "text.caption",
  dependsOn: ["detect_scenes"],
  forEach: "{{steps.detect_scenes.scenes}}",  // Array to iterate
  forEachConcurrency: 4,                       // Max 4 parallel
  input: {
    image_path: "{{item.keyframe}}",          // Current item
    scene_index: "{{index}}"                   // Current index
  }
}
```

## Task Organization

Tasks are organized by **data type** and use **tags** for flexible filtering:

### video/ - Video Processing
| Task | Tags | Description |
|------|------|-------------|
| `video.extract_frames` | generic, extract | Extract frames from video |
| `video.extract_audio` | generic, extract | Extract audio track |
| `video.convert` | generic, convert | Transcode video |
| `video.detect_scenes` | ai, detect | AI scene detection |
| `video.track` | ai, detect, track | Object tracking |

### audio/ - Audio Processing
| Task | Tags | Description |
|------|------|-------------|
| `audio.convert` | generic, convert | Format conversion |
| `audio.transcribe` | ai, transcribe | Whisper transcription |
| `audio.transcribe_stream` | ai, transcribe, streaming | Streaming transcription |
| `audio.detect_language` | ai, detect | Language detection |
| `audio.diarize` | ai, diarize | Speaker diarization |
| `audio.tts` | ai, generate | Text-to-speech |

### image/ - Image Processing
| Task | Tags | Description |
|------|------|-------------|
| `image.transform` | generic, transform | Resize, crop, compress |
| `image.detect` | ai, detect | Object detection (YOLO) |
| `image.segment` | ai, segment | Instance segmentation |
| `image.pose` | ai, detect, pose | Pose estimation |
| `image.detect_batch` | ai, detect, batch | Batch detection |

### text/ - Text Processing
| Task | Tags | Description |
|------|------|-------------|
| `text.chunk` | generic, transform | Split text into chunks |
| `text.chat` | ai, generate | LLM chat completion |
| `text.summarize` | ai, generate | Summarization |
| `text.translate` | ai, generate | Translation |

### data/ - Data Operations
| Task | Tags | Description |
|------|------|-------------|
| `data.download` | generic, fetch | Download file |
| `data.download_youtube` | generic, fetch | Download from YouTube |
| `data.rss` | generic, fetch | Fetch RSS feed |
| `embed.text` | ai, embed | Text embeddings |
| `embed.image` | ai, embed | Image embeddings (CLIP) |
| `search.vectors` | ai, search | Vector similarity search |

## Tags

Tasks use tags for flexible filtering instead of rigid categories:

```python
@task(
    name="audio.transcribe",
    tags=["audio", "text", "ai", "transcribe"],
    gpu="T4",
)
```

### Standard Tags

| Type | Tags |
|------|------|
| Data type | `video`, `audio`, `image`, `text`, `data` |
| Operation | `transform`, `extract`, `embed`, `search`, `generate`, `detect`, `convert` |
| AI/Generic | `ai`, `generic` |
| Resources | `gpu`, `streaming` (auto-added) |

### Filtering Tasks

```python
from tasks import filter_by_tag, filter_by_tags

# All GPU tasks
filter_by_tag("gpu")

# All audio-related tasks
filter_by_tag("audio")

# AI tasks for images
filter_by_tags(["ai", "image"])

# Video OR audio tasks
filter_by_tags(["video", "audio"], match_all=False)
```

## Effects

Triggered at task lifecycle points:

```typescript
const task: Task = {
  type: "text.chat",
  payload: { prompt: "Hello" },

  onPending: [
    { $event: "toast", text: "Starting...", variant: "info" }
  ],

  onProgress: [
    { $event: "emit", event: "progress", data: "{{progress}}" }
  ],

  onSuccess: [
    { $event: "toast", text: "Done!", variant: "success" },
    { $event: "webhook", url: "https://myapp.com/done", method: "POST" },
    { $event: "invalidate", path: "/api/cache" },
    { $event: "enqueue", task: { type: "follow.up", payload: {} } }
  ],

  onError: [
    { $event: "notify", channel: "slack", message: "Task failed: {{error}}" }
  ]
};
```

| Effect | Description |
|--------|-------------|
| `toast` | UI notification |
| `webhook` | HTTP callback |
| `notify` | Slack/Discord/Email |
| `invalidate` | Cache invalidation |
| `enqueue` | Queue another task |
| `emit` | Custom event |
| `redirect` | URL redirect |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tasks` | Create task |
| `GET` | `/api/tasks` | List tasks |
| `GET` | `/api/tasks/:id` | Get task status |
| `DELETE` | `/api/tasks/:id` | Cancel task |
| `POST` | `/api/visualize` | Generate DAG diagram |
| `GET` | `/health` | Health check |

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Type check
pnpm typecheck

# Start dev server
pnpm dev
```

### Project Structure

```
declarative-worker-api/
├── packages/
│   ├── core/                 # Types, registry
│   │   └── src/types/
│   │       ├── task.ts       # Task, Step, Effect
│   │       └── generated.ts  # Auto-generated from Python
│   ├── client/               # API client
│   └── orchestrator/         # Node.js server
│       └── src/
│           ├── server.ts     # Fastify API
│           ├── queue.ts      # BullMQ setup
│           └── engine/
│               ├── dispatcher.ts  # DAG scheduler
│               ├── effects.ts     # Effect handlers
│               ├── chunking.ts    # Audio/video chunking
│               └── streaming.ts   # SSE streaming
├── backends/
│   ├── modal/                # Modal backend
│   └── ray/                  # Ray backend
├── shared/tasks/             # Python tasks with @task decorator
│   ├── decorator.py          # @task decorator + registry
│   ├── discovery.py          # Auto-discovery
│   ├── types.py              # TaskMeta, ChunkConfig
│   ├── video/                # Video: extract, convert, scenes
│   ├── audio/                # Audio: convert, transcribe, tts, diarize
│   ├── image/                # Image: transform, detect
│   ├── text/                 # Text: chunk, llm
│   └── data/                 # Data: fetch, rss, search, embed
└── tests/
    └── e2e/                  # Integration tests
```

## @task Decorator

Tasks are registered using the `@task` decorator:

```python
# shared/tasks/image/my_detector.py
from ..decorator import task

@task(
    name="image.my_detect",
    tags=["image", "ai", "detect"],
    gpu="T4",
    timeout=300,
)
def my_detect(image_path: str, conf: float = 0.25) -> list[dict]:
    """Detect objects in an image."""
    return [{"label": "cat", "confidence": 0.95}]
```

### Chunking Support

For long-running tasks:

```python
@task(
    name="audio.transcribe",
    tags=["audio", "text", "ai", "transcribe"],
    gpu="T4",
    chunk={
        "input": "audio_path",
        "default_size": "10m",
        "overlap": "5s",
        "merge": "concat_segments",
    },
)
def transcribe(audio_path: str) -> dict:
    ...
```

### Streaming Support

For real-time feedback:

```python
@task(
    name="audio.transcribe_stream",
    tags=["audio", "text", "ai", "transcribe"],
    gpu="T4",
    streaming=True,
)
def transcribe_stream(audio_path: str) -> Generator[dict, None, None]:
    for segment in process_segments(audio_path):
        yield {"text": segment.text, "start": segment.start}
```

## Related Projects

- **[declarative-atomic-ui](https://github.com/Adelost/declarative-atomic-ui)** (DAUI) - Declarative UI framework
- DWA + DAUI = Full-stack declarative architecture

## License

MIT
