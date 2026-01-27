# Agent Context: declarative-worker-api

This document provides context for AI assistants working with this codebase.

## Project Overview

**declarative-worker-api** is a declarative task/worker system for AI workloads. Tasks are defined as pure data objects (no callbacks, no imperative code). The system supports:

- **Single tasks**: Direct execution via Modal/Ray backends
- **Pipelines**: Multi-step workflows with DAG-based parallel execution
- **Effects**: Side effects triggered at task lifecycle points

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
  type: "openai.chat",
  payload: { prompt: "Hello" },
  onSuccess: [{ $event: "toast", text: "Done!" }]
};

// WRONG - Imperative code
const task = {
  type: "openai.chat",
  onSuccess: () => showToast("Done!")  // NO!
};
```

### Pipelines Use Templates, Not Callbacks

```typescript
// CORRECT - Template references
{
  steps: [
    { id: "download", task: "download.file", input: { url: "{{payload.url}}" } },
    { id: "analyze", task: "yolo.detect", input: { image_path: "{{steps.download.path}}" } }
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

### Parallel Execution via Dependencies

```typescript
// Steps with dependsOn run in parallel when dependencies satisfied
{
  steps: [
    { id: "a", task: "download" },
    { id: "b", task: "process1", dependsOn: ["a"] },  // ┐
    { id: "c", task: "process2", dependsOn: ["a"] },  // ├ These run in parallel
    { id: "d", task: "process3", dependsOn: ["a"] },  // ┘
    { id: "e", task: "merge", dependsOn: ["b", "c", "d"] }
  ]
}
```

### forEach for Array Processing

```typescript
{
  id: "describe_frames",
  task: "florence.caption",
  dependsOn: ["extract_frames"],
  forEach: "{{steps.extract_frames.frames}}",  // Array to iterate
  forEachConcurrency: 4,                        // Parallel limit
  input: {
    image_path: "{{item.path}}",  // Current item
    index: "{{index}}"            // Current index
  }
}
```

## Directory Structure

```
packages/
├── core/                    # Framework-agnostic types
│   └── src/types/
│       ├── task.ts          # Task, Step interfaces
│       ├── effect.ts        # Effect types
│       ├── backend.ts       # Backend interface
│       └── generated.ts     # Auto-generated from Python
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
├── modal/app.py             # Modal backend (auto-registered)
└── ray/serve.py             # Ray backend

shared/tasks/                # Python tasks with @task decorator
├── decorator.py             # @task decorator + registry
├── discovery.py             # Auto-discovery
├── types.py                 # TaskMeta, ChunkConfig
├── see/                     # Vision: yolo, sam2, florence, etc.
├── hear/                    # Audio: whisper, diarize
├── think/                   # LLM: openai
├── speak/                   # TTS: openai_tts, elevenlabs, etc.
├── get/                     # Input: download, rss
├── transform/               # Utility: convert, chunk, image
├── find/                    # Search: semantic, vector
└── watch/                   # Video: analyze, scenes, tracking

scripts/
├── gen_types.py             # TypeScript generator
└── check_types.py           # CI validation

tests/
├── e2e/                     # Integration tests
└── packages/*/tests/        # Unit tests
```

## Important Files

| File | Purpose |
|------|---------|
| `packages/core/src/types/task.ts` | Task and Step type definitions |
| `packages/core/src/types/generated.ts` | Auto-generated TypeScript types |
| `packages/orchestrator/src/engine/dispatcher.ts` | DAG execution logic |
| `shared/tasks/decorator.py` | @task decorator + registry |
| `shared/tasks/discovery.py` | Auto-discovery of tasks |
| `backends/modal/app.py` | Modal backend (auto-registered) |

## Common Tasks

### Adding a New Task Type

1. Create task with @task decorator in the appropriate category:
```python
# shared/tasks/see/my_detector.py
from ..decorator import task

@task(
    name="my_detector.detect",
    category="see",
    capabilities=["detect"],
    gpu="T4",
    timeout=300,
)
def detect(image_path: str, conf: float = 0.25) -> list[dict]:
    """Detect objects in an image."""
    return [{"label": "cat", "confidence": 0.95}]
```

2. Regenerate TypeScript types:
```bash
pnpm gen:types
```

3. The task is automatically available via Modal backend - no manual registration needed.

### Adding a New Effect

1. Add type in `packages/core/src/types/effect.ts`:
```typescript
| { $event: "new-effect"; param: string }
```

2. Add handler in `packages/orchestrator/src/engine/effects.ts`:
```typescript
case "new-effect":
  await handleNewEffect(effect, context);
  break;
```

### Modifying Pipeline Execution

The DAG scheduler is in `packages/orchestrator/src/engine/dispatcher.ts`:
- `processPipelineDAG()` - Main execution loop
- `executeStep()` - Single step execution (handles forEach)
- `getRunnableSteps()` - Finds steps with satisfied dependencies

## Testing

```bash
# All tests (93 total)
pnpm test

# Unit tests only
npx vitest run

# E2E tests only
npx vitest run --config vitest.e2e.config.ts

# Specific test file
npx vitest run tests/e2e/parallel-pipeline.test.ts
```

## Don't

- Add imperative callbacks to tasks
- Import backend-specific code in core package
- Modify task objects after creation
- Use `steps.0.result` syntax in DAG mode (use `steps.id.result`)
- Forget to add `dependsOn` when steps have data dependencies

## Do

- Keep tasks as pure JSON-serializable data
- Use template syntax for data flow: `{{steps.id.field}}`
- Add `id` to steps for better debugging and DAG execution
- Test pipelines with mock backend in e2e tests
- Document new task types in README.md
