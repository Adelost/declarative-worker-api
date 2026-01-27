# Agent Context: Declarative Worker API (DWA)

This document provides context for AI assistants working with this codebase.

## Project Overview

**declarative-worker-api** (DWA) is a declarative task/worker system for background jobs. Tasks are defined as pure data objects (no callbacks, no imperative code). The system supports:

- **Single tasks**: Direct execution via Modal/Ray backends
- **Pipelines**: Multi-step workflows with DAG-based parallel execution
- **Effects**: Side effects triggered at task lifecycle points
- **Tags**: Flexible task filtering by data type, operation, or resource requirements

## Architecture

```
Task (declarative JSON)
  → BullMQ (Redis queue)
    → Dispatcher (DAG scheduler)
      → Backend (Modal or Ray)
        → Effects (toast, webhook, emit)
```

## Key Patterns

### Tasks are Data, Not Code

```typescript
// CORRECT - Pure data
const task: Task = {
  type: "text.chat",
  payload: { prompt: "Hello" },
  onSuccess: [{ $event: "toast", text: "Done!" }]
};

// WRONG - Imperative code
const task = {
  type: "text.chat",
  onSuccess: () => showToast("Done!")  // NO!
};
```

### Pipelines Use Templates, Not Callbacks

```typescript
// CORRECT - Template references
{
  steps: [
    { id: "download", task: "data.download", input: { url: "{{payload.url}}" } },
    { id: "analyze", task: "image.detect", input: { image_path: "{{steps.download.path}}" } }
  ]
}

// WRONG - Function references
{
  steps: [
    { task: "download", input: { url: payload.url } },  // NO!
    { task: "analyze", input: (prev) => prev.path }     // NO!
  ]
}
```

### Tags Instead of Categories

```python
# OLD (don't use)
@task(name="yolo.detect", category="see", capabilities=["detect"])

# NEW (correct)
@task(name="image.detect", tags=["image", "ai", "detect"])
```

## Directory Structure

```
packages/
├── core/                    # Framework-agnostic types
│   └── src/types/
│       ├── task.ts          # Task, Step interfaces
│       ├── effect.ts        # Effect types
│       └── generated.ts     # Auto-generated from Python
├── client/                  # API client
└── orchestrator/            # Node.js server
    └── src/
        ├── server.ts        # Fastify API
        ├── queue.ts         # BullMQ setup
        └── engine/
            ├── dispatcher.ts    # DAG execution
            ├── effects.ts       # Effect handlers
            ├── chunking.ts      # Audio/video chunking
            └── streaming.ts     # SSE streaming

backends/
├── modal/app.py             # Modal backend
└── ray/serve.py             # Ray backend

shared/tasks/                # Python tasks with @task decorator
├── decorator.py             # @task decorator + registry
├── discovery.py             # Auto-discovery
├── types.py                 # TaskMeta
├── video/                   # Video: extract, convert, scenes
│   ├── extract.py           # extract_frames, extract_audio
│   ├── convert.py           # video/audio format conversion
│   └── scenes.py            # AI scene detection
├── audio/                   # Audio: convert, transcribe, tts
│   ├── convert.py           # format conversion
│   ├── transcribe.py        # whisper transcription
│   ├── diarize.py           # speaker diarization
│   └── tts.py               # text-to-speech
├── image/                   # Image: transform, detect
│   ├── transform.py         # resize, crop, compress
│   └── detect.py            # YOLO detection, segmentation, pose
├── text/                    # Text: chunk, llm
│   ├── chunk.py             # text splitting
│   └── llm.py               # OpenAI, etc.
└── data/                    # Data: fetch, search, embed
    ├── fetch.py             # download files
    ├── rss.py               # RSS feeds
    └── search.py            # embeddings, vector search

tests/
└── e2e/                     # Integration tests
```

## Important Files

| File | Purpose |
|------|---------|
| `packages/core/src/types/task.ts` | Task and Step type definitions |
| `packages/orchestrator/src/engine/dispatcher.ts` | DAG execution logic |
| `shared/tasks/decorator.py` | @task decorator + registry |
| `shared/tasks/types.py` | TaskMeta with tags |

## Common Tasks

### Adding a New Task

1. Create task with @task decorator:
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

2. Task is automatically discovered and available.

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

filter_by_tag("gpu")                     # All GPU tasks
filter_by_tag("audio")                   # All audio tasks
filter_by_tags(["ai", "image"])          # AI + image
filter_by_tags(["video", "audio"], match_all=False)  # OR
```

## Testing

```bash
# All tests
pnpm test

# Specific test
npx vitest run tests/e2e/parallel-pipeline.test.ts
```

## Don't

- Add imperative callbacks to tasks
- Use `category` or `capabilities` (use `tags` instead)
- Use old task names like `yolo.detect` (use `image.detect`)
- Use old folder names like `see/`, `hear/` (use `video/`, `audio/`, etc.)
- Forget `dependsOn` when steps have data dependencies

## Do

- Keep tasks as pure JSON-serializable data
- Use `tags` for flexible task metadata
- Use template syntax: `{{steps.id.field}}`
- Organize tasks by data type (video, audio, image, text, data)
- Add appropriate tags: data type + operation + ai/generic

## Related Projects

- **declarative-atomic-ui** (DAUI) - Declarative UI framework
- DWA handles backend tasks, DAUI handles frontend UI
