/**
 * E2E tests for parallel pipeline execution (DAG-based).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerBackend, clearBackends, type Task } from "@dwa/core";
import { processTask } from "../../packages/orchestrator/src/engine/dispatcher.js";
import { MockBackend } from "./mock-backend.js";

describe("E2E: Parallel Pipeline Execution", () => {
  let mockBackend: MockBackend;
  let executionLog: Array<{ task: string; startTime: number; endTime: number }>;

  beforeEach(() => {
    clearBackends();
    mockBackend = new MockBackend("modal");
    registerBackend(mockBackend);
    executionLog = [];

    // Setup handlers that track execution timing
    setupTimingHandlers(mockBackend, executionLog);
  });

  afterEach(() => {
    mockBackend.reset();
    clearBackends();
  });

  describe("DAG-based parallel execution", () => {
    it("should run independent steps in parallel", async () => {
      // Two independent steps with no dependencies
      const task: Task = {
        type: "parallel-test",
        backend: "modal",
        payload: {},
        steps: [
          { id: "a", task: "slow.task" }, // No dependencies
          { id: "b", task: "slow.task" }, // No dependencies
        ],
      };

      const startTime = Date.now();
      await processTask(task);
      const totalTime = Date.now() - startTime;

      // Both should run in parallel, so total time should be ~100ms, not ~200ms
      // (each slow.task takes 50ms)
      expect(totalTime).toBeLessThan(150); // Allow some overhead

      // Verify both tasks started at roughly the same time
      const timeDiff = Math.abs(executionLog[0].startTime - executionLog[1].startTime);
      expect(timeDiff).toBeLessThan(20); // Started within 20ms of each other
    });

    it("should respect dependencies and run sequentially when needed", async () => {
      const task: Task = {
        type: "sequential-test",
        backend: "modal",
        payload: {},
        steps: [
          { id: "first", task: "slow.task" },
          { id: "second", task: "slow.task", dependsOn: ["first"] },
        ],
      };

      await processTask(task);

      // Second should start after first completes
      const firstEnd = executionLog.find((e) => e.task === "slow.task")!.endTime;
      const secondStart = executionLog[1].startTime;
      expect(secondStart).toBeGreaterThanOrEqual(firstEnd);
    });

    it("should handle diamond dependency pattern", async () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      //     A
      //    / \
      //   B   C   (parallel)
      //    \ /
      //     D
      const task: Task = {
        type: "diamond-test",
        backend: "modal",
        payload: {},
        steps: [
          { id: "A", task: "instant.task" },
          { id: "B", task: "slow.task", dependsOn: ["A"] },
          { id: "C", task: "slow.task", dependsOn: ["A"] },
          { id: "D", task: "instant.task", dependsOn: ["B", "C"] },
        ],
      };

      const startTime = Date.now();
      const result = await processTask(task) as {
        steps: unknown[];
        stepResults: Record<string, unknown>;
      };
      const totalTime = Date.now() - startTime;

      // B and C should run in parallel after A
      expect(result.steps).toHaveLength(4);

      // D should have result from both B and C
      expect(result.stepResults["D"]).toBeDefined();

      // Total time should be: A (~0ms) + max(B, C) (~50ms) + D (~0ms) ≈ 50-80ms
      // NOT A + B + C + D (~100ms)
      expect(totalTime).toBeLessThan(120);
    });

    it("should handle video analysis DAG pattern", async () => {
      // Real-world video analysis pattern:
      //           download
      //              |
      //     +--------+--------+
      //     |                 |
      // extract_frames   extract_audio
      //     |                 |
      // +---+---+---+        whisper
      // |   |   |   |
      // sig yol flo fac
      // |
      // scenes
      // |
      // tags

      const task: Task = {
        type: "video-analysis",
        backend: "modal",
        payload: { url: "https://example.com/video.mp4" },
        steps: [
          { id: "download", task: "process.download", input: { url: "{{payload.url}}" } },
          { id: "frames", task: "process.extract_frames", dependsOn: ["download"] },
          { id: "audio", task: "process.extract_audio", dependsOn: ["download"] },
          { id: "siglip", task: "vision.siglip", dependsOn: ["frames"] },
          { id: "yolo", task: "vision.yolo", dependsOn: ["frames"] },
          { id: "florence", task: "vision.florence", dependsOn: ["frames"] },
          { id: "faces", task: "vision.faces", dependsOn: ["frames"] },
          { id: "whisper", task: "audio.whisper", dependsOn: ["audio"] },
          { id: "scenes", task: "video.scenes", dependsOn: ["siglip"] },
          { id: "tags", task: "video.tags", dependsOn: ["scenes"] },
        ],
      };

      const result = await processTask(task) as {
        steps: unknown[];
        stepResults: Record<string, unknown>;
      };

      // All steps should complete
      expect(result.steps).toHaveLength(10);

      // Verify dependency order by checking execution log
      const getTaskIndex = (id: string) =>
        executionLog.findIndex((e) => e.task.includes(id.split(".").pop()!));

      // download must be before frames and audio
      expect(executionLog[0].task).toContain("download");

      // scenes must be after siglip
      const siglipIdx = getTaskIndex("siglip");
      const scenesIdx = getTaskIndex("scenes");
      expect(scenesIdx).toBeGreaterThan(siglipIdx);

      // tags must be after scenes
      const tagsIdx = getTaskIndex("tags");
      expect(tagsIdx).toBeGreaterThan(scenesIdx);
    });

    it("should provide results keyed by step ID", async () => {
      const task: Task = {
        type: "named-steps",
        backend: "modal",
        payload: { text: "hello" },
        steps: [
          { id: "embed", task: "llm.embed", input: { text: "{{payload.text}}" } },
          { id: "summarize", task: "llm.summarize", input: { text: "{{payload.text}}" } },
        ],
      };

      const result = await processTask(task) as {
        steps: unknown[];
        stepResults: Record<string, unknown>;
      };

      // Results should be accessible by both index and ID
      expect(result.steps[0]).toBeDefined();
      expect(result.stepResults["embed"]).toBeDefined();
      expect(result.stepResults["summarize"]).toBeDefined();
    });

    it("should allow referencing results by step ID in templates", async () => {
      mockBackend.registerHandler("step.a", () => ({ value: 42 }));
      mockBackend.registerHandler("step.b", (payload) => ({
        received: payload.fromA,
      }));

      const task: Task = {
        type: "reference-by-id",
        backend: "modal",
        payload: {},
        steps: [
          { id: "stepA", task: "step.a" },
          { id: "stepB", task: "step.b", dependsOn: ["stepA"], input: { fromA: "{{steps.stepA.value}}" } },
        ],
      };

      const result = await processTask(task) as {
        stepResults: Record<string, { received?: number }>;
      };

      expect(result.stepResults["stepB"].received).toBe(42);
    });

    it("should detect circular dependencies", async () => {
      const task: Task = {
        type: "circular",
        backend: "modal",
        payload: {},
        steps: [
          { id: "a", task: "instant.task", dependsOn: ["b"] },
          { id: "b", task: "instant.task", dependsOn: ["a"] },
        ],
      };

      await expect(processTask(task)).rejects.toThrow("deadlock");
    });

    it("should handle optional failed step in DAG", async () => {
      mockBackend.registerHandler("failing.task", () => {
        throw new Error("Always fails");
      });

      const task: Task = {
        type: "optional-fail",
        backend: "modal",
        payload: {},
        steps: [
          { id: "start", task: "instant.task" },
          { id: "optional", task: "failing.task", dependsOn: ["start"], optional: true },
          { id: "end", task: "instant.task", dependsOn: ["optional"] },
        ],
      };

      const result = await processTask(task) as {
        stepResults: Record<string, unknown>;
      };

      // Optional step should be marked as skipped
      expect((result.stepResults["optional"] as { skipped: boolean }).skipped).toBe(true);

      // End step should still complete
      expect(result.stepResults["end"]).toBeDefined();
    });
  });

  describe("forEach iteration", () => {
    it("should run step for each item in array", async () => {
      mockBackend.registerHandler("process.item", (payload) => ({
        processed: payload.value,
        doubled: (payload.value as number) * 2,
      }));

      const task: Task = {
        type: "foreach-test",
        backend: "modal",
        payload: { items: [1, 2, 3, 4, 5] },
        steps: [
          {
            id: "process",
            task: "process.item",
            forEach: "{{payload.items}}",
            input: { value: "{{item}}" },
          },
        ],
      };

      const result = await processTask(task) as {
        stepResults: Record<string, Array<{ processed: number; doubled: number }>>;
      };

      expect(result.stepResults["process"]).toHaveLength(5);
      expect(result.stepResults["process"][0].processed).toBe(1);
      expect(result.stepResults["process"][0].doubled).toBe(2);
      expect(result.stepResults["process"][4].processed).toBe(5);
      expect(result.stepResults["process"][4].doubled).toBe(10);
    });

    it("should provide index in forEach context", async () => {
      mockBackend.registerHandler("indexed.task", (payload) => ({
        index: payload.idx,
        value: payload.val,
      }));

      const task: Task = {
        type: "foreach-index",
        backend: "modal",
        payload: { items: ["a", "b", "c"] },
        steps: [
          {
            id: "indexed",
            task: "indexed.task",
            forEach: "{{payload.items}}",
            input: { val: "{{item}}", idx: "{{index}}" },
          },
        ],
      };

      const result = await processTask(task) as {
        stepResults: Record<string, Array<{ index: number; value: string }>>;
      };

      expect(result.stepResults["indexed"][0]).toEqual({ index: 0, value: "a" });
      expect(result.stepResults["indexed"][1]).toEqual({ index: 1, value: "b" });
      expect(result.stepResults["indexed"][2]).toEqual({ index: 2, value: "c" });
    });

    it("should respect forEachConcurrency limit", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockBackend.registerHandler("concurrent.task", async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 20));
        currentConcurrent--;
        return { ok: true };
      });

      const task: Task = {
        type: "concurrency-test",
        backend: "modal",
        payload: { items: [1, 2, 3, 4, 5, 6] },
        steps: [
          {
            id: "limited",
            task: "concurrent.task",
            forEach: "{{payload.items}}",
            forEachConcurrency: 2, // Max 2 at a time
          },
        ],
      };

      await processTask(task);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("should use forEach with scene descriptions pattern", async () => {
      // Simulate the real video analysis pattern:
      // 1. Detect scenes (returns keyframes)
      // 2. Describe each keyframe with Florence

      mockBackend.registerHandler("video.detect_scenes", () => ({
        scenes: [
          { start: 0, end: 10, keyframe: "/frames/001.jpg" },
          { start: 10, end: 25, keyframe: "/frames/010.jpg" },
          { start: 25, end: 40, keyframe: "/frames/025.jpg" },
        ],
      }));

      mockBackend.registerHandler("vision.describe", (payload) => ({
        image: payload.image_path,
        description: `A scene showing ${payload.image_path}`,
        regions: [{ label: "person", bbox: [0, 0, 100, 200] }],
      }));

      const task: Task = {
        type: "scene-descriptions",
        backend: "modal",
        payload: { video: "/video.mp4" },
        steps: [
          {
            id: "scenes",
            task: "video.detect_scenes",
            input: { video_path: "{{payload.video}}" },
          },
          {
            id: "descriptions",
            task: "vision.describe",
            dependsOn: ["scenes"],
            forEach: "{{steps.scenes.scenes}}",
            input: { image_path: "{{item.keyframe}}" },
          },
        ],
      };

      const result = await processTask(task) as {
        stepResults: Record<string, unknown>;
      };

      const descriptions = result.stepResults["descriptions"] as Array<{
        image: string;
        description: string;
      }>;

      expect(descriptions).toHaveLength(3);
      expect(descriptions[0].image).toBe("/frames/001.jpg");
      expect(descriptions[1].image).toBe("/frames/010.jpg");
      expect(descriptions[2].image).toBe("/frames/025.jpg");
    });
  });

  describe("Backward compatibility", () => {
    it("should run sequentially when no IDs or dependsOn", async () => {
      const task: Task = {
        type: "legacy",
        backend: "modal",
        payload: {},
        steps: [
          { task: "slow.task" },
          { task: "slow.task" },
        ],
      };

      const startTime = Date.now();
      await processTask(task);
      const totalTime = Date.now() - startTime;

      // Should run sequentially: ~100ms total (50ms + 50ms)
      expect(totalTime).toBeGreaterThanOrEqual(90);
    });

    it("should still support {{steps.0.result}} syntax for sequential", async () => {
      mockBackend.registerHandler("return.value", () => ({ data: "test" }));
      mockBackend.registerHandler("use.value", (payload) => ({
        received: payload.input,
      }));

      const task: Task = {
        type: "legacy-templates",
        backend: "modal",
        payload: {},
        steps: [
          { task: "return.value" },
          { task: "use.value", input: { input: "{{steps.0.data}}" } },
        ],
      };

      const result = await processTask(task) as {
        steps: [unknown, { received: string }];
      };

      expect(result.steps[1].received).toBe("test");
    });
  });
});

/**
 * Setup handlers that track execution timing.
 */
