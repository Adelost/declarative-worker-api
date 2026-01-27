/**
 * Unit tests for effect handlers.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { runEffects, type EffectContext } from "../src/engine/effects.js";
import type { Effect, Task } from "@dwa/core";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Effect Handlers", () => {
  const mockTask: Task = {
    id: "task-123",
    type: "llm.chat",
    payload: { prompt: "Hello" },
  };

  const baseContext: EffectContext = {
    task: mockTask,
    jobId: "job-456",
  };

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });

    // Setup global emitters for testing
    globalThis.__toastEmitter = { emit: vi.fn() };
    globalThis.__invalidateEmitter = { emit: vi.fn() };
    globalThis.__eventEmitter = { emit: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.__toastEmitter;
    delete globalThis.__invalidateEmitter;
    delete globalThis.__eventEmitter;
  });

  describe("toast effect", () => {
    it("should emit toast event", async () => {
      const effects: Effect[] = [
        { $event: "toast", text: "Task completed!", variant: "success" },
      ];

      await runEffects(effects, baseContext);

      expect(globalThis.__toastEmitter?.emit).toHaveBeenCalledWith("toast", {
        text: "Task completed!",
        variant: "success",
        taskId: "task-123",
      });
    });
  });

  describe("webhook effect", () => {
    it("should call webhook with POST by default", async () => {
      const effects: Effect[] = [
        { $event: "webhook", url: "https://example.com/hook" },
      ];

      await runEffects(effects, { ...baseContext, result: { data: "test" } });

      expect(mockFetch).toHaveBeenCalledWith("https://example.com/hook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.task).toEqual(mockTask);
      expect(body.result).toEqual({ data: "test" });
    });

    it("should use specified HTTP method", async () => {
      const effects: Effect[] = [
        { $event: "webhook", url: "https://example.com/hook", method: "PUT" },
      ];

      await runEffects(effects, baseContext);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/hook",
        expect.objectContaining({ method: "PUT" })
      );
    });

    it("should include custom headers", async () => {
      const effects: Effect[] = [
        {
          $event: "webhook",
          url: "https://example.com/hook",
          headers: { "X-Custom": "value", Authorization: "Bearer token" },
        },
      ];

      await runEffects(effects, baseContext);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/hook",
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            "X-Custom": "value",
            Authorization: "Bearer token",
          },
        })
      );
    });
  });

  describe("invalidate effect", () => {
    it("should emit invalidate event with path", async () => {
      const effects: Effect[] = [
        { $event: "invalidate", path: "/api/data" },
      ];

      await runEffects(effects, baseContext);

      expect(globalThis.__invalidateEmitter?.emit).toHaveBeenCalledWith("invalidate", {
        path: "/api/data",
        tags: undefined,
        taskId: "task-123",
      });
    });

    it("should emit invalidate event with tags", async () => {
      const effects: Effect[] = [
        { $event: "invalidate", tags: ["users", "cache"] },
      ];

      await runEffects(effects, baseContext);

      expect(globalThis.__invalidateEmitter?.emit).toHaveBeenCalledWith("invalidate", {
        path: undefined,
        tags: ["users", "cache"],
        taskId: "task-123",
      });
    });
  });

  describe("emit effect", () => {
    it("should emit custom event", async () => {
      const effects: Effect[] = [
        { $event: "emit", event: "custom-event", data: { key: "value" } },
      ];

      await runEffects(effects, baseContext);

      expect(globalThis.__eventEmitter?.emit).toHaveBeenCalledWith("custom-event", {
        data: { key: "value" },
        taskId: "task-123",
      });
    });
  });

  describe("multiple effects", () => {
    it("should run all effects in order", async () => {
      const effects: Effect[] = [
        { $event: "toast", text: "Starting..." },
        { $event: "webhook", url: "https://example.com/hook" },
        { $event: "toast", text: "Done!" },
      ];

      await runEffects(effects, baseContext);

      expect(globalThis.__toastEmitter?.emit).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should continue on effect error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const effects: Effect[] = [
        { $event: "webhook", url: "https://example.com/hook" },
        { $event: "toast", text: "Done!" },
      ];

      // Should not throw
      await runEffects(effects, baseContext);

      // Toast should still be called
      expect(globalThis.__toastEmitter?.emit).toHaveBeenCalled();
    });
  });

  describe("context interpolation", () => {
    it("should interpolate error message in notify", async () => {
      const effects: Effect[] = [
        { $event: "notify", channel: "slack", message: "Error: {{error}}" },
      ];

      await runEffects(effects, { ...baseContext, error: "Connection failed" });

      // Note: notify handler logs but doesn't emit (no webhook configured)
      // Just verify it doesn't throw
    });
  });
});
