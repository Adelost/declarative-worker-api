# declarative-worker-api Cheatsheet

Quick reference for common patterns.

## Task Patterns

### Simple Task
```typescript
{ type: "llm.chat", payload: { prompt: "Hello" } }
```

### With Effects
```typescript
{
  type: "llm.chat",
  payload: { prompt: "Hello" },
  onSuccess: [{ $event: "toast", text: "Done!" }],
  onError: [{ $event: "notify", channel: "slack", message: "Failed: {{error}}" }]
}
```

### With Retry
```typescript
{
  type: "llm.chat",
  payload: { prompt: "Hello" },
  retry: { attempts: 3, backoff: "exponential", delay: 1000 }
}
```

### With Resources
```typescript
{
  type: "vision.yolo",
  payload: { image: "/path/to/image.jpg" },
  resources: { gpu: "T4", vram: 8000, timeout: 300 }
}
```

## Pipeline Patterns

### Sequential (Legacy)
```typescript
{
  steps: [
    { task: "process.download", input: { url: "{{payload.url}}" } },
    { task: "audio.transcribe", input: { path: "{{steps.0.path}}" } },
    { task: "llm.summarize", input: { text: "{{steps.1.text}}" } }
  ]
}
```

### Parallel DAG
```typescript
{
  steps: [
    { id: "download", task: "process.download" },
    { id: "frames", task: "video.extract_frames", dependsOn: ["download"] },
    { id: "audio", task: "video.extract_audio", dependsOn: ["download"] },
    { id: "yolo", task: "vision.yolo", dependsOn: ["frames"] },
    { id: "whisper", task: "audio.transcribe", dependsOn: ["audio"] },
    { id: "merge", task: "merge", dependsOn: ["yolo", "whisper"] }
  ]
}
```

### forEach Iteration
```typescript
{
  id: "process_items",
  task: "vision.describe",
  dependsOn: ["get_items"],
  forEach: "{{steps.get_items.items}}",
  forEachConcurrency: 4,
  input: { image: "{{item.path}}", index: "{{index}}" }
}
```

### Optional Step
```typescript
{ id: "optional", task: "might.fail", optional: true, dependsOn: ["prev"] }
```

## Template Syntax

| Template | Resolves To |
|----------|-------------|
| `{{payload.url}}` | Task payload field |
| `{{steps.0.result}}` | Sequential step result (by index) |
| `{{steps.download.path}}` | DAG step result (by ID) |
| `{{item}}` | Current forEach item |
| `{{index}}` | Current forEach index |
| `{{error}}` | Error message (in onError) |
| `{{progress}}` | Progress percentage (in onProgress) |

## Effects

| Effect | Example |
|--------|---------|
| Toast | `{ $event: "toast", text: "Done!", variant: "success" }` |
| Webhook | `{ $event: "webhook", url: "https://...", method: "POST" }` |
| Notify | `{ $event: "notify", channel: "slack", message: "..." }` |
| Invalidate | `{ $event: "invalidate", path: "/api/data" }` |
| Enqueue | `{ $event: "enqueue", task: { type: "...", payload: {} } }` |
| Emit | `{ $event: "emit", event: "custom", data: { key: "value" } }` |

## Common Task Types

### LLM
```typescript
// Chat
{ type: "llm.chat", payload: { prompt: "...", model: "gpt-4" } }

// Embed
{ type: "llm.embed", payload: { text: "..." } }

// Summarize
{ type: "llm.summarize", payload: { text: "...", max_length: 200 } }

// Extract
{ type: "llm.extract", payload: { text: "...", schema: { name: "string" } } }
```

### Vision
```typescript
// Object Detection
{ type: "vision.yolo", payload: { image_path: "..." } }

// Segmentation
{ type: "vision.sam2.segment", payload: { image_path: "...", points: [[100,100]] } }

// Caption
{ type: "vision.florence.caption", payload: { image_path: "..." } }

// Face Detection
{ type: "vision.faces.detect", payload: { image_path: "..." } }
```

### Audio
```typescript
// Transcribe
{ type: "audio.transcribe", payload: { audio_path: "..." } }

// TTS
{ type: "audio.tts.openai", payload: { text: "...", voice: "alloy" } }

// Voice Clone
{ type: "audio.clone.synthesize", payload: { text: "...", voice_id: "..." } }
```

### Video
```typescript
// Full Analysis
{ type: "video.analyze", payload: { video_path: "..." } }

// Scene Detection
{ type: "video.scenes.detect", payload: { video_path: "..." } }

// Object Tracking
{ type: "video.track.objects", payload: { video_path: "...", class_names: ["person"] } }
```

### Process
```typescript
// Download
{ type: "process.download", payload: { url: "..." } }

// RSS
{ type: "process.rss.fetch", payload: { feed_url: "...", limit: 10 } }

// Convert
{ type: "process.convert", payload: { input_path: "...", format: "mp3" } }
```

## API Calls

```bash
# Create task
curl -X POST localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"type":"llm.chat","payload":{"prompt":"Hi"}}'

# Get status
curl localhost:3000/api/tasks/JOB_ID

# List tasks
curl "localhost:3000/api/tasks?queue=gpu&status=active"

# Visualize DAG
curl -X POST localhost:3000/api/visualize \
  -H "Content-Type: application/json" \
  -d '{"steps":[...]}'
```

## Pipeline Result

```typescript
const result = await processTask(task);

result.steps           // Ordered results array
result.stepResults     // Results by step ID
result.stepStatus      // Status per step
result.finalResult     // Last step's result
result.totalDuration   // Total ms
result.parallelGroups  // Steps that ran together
```

## Step Status

```typescript
{
  id: "download",
  task: "process.download",
  status: "completed",  // pending | running | completed | failed | skipped
  startedAt: Date,
  completedAt: Date,
  duration: 1234,       // ms
  result: { ... }
}
```

## Event Subscription

```typescript
await processTask(task,
  (progress) => console.log(`${progress}%`),
  (event) => {
    // event.type: "step:start" | "step:complete" | "step:error" | "pipeline:complete"
    // event.stepId: "download"
    // event.stepTask: "process.download"
    // event.timestamp: Date
    // event.data: { ... }
  }
);
```

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
MODAL_URL=https://your-app.modal.run
MODAL_TOKEN=...
RAY_URL=http://localhost:8000
PORT=3000
WORKER_CONCURRENCY=5
GPU_WORKER_CONCURRENCY=2
```

## Modal Commands

```bash
modal serve app.py           # Dev mode
modal deploy app.py          # Production
modal secret create NAME KEY=value
```