function setupTimingHandlers(
  backend: MockBackend,
  log: Array<{ task: string; startTime: number; endTime: number }>
): void {
  // Slow task - takes 50ms
  backend.registerHandler("slow.task", async () => {
    const startTime = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    const endTime = Date.now();
    log.push({ task: "slow.task", startTime, endTime });
    return { completed: true };
  });

  // Instant task - returns immediately
  backend.registerHandler("instant.task", () => {
    const now = Date.now();
    log.push({ task: "instant.task", startTime: now, endTime: now });
    return { completed: true };
  });

  // Video analysis handlers
  const videoHandlers = [
    "process.download",
    "process.extract_frames",
    "process.extract_audio",
    "vision.siglip",
    "vision.yolo",
    "vision.florence",
    "vision.faces",
    "audio.whisper",
    "video.scenes",
    "video.tags",
  ];

  for (const handler of videoHandlers) {
    backend.registerHandler(handler, async () => {
      const startTime = Date.now();
      await new Promise((r) => setTimeout(r, 10)); // Small delay
      const endTime = Date.now();
      log.push({ task: handler, startTime, endTime });
      return { task: handler, completed: true };
    });
  }

  // LLM handlers for template tests
  backend.registerHandler("llm.embed", () => ({
    embedding: Array(10).fill(0.1),
  }));

  backend.registerHandler("llm.summarize", () => ({
    summary: "Test summary",
  }));
}
