/**
 * Tests for dashboard data transforms.
 */

import { describe, it, expect } from "vitest";
import {
  stepsToDAGNodes,
  apiTaskToJobItem,
  apiTaskToJobDetail,
  countByStatus,
  type StepStatus,
  type ApiTask,
  type ApiTaskDetail,
  type JobListItem,
} from "../src/lib/transforms.js";

describe("Dashboard Transforms", () => {
  describe("stepsToDAGNodes", () => {
    it("should convert steps to DAG nodes with pending status by default", () => {
      const steps = [
        { id: "download", task: "process.download" },
        { id: "process", task: "ai.analyze", dependsOn: ["download"] },
      ];
      const stepStatus: StepStatus[] = [];

      const nodes = stepsToDAGNodes(steps, stepStatus);

      expect(nodes).toHaveLength(2);
      expect(nodes[0]).toEqual({
        id: "download",
        label: "process.download",
        status: "pending",
        progress: undefined,
        duration: undefined,
        dependsOn: undefined,
        error: undefined,
        retryAttempt: undefined,
        retryMax: undefined,
        optional: undefined,
      });
      expect(nodes[1].dependsOn).toEqual(["download"]);
    });

    it("should apply step status to nodes", () => {
      const steps = [
        { id: "step1", task: "task1" },
        { id: "step2", task: "task2" },
      ];
      const stepStatus: StepStatus[] = [
        {
          id: "step1",
          task: "task1",
          status: "completed",
          duration: 1500,
        },
        {
          id: "step2",
          task: "task2",
          status: "running",
          startedAt: new Date(),
        },
      ];

      const nodes = stepsToDAGNodes(steps, stepStatus);

      expect(nodes[0].status).toBe("completed");
      expect(nodes[0].duration).toBe(1500);
      expect(nodes[1].status).toBe("running");
      expect(nodes[1].progress).toBeDefined(); // Progress is estimated
    });

    it("should include retry info from step config", () => {
      const steps = [
        { id: "retry-step", task: "flaky.task", retry: { attempts: 3 } },
      ];
      const stepStatus: StepStatus[] = [
        {
          id: "retry-step",
          task: "flaky.task",
          status: "running",
          retryAttempt: 2,
        },
      ];

      const nodes = stepsToDAGNodes(steps, stepStatus);

      expect(nodes[0].retryAttempt).toBe(2);
      expect(nodes[0].retryMax).toBe(3);
    });

    it("should include error info for failed steps", () => {
      const steps = [{ id: "fail", task: "might.fail" }];
      const stepStatus: StepStatus[] = [
        {
          id: "fail",
          task: "might.fail",
          status: "failed",
          error: "Connection timeout",
        },
      ];

      const nodes = stepsToDAGNodes(steps, stepStatus);

      expect(nodes[0].status).toBe("failed");
      expect(nodes[0].error).toBe("Connection timeout");
    });

    it("should mark optional steps", () => {
      const steps = [{ id: "opt", task: "optional.task", optional: true }];
      const stepStatus: StepStatus[] = [];

      const nodes = stepsToDAGNodes(steps, stepStatus);

      expect(nodes[0].optional).toBe(true);
    });

    it("should generate IDs for steps without explicit IDs", () => {
      const steps = [
        { task: "task1" },
        { task: "task2" },
      ];
      const stepStatus: StepStatus[] = [];

      const nodes = stepsToDAGNodes(steps, stepStatus);

      expect(nodes[0].id).toBe("step_0");
      expect(nodes[1].id).toBe("step_1");
    });
  });

  describe("apiTaskToJobItem", () => {
    it("should convert API task to job list item", () => {
      const apiTask: ApiTask = {
        id: "task-123",
        status: "running",
        type: "video.process",
        queue: "gpu",
        progress: 45,
        createdAt: "2024-01-15T10:00:00Z",
        startedAt: "2024-01-15T10:00:05Z",
      };

      const item = apiTaskToJobItem(apiTask);

      expect(item.taskId).toBe("task-123");
      expect(item.type).toBe("video.process");
      expect(item.status).toBe("running");
      expect(item.queue).toBe("gpu");
      expect(item.progress).toBe(45);
      expect(item.createdAt).toBeInstanceOf(Date);
      expect(item.startedAt).toBeInstanceOf(Date);
    });

    it("should map pending status to queued", () => {
      const apiTask: ApiTask = { id: "1", status: "pending" };
      expect(apiTaskToJobItem(apiTask).status).toBe("queued");
    });

    it("should map completed status correctly", () => {
      const apiTask: ApiTask = { id: "1", status: "completed" };
      expect(apiTaskToJobItem(apiTask).status).toBe("completed");
    });

    it("should map failed status correctly", () => {
      const apiTask: ApiTask = { id: "1", status: "failed" };
      expect(apiTaskToJobItem(apiTask).status).toBe("failed");
    });

    it("should map cancelled to failed", () => {
      const apiTask: ApiTask = { id: "1", status: "cancelled" };
      expect(apiTaskToJobItem(apiTask).status).toBe("failed");
    });

    it("should default type to unknown", () => {
      const apiTask: ApiTask = { id: "1", status: "running" };
      expect(apiTaskToJobItem(apiTask).type).toBe("unknown");
    });
  });

  describe("apiTaskToJobDetail", () => {
    it("should convert API task detail to job detail", () => {
      const apiTask: ApiTaskDetail = {
        id: "task-456",
        status: "completed",
        type: "pipeline",
        result: { output: "success" },
        totalDuration: 5000,
        steps: [{ id: "s1", task: "t1" }],
        stepStatus: [{ id: "s1", task: "t1", status: "completed" }],
      };

      const detail = apiTaskToJobDetail(apiTask);

      expect(detail.taskId).toBe("task-456");
      expect(detail.status).toBe("completed");
      expect(detail.result).toEqual({ output: "success" });
      expect(detail.totalDuration).toBe(5000);
      expect(detail.steps).toHaveLength(1);
      expect(detail.stepStatus).toHaveLength(1);
    });

    it("should include error for failed tasks", () => {
      const apiTask: ApiTaskDetail = {
        id: "1",
        status: "failed",
        error: "Task execution failed",
      };

      const detail = apiTaskToJobDetail(apiTask);

      expect(detail.status).toBe("failed");
      expect(detail.error).toBe("Task execution failed");
    });
  });

  describe("countByStatus", () => {
    const jobs: JobListItem[] = [
      { taskId: "1", type: "t", status: "running" },
      { taskId: "2", type: "t", status: "running" },
      { taskId: "3", type: "t", status: "queued" },
      { taskId: "4", type: "t", status: "completed" },
      { taskId: "5", type: "t", status: "completed" },
      { taskId: "6", type: "t", status: "completed" },
      { taskId: "7", type: "t", status: "failed" },
    ];

    it("should count running jobs", () => {
      expect(countByStatus(jobs, "running")).toBe(2);
    });

    it("should count queued jobs", () => {
      expect(countByStatus(jobs, "queued")).toBe(1);
    });

    it("should count completed jobs", () => {
      expect(countByStatus(jobs, "completed")).toBe(3);
    });

    it("should count failed jobs", () => {
      expect(countByStatus(jobs, "failed")).toBe(1);
    });

    it("should return 0 for empty list", () => {
      expect(countByStatus([], "running")).toBe(0);
    });
  });
});
