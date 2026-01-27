/**
 * E2E tests for task execution flow.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerBackend, clearBackends, type Task } from "@dwa/core";
import { processTask } from "../../packages/orchestrator/src/engine/dispatcher.js";
import { MockBackend } from "./mock-backend.js";

describe("E2E: Task Execution", () => {
  let mockBackend: MockBackend;

  beforeEach(() => {
    clearBackends();
    mockBackend = new MockBackend("modal");
    registerBackend(mockBackend);
  });

  afterEach(() => {
    mockBackend.reset();
    clearBackends();
  });

  describe("LLM Tasks", () => {
    it("should execute llm.chat task", async () => {
      const task: Task = {
        type: "llm.chat",
        backend: "modal",
        payload: {
          prompt: "What is the capital of France?",
          model: "gpt-4",
        },
      };

      const result = await processTask(task);

      expect(result).toEqual({
        response: "Mock response to: What is the capital of France?",
        model: "gpt-4",
      });
      expect(mockBackend.executedTasks).toHaveLength(1);
    });

    it("should execute llm.embed task", async () => {
      const task: Task = {
        type: "llm.embed",
        backend: "modal",
        payload: {
          text: "Hello world",
        },
      };

      const result = await processTask(task) as { embedding: number[] };

      expect(result.embedding).toHaveLength(1536);
      expect(result.embedding.every((n) => typeof n === "number")).toBe(true);
    });

    it("should execute llm.summarize task", async () => {
      const longText = "Lorem ipsum ".repeat(100);
      const task: Task = {
        type: "llm.summarize",
        backend: "modal",
        payload: {
          text: longText,
          max_length: 100,
        },
      };

      const result = await processTask(task) as { summary: string };

      expect(result.summary).toContain("Summary of text");
    });
  });

  describe("Audio Tasks", () => {
    it("should execute audio.transcribe task", async () => {
      const task: Task = {
        type: "audio.transcribe",
        backend: "modal",
        payload: {
          audio_path: "/path/to/audio.mp3",
          language: "en",
        },
      };

      const result = await processTask(task) as { text: string };

      expect(result.text).toContain("Transcription of /path/to/audio.mp3");
    });

    it("should execute audio.tts task", async () => {
      const task: Task = {
        type: "audio.tts",
        backend: "modal",
        payload: {
          text: "Hello, world!",
          voice: "alloy",
        },
      };

      const result = await processTask(task) as { path: string };

      expect(result.path).toMatch(/\/tmp\/tts_\d+\.mp3/);
    });
  });

  describe("Image Tasks", () => {
    it("should execute image.generate task", async () => {
      const task: Task = {
        type: "image.generate",
        backend: "modal",
        payload: {
          prompt: "A beautiful sunset",
          size: "1024x1024",
        },
      };

      const result = await processTask(task) as { url: string };

      expect(result.url).toMatch(/^https:\/\/mock-cdn\.example\.com\/image_\d+\.png$/);
    });

    it("should execute image.describe task", async () => {
      const task: Task = {
        type: "image.describe",
        backend: "modal",
        payload: {
          image_path: "/path/to/image.png",
        },
      };

      const result = await processTask(task) as { description: string };

      expect(result.description).toContain("Description of image");
    });
  });

  describe("Pipeline Tasks", () => {
    it("should execute video analysis pipeline", async () => {
      // Add process.download handler
      mockBackend.registerHandler("process.download", (payload) => ({
        path: `/tmp/video_${Date.now()}.mp4`,
        url: payload.url,
      }));

      const task: Task = {
        type: "video-analysis",
        backend: "modal",
        payload: {
          url: "https://example.com/video.mp4",
        },
        steps: [
          {
            task: "process.download",
            input: { url: "{{payload.url}}" },
          },
          {
            task: "audio.transcribe",
            input: { audio_path: "{{steps.0.path}}" },
          },
          {
            task: "llm.summarize",
            input: { text: "{{steps.1.text}}" },
          },
        ],
      };

      const result = await processTask(task) as {
        steps: unknown[];
        finalResult: { summary: string };
      };

      expect(result.steps).toHaveLength(3);
      expect(mockBackend.executedTasks).toHaveLength(3);

      // Verify pipeline order
      expect(mockBackend.executedTasks[0].type).toBe("process.download");
      expect(mockBackend.executedTasks[1].type).toBe("audio.transcribe");
      expect(mockBackend.executedTasks[2].type).toBe("llm.summarize");
    });

    it("should handle optional step failure gracefully", async () => {
      mockBackend.registerHandler("optional.task", () => {
        throw new Error("This task always fails");
      });

      const task: Task = {
        type: "pipeline",
        backend: "modal",
        payload: {},
        steps: [
          { task: "llm.chat", input: { prompt: "step1" } },
          { task: "optional.task", optional: true },
          { task: "llm.chat", input: { prompt: "step3" } },
        ],
      };

      const result = await processTask(task) as { steps: unknown[] };

      expect(result.steps).toHaveLength(3);
      const step1 = result.steps[1] as { error: string; skipped: boolean };
      expect(step1.skipped).toBe(true);
      expect(step1.error).toContain("This task always fails");
    });

    it("should fail fast on required step failure", async () => {
      mockBackend.registerHandler("failing.task", () => {
        throw new Error("Critical failure");
      });

      const task: Task = {
        type: "pipeline",
        backend: "modal",
        payload: {},
        steps: [
          { task: "llm.chat", input: { prompt: "step1" } },
          { task: "failing.task" },
          { task: "llm.chat", input: { prompt: "step3" } },
        ],
      };

      await expect(processTask(task)).rejects.toThrow("Critical failure");

      // Step 3 should never execute
      expect(mockBackend.executedTasks).toHaveLength(2);
    });
  });

  describe("Backend Selection", () => {
    it("should auto-select healthy backend", async () => {
      const rayBackend = new MockBackend("ray");
      mockBackend.setHealthy(false);
      registerBackend(rayBackend);

      const task: Task = {
        type: "llm.chat",
        backend: "auto",
        payload: { prompt: "Hello" },
      };

      await processTask(task);

      // Should use ray since modal is unhealthy
      expect(rayBackend.executedTasks).toHaveLength(1);
      expect(mockBackend.executedTasks).toHaveLength(0);
    });

    it("should throw when specified backend is unhealthy", async () => {
      mockBackend.setHealthy(false);

      const task: Task = {
        type: "llm.chat",
        backend: "modal",
        payload: { prompt: "Hello" },
      };

      await expect(processTask(task)).rejects.toThrow('Backend "modal" is not healthy');
    });
  });

  describe("Progress Reporting", () => {
    it("should report progress for pipeline steps", async () => {
      const task: Task = {
        type: "pipeline",
        backend: "modal",
        payload: {},
        steps: [
          { task: "llm.chat", input: { prompt: "1" } },
          { task: "llm.chat", input: { prompt: "2" } },
          { task: "llm.chat", input: { prompt: "3" } },
          { task: "llm.chat", input: { prompt: "4" } },
        ],
      };

      const progressUpdates: number[] = [];
      await processTask(task, (progress) => progressUpdates.push(progress));

      expect(progressUpdates).toEqual([0, 25, 50, 75]);
    });
  });
});
