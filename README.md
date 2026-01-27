# declarative-worker-api

Declarative worker/task system with parallel DAG execution, supporting Modal and Ray backends.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Declarative Task Definition                   │
│  { type: "yolo.detect", backend: "modal", payload: {...} }      │
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
│  shared/tasks/{see,hear,think,speak,...}/*.py   │
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
  -d '{"type": "openai.chat", "payload": {"prompt": "Hello!"}}'
```

## Core Concepts

### Simple Task

```typescript
const task: Task = {
  type: "openai.chat",
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
    { task: "download.file", input: { url: "{{payload.url}}" } },
    { task: "whisper.transcribe", input: { audio_path: "{{steps.0.path}}" } },
    { task: "openai.summarize", input: { text: "{{steps.1.text}}" } }
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
    { id: "download", task: "download.file", input: { url: "{{payload.url}}" } },

    // These run in parallel after download
    { id: "frames", task: "scenes.detect", dependsOn: ["download"] },
    { id: "audio", task: "convert.audio", dependsOn: ["download"] },

    // These run in parallel after frames
    { id: "yolo", task: "yolo.detect", dependsOn: ["frames"] },
    { id: "faces", task: "faces.detect", dependsOn: ["frames"] },
    { id: "siglip", task: "siglip.embed", dependsOn: ["frames"] },

    // This runs after audio
    { id: "whisper", task: "whisper.transcribe", dependsOn: ["audio"] },

    // Final aggregation waits for all
    { id: "merge", task: "analyze.video", dependsOn: ["yolo", "faces", "siglip", "whisper"] }
  ]
};
```

**Execution flow:**
```
download
   ├── frames ──┬── yolo ────┐
   │            ├── faces ───┼── merge
   │            └── siglip ──┘
   └── audio ───── whisper ──┘
```

### forEach Iteration

Process arrays in parallel with concurrency control:

```typescript
{
  id: "describe_scenes",
  task: "florence.caption",
  dependsOn: ["detect_scenes"],
  forEach: "{{steps.detect_scenes.scenes}}",  // Array to iterate
  forEachConcurrency: 4,                       // Max 4 parallel
  input: {
    image_path: "{{item.keyframe}}",          // Current item
    scene_index: "{{index}}"                   // Current index
  }
}
```

## Task Categories

Tasks are organized by category using the `@task` decorator with auto-registration:

### see/ - Vision Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `yolo.detect` | Object detection | T4 |
| `yolo.segment` | Instance segmentation | T4 |
| `yolo.pose` | Pose estimation | T4 |
| `yolo.track` | Object tracking | T4 |
| `sam2.segment` | SAM2 segmentation | A10G |
| `sam2.track` | Video segmentation | A10G |
| `florence.caption` | Image captioning | T4 |
| `florence.detect` | Dense detection | T4 |
| `florence.ocr` | OCR | T4 |
| `siglip.embed` | Image embeddings | T4 |
| `siglip.classify` | Zero-shot classification | T4 |
| `depth.estimate` | Depth estimation | T4 |
| `faces.detect` | Face detection | T4 |
| `faces.embed` | Face embeddings | T4 |
| `faces.cluster` | Face clustering | T4 |

### hear/ - Audio Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `whisper.transcribe` | Whisper transcription | T4 |
| `whisper.transcribe_stream` | Streaming transcription | T4 |
| `whisper.detect_language` | Language detection | T4 |
| `diarize.speakers` | Speaker diarization | T4 |

### think/ - LLM Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `openai.chat` | Chat completion | No |
| `openai.chat_stream` | Streaming chat | No |
| `openai.embed` | Text embeddings | No |
| `openai.summarize` | Summarization | No |
| `openai.extract` | Structured extraction | No |
| `openai.classify` | Text classification | No |
| `openai.translate` | Translation | No |

### speak/ - TTS Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `openai_tts.synthesize` | OpenAI TTS | No |
| `elevenlabs.synthesize` | ElevenLabs TTS | No |
| `chatterbox.synthesize` | Local TTS | T4 |
| `sesame.synthesize` | Sesame TTS | T4 |

### get/ - Input Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `download.file` | Download file | No |
| `download.youtube` | Download YouTube | No |
| `rss.fetch` | Fetch RSS feed | No |

### transform/ - Utility Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `convert.audio` | Audio format conversion | No |
| `convert.video` | Video format conversion | No |
| `chunk.audio` | Audio chunking | No |
| `chunk.text` | Text chunking | No |
| `image.resize` | Image resizing | No |
| `image.crop` | Image cropping | No |

### find/ - Search Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `semantic.search` | Semantic text search | No |
| `semantic.embed` | Text embeddings | No |
| `multimodal.search` | Text + image search | T4 |
| `vector.upsert` | Vector store upsert | No |
| `vector.query` | Vector store query | No |

### watch/ - Video Tasks
| Task | Description | GPU |
|------|-------------|-----|
| `analyze.video` | Full analysis pipeline | T4 |
| `scenes.detect` | Scene detection | No |
| `scenes.describe` | Scene descriptions | T4 |
| `tracking.objects` | Object tracking | T4 |
| `tracking.faces` | Face tracking | T4 |


## Effects

Triggered at task lifecycle points:

```typescript
const task: Task = {
  type: "openai.chat",
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

### Create Task

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "openai.chat",
    "payload": {"prompt": "Hello"},
    "onSuccess": [{"$event": "toast", "text": "Done!"}]
  }'
```

**Response:**
```json
{
  "id": "abc123",
  "status": "pending",
  "queue": "default"
}
```

### Get Task Status

```bash
curl http://localhost:3000/api/tasks/abc123
```

**Response:**
```json
{
  "id": "abc123",
  "status": "completed",
  "progress": 100,
  "result": {"response": "Hello! How can I help?"},
  "startedAt": "2024-01-27T10:00:00Z",
  "completedAt": "2024-01-27T10:00:02Z"
}
```

### List Tasks

```bash
curl "http://localhost:3000/api/tasks?queue=gpu&status=active&limit=10"
```

### Visualize Pipeline

```bash
curl -X POST http://localhost:3000/api/visualize \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"id": "a", "task": "download.file"},
      {"id": "b", "task": "yolo.detect", "dependsOn": ["a"]},
      {"id": "c", "task": "faces.detect", "dependsOn": ["a"]}
    ]
  }'
```

**Response:**
```json
{
  "mermaid": "graph TD\n  a[process\\ndownload]\n  b[vision\\nyolo]\n  ...",
  "url": "https://mermaid.live/edit#pako:..."
}
```

## Pipeline Result Format

```typescript
interface PipelineResult {
  steps: unknown[];                    // Ordered results array
  stepResults: Record<string, unknown>; // Results by step ID
  stepStatus: StepStatus[];            // Execution status per step
  finalResult: unknown;                // Last step's result
  totalDuration: number;               // Total ms
  parallelGroups: string[][];          // Which steps ran together
}

interface StepStatus {
  id: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  error?: string;
}
```

## Pipeline Events

Subscribe to real-time pipeline events:

```typescript
import { processTask } from "@dwa/orchestrator";

const result = await processTask(task,
  (progress) => console.log(`Progress: ${progress}%`),
  (event) => {
    switch (event.type) {
      case "step:start":
        console.log(`Starting ${event.stepId}: ${event.stepTask}`);
        break;
      case "step:complete":
        console.log(`Completed ${event.stepId} in ${event.data?.duration}ms`);
        break;
      case "step:error":
        console.log(`Failed ${event.stepId}: ${event.data?.error}`);
        break;
      case "pipeline:complete":
        console.log(`Pipeline done in ${event.data?.totalDuration}ms`);
        break;
    }
  }
);
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `MODAL_URL` | Modal backend URL | - |
| `MODAL_TOKEN` | Modal auth token | - |
| `RAY_URL` | Ray Serve URL | - |
| `PORT` | Server port | `3000` |
| `WORKER_CONCURRENCY` | Default workers | `5` |
| `GPU_WORKER_CONCURRENCY` | GPU workers | `2` |

### Task Resources

```typescript
const task: Task = {
  type: "yolo.detect",
  payload: { image_path: "..." },
  resources: {
    gpu: "T4",        // GPU type
    vram: 8000,       // MB required
    ram: 16000,       // MB required
    timeout: 300      // seconds
  }
};
```

### Retry Configuration

```typescript
const task: Task = {
  type: "openai.chat",
  payload: { prompt: "Hello" },
  retry: {
    attempts: 3,
    backoff: "exponential",  // or "fixed"
    delay: 1000,             // initial delay ms
    maxDelay: 30000          // max delay for exponential
  }
};
```

## Development

```bash
# Install dependencies
pnpm install

# Run all tests (93 total)
pnpm test

# Run e2e tests only
pnpm test:e2e

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
│   ├── modal/                # Modal backend (auto-registered)
│   │   └── app.py
│   └── ray/                  # Ray backend
│       └── serve.py
├── shared/tasks/             # Python tasks with @task decorator
│   ├── decorator.py          # @task decorator + registry
│   ├── discovery.py          # Auto-discovery
│   ├── types.py              # TaskMeta, ChunkConfig
│   ├── see/                  # Vision: yolo, sam2, florence, etc.
│   ├── hear/                 # Audio: whisper, diarize
│   ├── think/                # LLM: openai
│   ├── speak/                # TTS: openai_tts, elevenlabs, etc.
│   ├── get/                  # Input: download, rss
│   ├── transform/            # Utility: convert, chunk, image
│   ├── find/                 # Search: semantic, vector
│   └── watch/                # Video: analyze, scenes, tracking
├── scripts/
│   ├── gen_types.py          # TypeScript generator
│   └── check_types.py        # CI validation
└── tests/
    └── e2e/                  # Integration tests
```

## @task Decorator System

Tasks are registered using the `@task` decorator with automatic TypeScript type generation.

### Adding a New Task

```python
# shared/tasks/see/my_task.py
from ..decorator import task

@task(
    name="my_task.detect",
    category="see",
    capabilities=["detect", "objects"],
    gpu="T4",
    timeout=300,
)
def detect(image_path: str, conf: float = 0.25) -> list[dict]:
    """Detect objects in an image."""
    # Implementation
    return [{"label": "cat", "confidence": 0.95}]
```

### Chunking Support

For long-running tasks (audio/video), add chunking config:

```python
@task(
    name="whisper.transcribe",
    category="hear",
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

For real-time feedback, use generators:

```python
@task(
    name="whisper.transcribe_stream",
    category="hear",
    streaming=True,
)
def transcribe_stream(audio_path: str) -> Generator[dict, None, None]:
    for segment in process_segments(audio_path):
        yield {"text": segment.text, "start": segment.start}
```

### Generate TypeScript Types

```bash
# Generate types from Python decorators
pnpm gen:types

# Check if types are up-to-date (for CI)
pnpm check:types
```

Output in `packages/core/src/types/generated.ts`:

```typescript
export type TaskName = "yolo.detect" | "whisper.transcribe" | ...;

export interface TaskPayloads {
  "yolo.detect": { image_path: string; conf?: number };
  "whisper.transcribe": { audio_path: string; language?: string };
}

export const TASK_METADATA: Record<TaskName, TaskMetadata> = { ... };
```

## Modal Commands

```bash
# Local development
cd backends/modal && modal serve app.py

# Deploy to cloud
modal deploy app.py

# Run task directly
modal run app.py --task-type openai.chat --payload '{"prompt":"Hi"}'

# Create secrets
modal secret create openai-secret OPENAI_API_KEY=sk-...
modal secret create elevenlabs-secret ELEVENLABS_API_KEY=...
```

## License

MIT
