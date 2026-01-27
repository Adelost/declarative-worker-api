/**
 * Basic usage examples for declarative-worker-api.
 */

import type { Task } from "@dwa/core";

// Simple chat task
export const chatTask: Task = {
  type: "llm.chat",
  backend: "modal",
  payload: {
    prompt: "Explain quantum computing in simple terms",
    model: "gpt-4",
  },
  onSuccess: [
    { $event: "toast", text: "Chat completed!", variant: "success" },
  ],
};

// Embedding task
export const embedTask: Task = {
  type: "llm.embed",
  backend: "auto",
  queue: "cpu",
  payload: {
    text: "The quick brown fox jumps over the lazy dog",
    model: "text-embedding-3-small",
  },
};

// Audio transcription
export const transcribeTask: Task = {
  type: "audio.transcribe",
  backend: "modal",
  payload: {
    audio_path: "/path/to/audio.mp3",
    language: "en",
  },
  retry: {
    attempts: 3,
    backoff: "exponential",
    delay: 1000,
  },
  onSuccess: [
    { $event: "webhook", url: "https://myapp.com/transcription-done" },
  ],
  onError: [
    { $event: "notify", channel: "slack", message: "Transcription failed: {{error}}" },
  ],
};

// Image generation with Stable Diffusion
export const imageGenTask: Task = {
  type: "image.generate_sd",
  backend: "modal",
  queue: "gpu",
  payload: {
    prompt: "A serene mountain landscape at sunset, digital art",
    negative_prompt: "blurry, low quality",
    steps: 30,
    guidance_scale: 7.5,
  },
  resources: {
    gpu: "T4",
    vram: 8000,
    timeout: 300,
  },
};

// Multi-step pipeline: Video -> Transcribe -> Summarize
export const videoPipeline: Task = {
  type: "video-analysis",
  backend: "modal",
  payload: {
    url: "https://example.com/video.mp4",
  },
  steps: [
    {
      task: "process.download",
      input: { url: "{{payload.url}}" },
      timeout: 120,
    },
    {
      task: "audio.transcribe",
      input: { audio_path: "{{steps.0.result}}" },
      timeout: 300,
    },
    {
      task: "llm.summarize",
      input: {
        text: "{{steps.1.result}}",
        max_length: 500,
      },
    },
  ],
  retry: {
    attempts: 2,
    backoff: "fixed",
    delay: 5000,
  },
  onProgress: [
    { $event: "emit", event: "pipeline-progress", data: { progress: "{{progress}}" } },
  ],
  onSuccess: [
    { $event: "toast", text: "Video analysis complete!" },
    { $event: "invalidate", path: "/videos" },
  ],
};

// Scheduled task with cron
export const scheduledDigest: Task = {
  type: "llm.summarize",
  backend: "auto",
  payload: {
    text: "{{dailyNews}}",  // Resolved at runtime
    style: "bullet",
  },
  cron: "0 9 * * *",  // Every day at 9 AM
  onSuccess: [
    { $event: "notify", channel: "email", message: "Daily digest: {{result}}" },
  ],
};

// Chained tasks using onSuccess
export const imageDescribeChain: Task = {
  type: "image.generate",
  backend: "modal",
  payload: {
    prompt: "A futuristic city",
  },
  onSuccess: [
    {
      $event: "enqueue",
      task: {
        type: "image.describe",
        backend: "modal",
        payload: {
          image_url: "{{result}}",
          prompt: "Describe this image in detail",
        },
      },
    },
  ],
};

// Batch embedding with priority
export const batchEmbedding: Task = {
  type: "llm.embed",
  backend: "modal",
  queue: "cpu",
  priority: 10,  // Higher priority
  payload: {
    text: [
      "First document to embed",
      "Second document to embed",
      "Third document to embed",
    ],
  },
};

// Example: Submit tasks via API
async function submitTask(task: Task): Promise<{ id: string }> {
  const response = await fetch("http://localhost:3000/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit task: ${response.statusText}`);
  }

  return response.json();
}

// Example: Poll for task completion
async function waitForTask(taskId: string): Promise<unknown> {
  while (true) {
    const response = await fetch(`http://localhost:3000/api/tasks/${taskId}`);
    const status = await response.json();

    if (status.status === "completed") {
      return status.result;
    }

    if (status.status === "failed") {
      throw new Error(status.error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Main example
async function main() {
  console.log("Submitting chat task...");
  const { id } = await submitTask(chatTask);
  console.log(`Task submitted: ${id}`);

  console.log("Waiting for completion...");
  const result = await waitForTask(id);
  console.log("Result:", result);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
