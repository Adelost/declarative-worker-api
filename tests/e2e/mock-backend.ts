/**
 * Mock backend for e2e testing.
 * Simulates Modal/Ray responses without actual network calls.
 */

import type { Backend, Task, TaskResult, ResourcePool } from "@dwa/core";

export interface MockTaskHandler {
  (payload: Record<string, unknown>): unknown | Promise<unknown>;
}

export class MockBackend implements Backend {
  name: string;
  private handlers: Map<string, MockTaskHandler> = new Map();
  private healthy = true;
  private executionDelay = 0;
  private resources: ResourcePool;
  public executedTasks: Task[] = [];

  constructor(name: string = "mock") {
    this.name = name;
    this.resources = {
      gpus: [
        { name: "T4", vram: 16000, available: true },
        { name: "A10G", vram: 24000, available: true },
      ],
      ram: { total: 32000, available: 28000 },
      vram: { total: 40000, available: 36000 },
    };
    this.setupDefaultHandlers();
  }

  private setupDefaultHandlers() {
    // LLM handlers
    this.handlers.set("llm.chat", (payload) => ({
      response: `Mock response to: ${payload.prompt}`,
      model: payload.model || "gpt-4",
    }));

    this.handlers.set("llm.embed", (payload) => ({
      embedding: Array(1536).fill(0).map(() => Math.random()),
      model: payload.model || "text-embedding-3-small",
    }));

    this.handlers.set("llm.summarize", (payload) => ({
      summary: `Summary of text (${String(payload.text).length} chars)`,
    }));

    // Audio handlers
    this.handlers.set("audio.transcribe", (payload) => ({
      text: `Transcription of ${payload.audio_path}`,
      language: "en",
    }));

    this.handlers.set("audio.tts", (payload) => ({
      path: `/tmp/tts_${Date.now()}.mp3`,
      text: payload.text,
    }));

    // Image handlers
    this.handlers.set("image.generate", (payload) => ({
      url: `https://mock-cdn.example.com/image_${Date.now()}.png`,
      prompt: payload.prompt,
    }));

    this.handlers.set("image.describe", (payload) => ({
      description: `Description of image at ${payload.image_path}`,
    }));

    // Process handlers
    this.handlers.set("process.download", (payload) => ({
      path: `/tmp/download_${Date.now()}`,
      url: payload.url,
    }));
  }

  registerHandler(taskType: string, handler: MockTaskHandler) {
    this.handlers.set(taskType, handler);
  }

  setHealthy(healthy: boolean) {
    this.healthy = healthy;
  }

  setExecutionDelay(ms: number) {
    this.executionDelay = ms;
  }

  setResources(resources: ResourcePool) {
    this.resources = resources;
  }

  async execute(task: Task): Promise<unknown> {
    this.executedTasks.push(task);

    if (this.executionDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.executionDelay));
    }

    const handler = this.handlers.get(task.type);
    if (!handler) {
      throw new Error(`Unknown task type: ${task.type}`);
    }

    return handler(task.payload);
  }

  async getStatus(taskId: string): Promise<TaskResult> {
    return {
      id: taskId,
      status: "completed",
      result: { mock: true },
    };
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy;
  }

  async getResources(): Promise<ResourcePool> {
    return this.resources;
  }

  reset() {
    this.executedTasks = [];
    this.healthy = true;
    this.executionDelay = 0;
    this.resources = {
      gpus: [
        { name: "T4", vram: 16000, available: true },
        { name: "A10G", vram: 24000, available: true },
      ],
      ram: { total: 32000, available: 28000 },
      vram: { total: 40000, available: 36000 },
    };
  }
}
