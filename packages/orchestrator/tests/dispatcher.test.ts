/**
 * Unit tests for task dispatcher.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { processTask } from "../src/engine/dispatcher.js";
import {
  registerBackend,
  clearBackends,
  type Backend,
  type Task,
} from "@dwa/core";

// Mock backend
function createMockBackend(name: string): Backend {
  return {
    name,
    execute: vi.fn().mockImplementation(async (task: Task) => ({
      result: `Executed ${task.type}`,
      payload: task.payload,
    })),
    getStatus: vi.fn().mockResolvedValue({ id: "1", status: "completed" }),
    isHealthy: vi.fn().mockResolvedValue(true),
  };
}

describe("Task Dispatcher", () => {
  let mockBackend: Backend;

  beforeEach(() => {
    clearBackends();
    mockBackend = createMockBackend("modal");
    registerBackend(mockBackend);
  });

  describe("processTask - single task", () => {
    it("should execute a simple task", async () => {
      const task: Task = {
        type: "llm.chat",
        backend: "modal",
        payload: { prompt: "Hello" },
      };

      const result = await processTask(task);

      expect(result).toEqual({
        result: "Executed llm.chat",
        payload: { prompt: "Hello" },
      });
      expect(mockBackend.execute).toHaveBeenCalledWith(task);
    });

    it("should call progress callback", async () => {
      const task: Task = {
        type: "llm.chat",
        backend: "modal",
        payload: { prompt: "Hello" },
      };

      const onProgress = vi.fn();
      await processTask(task, onProgress);

      // Single task doesn't report progress (only pipelines do)
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  describe("processTask - pipeline", () => {
    it("should execute pipeline steps in order", async () => {
      // Mock backend to return step-specific results
      mockBackend.execute = vi.fn()
        .mockResolvedValueOnce({ result: "/tmp/audio.mp3" })
        .mockResolvedValueOnce({ result: "Transcribed text" })
        .mockResolvedValueOnce({ result: "Summary" });

      const task: Task = {
        type: "video-pipeline",
        backend: "modal",
        payload: { url: "https://example.com/video.mp4" },
        steps: [
          { task: "process.download", input: { url: "{{payload.url}}" } },
          { task: "audio.transcribe", input: { path: "{{steps.0.result}}" } },
          { task: "llm.summarize", input: { text: "{{steps.1.result}}" } },
        ],
      };

      const result = await processTask(task);

      expect(mockBackend.execute).toHaveBeenCalledTimes(3);
      const pipelineResult = result as {
        steps: unknown[];
        finalResult: unknown;
      };
      expect(pipelineResult.steps).toEqual([
        { result: "/tmp/audio.mp3" },
        { result: "Transcribed text" },
        { result: "Summary" },
      ]);
      expect(pipelineResult.finalResult).toEqual({ result: "Summary" });
    });

    it("should report progress for pipeline steps", async () => {
      mockBackend.execute = vi.fn()
        .mockResolvedValueOnce({ result: "step1" })
        .mockResolvedValueOnce({ result: "step2" });

      const task: Task = {
        type: "pipeline",
        backend: "modal",
        payload: {},
        steps: [
          { task: "step1" },
          { task: "step2" },
        ],
      };

      const onProgress = vi.fn();
      await processTask(task, onProgress);

      expect(onProgress).toHaveBeenCalledWith(0);
      expect(onProgress).toHaveBeenCalledWith(50);
    });

    it("should resolve template variables", async () => {
      mockBackend.execute = vi.fn()
        .mockResolvedValueOnce({ path: "/tmp/file.txt", size: 1024 })
        .mockResolvedValueOnce({ result: "processed" });

      const task: Task = {
        type: "pipeline",
        backend: "modal",
        payload: { inputPath: "/data/input.txt" },
        steps: [
          { task: "process.copy", input: { source: "{{payload.inputPath}}" } },
          { task: "process.analyze", input: { file: "{{steps.0.path}}" } },
        ],
      };

      await processTask(task);

      // Check first step got payload value
      expect(mockBackend.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
        payload: { source: "/data/input.txt" },
      }));

      // Check second step got first step's result
      expect(mockBackend.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
        payload: { file: "/tmp/file.txt" },
      }));
    });

    it("should continue on optional step failure", async () => {
      mockBackend.execute = vi.fn()
        .mockResolvedValueOnce({ result: "step1" })
        .mockRejectedValueOnce(new Error("Optional step failed"))
        .mockResolvedValueOnce({ result: "step3" });

      const task: Task = {
        type: "pipeline",
        backend: "modal",
        payload: {},
        steps: [
          { task: "step1" },
          { task: "step2", optional: true },
          { task: "step3" },
        ],
      };

      const result = await processTask(task);

      expect(mockBackend.execute).toHaveBeenCalledTimes(3);
      const pipelineResult = result as {
        steps: unknown[];
        finalResult: unknown;
        stepStatus?: unknown[];
      };
      expect(pipelineResult.steps).toHaveLength(3);
      expect(pipelineResult.steps[0]).toEqual({ result: "step1" });
      expect((pipelineResult.steps[1] as { skipped: boolean }).skipped).toBe(true);
      expect(pipelineResult.steps[2]).toEqual({ result: "step3" });
      expect(pipelineResult.finalResult).toEqual({ result: "step3" });
    });

    it("should fail on non-optional step failure", async () => {
      mockBackend.execute = vi.fn()
        .mockResolvedValueOnce({ result: "step1" })
        .mockRejectedValueOnce(new Error("Step failed"));

      const task: Task = {
        type: "pipeline",
        backend: "modal",
        payload: {},
        steps: [
          { task: "step1" },
          { task: "step2" },
          { task: "step3" },
        ],
      };

      await expect(processTask(task)).rejects.toThrow("Step failed");
      expect(mockBackend.execute).toHaveBeenCalledTimes(2);
    });
  });
});
