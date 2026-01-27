/**
 * E2E tests for effects integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Effect, Task } from "@dwa/core";
import { runEffects, type EffectContext } from "../../packages/orchestrator/src/engine/effects.js";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("E2E: Effects Integration", () => {
  const mockTask: Task = {
    id: "task-123",
    type: "llm.chat",
    payload: { prompt: "Hello" },
  };

  let toastEvents: unknown[] = [];
  let invalidateEvents: unknown[] = [];
  let customEvents: unknown[] = [];

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });

    toastEvents = [];
    invalidateEvents = [];
    customEvents = [];

    globalThis.__toastEmitter = {
      emit: (event, data) => toastEvents.push({ event, data }),
    };
    globalThis.__invalidateEmitter = {
      emit: (event, data) => invalidateEvents.push({ event, data }),
    };
    globalThis.__eventEmitter = {
      emit: (event, data) => customEvents.push({ event, data }),
    };
  });

  afterEach(() => {
    delete globalThis.__toastEmitter;
    delete globalThis.__invalidateEmitter;
    delete globalThis.__eventEmitter;
  });

  describe("Webhook Effects", () => {
    it("should send webhook with task result", async () => {
      const context: EffectContext = {
        task: mockTask,
        jobId: "job-456",
        result: { answer: "Paris is the capital of France" },
      };

      const effects: Effect[] = [
        { $event: "webhook", url: "https://api.example.com/callback" },
      ];

      await runEffects(effects, context);

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/callback");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.task.id).toBe("task-123");
      expect(body.result).toEqual({ answer: "Paris is the capital of France" });
    });

    it("should send webhook with error on failure", async () => {
      const context: EffectContext = {
        task: mockTask,
        jobId: "job-456",
        error: "API rate limit exceeded",
      };

      const effects: Effect[] = [
        { $event: "webhook", url: "https://api.example.com/errors" },
      ];

      await runEffects(effects, context);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.error).toBe("API rate limit exceeded");
    });

    it("should handle webhook failure gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const context: EffectContext = {
        task: mockTask,
        jobId: "job-456",
      };

      const effects: Effect[] = [
        { $event: "webhook", url: "https://api.example.com/callback" },
        { $event: "toast", text: "Done!" },
      ];

      // Should not throw
      await runEffects(effects, context);

      // Toast should still be emitted
      expect(toastEvents).toHaveLength(1);
    });
  });

  describe("Toast Effects", () => {
    it("should emit success toast", async () => {
      const effects: Effect[] = [
        { $event: "toast", text: "Task completed!", variant: "success" },
      ];

      await runEffects(effects, { task: mockTask });

      expect(toastEvents).toHaveLength(1);
      expect(toastEvents[0]).toEqual({
        event: "toast",
        data: {
          text: "Task completed!",
          variant: "success",
          taskId: "task-123",
        },
      });
    });

    it("should emit error toast", async () => {
      const effects: Effect[] = [
        { $event: "toast", text: "Something went wrong", variant: "error" },
      ];

      await runEffects(effects, { task: mockTask, error: "Failed" });

      expect(toastEvents[0]).toEqual({
        event: "toast",
        data: {
          text: "Something went wrong",
          variant: "error",
          taskId: "task-123",
        },
      });
    });
  });

  describe("Invalidate Effects", () => {
    it("should emit path invalidation", async () => {
      const effects: Effect[] = [
        { $event: "invalidate", path: "/api/users" },
      ];

      await runEffects(effects, { task: mockTask });

      expect(invalidateEvents).toHaveLength(1);
      expect(invalidateEvents[0]).toEqual({
        event: "invalidate",
        data: {
          path: "/api/users",
          tags: undefined,
          taskId: "task-123",
        },
      });
    });

    it("should emit tag invalidation", async () => {
      const effects: Effect[] = [
        { $event: "invalidate", tags: ["users", "profiles"] },
      ];

      await runEffects(effects, { task: mockTask });

      expect(invalidateEvents[0]).toEqual({
        event: "invalidate",
        data: {
          path: undefined,
          tags: ["users", "profiles"],
          taskId: "task-123",
        },
      });
    });
  });

  describe("Custom Emit Effects", () => {
    it("should emit custom event with data", async () => {
      const effects: Effect[] = [
        {
          $event: "emit",
          event: "analysis-complete",
          data: { documentId: "doc-123", pageCount: 10 },
        },
      ];

      await runEffects(effects, { task: mockTask });

      expect(customEvents).toHaveLength(1);
      expect(customEvents[0]).toEqual({
        event: "analysis-complete",
        data: {
          data: { documentId: "doc-123", pageCount: 10 },
          taskId: "task-123",
        },
      });
    });
  });

  describe("Effect Chains", () => {
    it("should execute all effects in sequence", async () => {
      const effects: Effect[] = [
        { $event: "toast", text: "Starting..." },
        { $event: "webhook", url: "https://api.example.com/start" },
        { $event: "emit", event: "task-started" },
        { $event: "toast", text: "Processing..." },
        { $event: "webhook", url: "https://api.example.com/end" },
        { $event: "invalidate", path: "/api/data" },
        { $event: "toast", text: "Done!" },
      ];

      await runEffects(effects, { task: mockTask, result: { success: true } });

      expect(toastEvents).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(customEvents).toHaveLength(1);
      expect(invalidateEvents).toHaveLength(1);
    });

    it("should continue after individual effect failure", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("First webhook failed"))
        .mockResolvedValueOnce({ ok: true });

      const effects: Effect[] = [
        { $event: "webhook", url: "https://api.example.com/fail" },
        { $event: "toast", text: "Still running" },
        { $event: "webhook", url: "https://api.example.com/success" },
      ];

      await runEffects(effects, { task: mockTask });

      expect(toastEvents).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
