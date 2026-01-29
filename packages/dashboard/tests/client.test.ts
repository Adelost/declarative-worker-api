/**
 * Tests for DWA dashboard client.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDWAClient } from "../src/lib/client.js";

describe("DWA Client", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("createDWAClient", () => {
    it("should create a client with default config", () => {
      const client = createDWAClient({ baseUrl: "http://localhost:3000" });

      expect(client.status).toBe("disconnected");
      expect(client.jobs.data).toBeNull();
      expect(client.currentJob).toBeNull();
    });
  });

  describe("fetchJobs", () => {
    it("should fetch jobs from API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "task-1", status: "running", type: "video.process" },
          { id: "task-2", status: "completed", type: "audio.transcribe" },
        ],
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      await client.fetchJobs();

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:3000/api/tasks");
      expect(client.jobs.data).toHaveLength(2);
      expect(client.jobs.data![0].taskId).toBe("task-1");
      expect(client.jobs.data![0].status).toBe("running");
      expect(client.status).toBe("connected");
    });

    it("should handle fetch error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      await client.fetchJobs();

      expect(client.jobs.error).toBeInstanceOf(Error);
      expect(client.jobs.error!.message).toBe("Network error");
      expect(client.status).toBe("error");
    });

    it("should handle HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      await client.fetchJobs();

      expect(client.jobs.error).toBeInstanceOf(Error);
      expect(client.jobs.error!.message).toContain("500");
      expect(client.status).toBe("error");
    });

    it("should pass query parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      await client.fetchJobs({ queue: "gpu", status: "running", limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks?queue=gpu&status=running&limit=10"
      );
    });
  });

  describe("fetchJobDetail", () => {
    it("should fetch single job detail", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "task-123",
          status: "running",
          type: "pipeline",
          steps: [{ id: "s1", task: "download" }],
          stepStatus: [{ id: "s1", task: "download", status: "completed" }],
        }),
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      await client.fetchJobDetail("task-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks/task-123"
      );
      expect(client.currentJob).not.toBeNull();
      expect(client.currentJob!.taskId).toBe("task-123");
      expect(client.currentJob!.steps).toHaveLength(1);
    });
  });

  describe("cancelTask", () => {
    it("should send DELETE request to cancel task", async () => {
      // Mock cancel response
      mockFetch.mockResolvedValueOnce({ ok: true });
      // Mock refresh jobs response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      const result = await client.cancelTask("task-123");

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks/task-123",
        { method: "DELETE" }
      );
    });

    it("should return false on cancel error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Cancel failed"));

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      const result = await client.cancelTask("task-123");

      expect(result).toBe(false);
    });
  });

  describe("retryTask", () => {
    it("should send POST request to retry task", async () => {
      // Mock retry response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ taskId: "task-456" }),
      });
      // Mock refresh jobs response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      const newTaskId = await client.retryTask("task-123");

      expect(newTaskId).toBe("task-456");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/tasks/task-123/retry",
        { method: "POST" }
      );
    });

    it("should return null on retry error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Retry failed"));

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      const result = await client.retryTask("task-123");

      expect(result).toBeNull();
    });
  });

  describe("selectStep", () => {
    it("should update selected step ID", () => {
      const client = createDWAClient({ baseUrl: "http://localhost:3000" });

      expect(client.selectedStepId).toBeNull();

      client.selectStep("step-1");
      expect(client.selectedStepId).toBe("step-1");

      client.selectStep(null);
      expect(client.selectedStepId).toBeNull();
    });
  });

  describe("subscribe", () => {
    it("should notify listener on state changes", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "task-1", status: "running" }],
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      const listener = vi.fn();

      const unsubscribe = client.subscribe(listener);

      await client.fetchJobs();

      // Listener should be called for loading state change and data arrival
      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });

    it("should allow unsubscribe", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const client = createDWAClient({ baseUrl: "http://localhost:3000" });
      const listener = vi.fn();

      const unsubscribe = client.subscribe(listener);
      unsubscribe();

      await client.fetchJobs();

      // After unsubscribe, listener should not be called for subsequent changes
      // Note: It may have been called once during fetchJobs if it ran before unsubscribe completed
      const callCount = listener.mock.calls.length;

      await client.fetchJobs();

      // No additional calls after unsubscribe
      expect(listener.mock.calls.length).toBe(callCount);
    });
  });

  describe("polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should start polling with interval", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const client = createDWAClient({
        baseUrl: "http://localhost:3000",
        pollInterval: 1000,
      });

      client.startPolling();

      // Initial fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance time
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      client.stopPolling();
    });

    it("should stop polling when stopPolling is called", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const client = createDWAClient({
        baseUrl: "http://localhost:3000",
        pollInterval: 1000,
      });

      client.startPolling();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      client.stopPolling();

      await vi.advanceTimersByTimeAsync(5000);

      // Should not have made additional calls after stopping
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should not start polling twice", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const client = createDWAClient({
        baseUrl: "http://localhost:3000",
        pollInterval: 1000,
      });

      client.startPolling();
      client.startPolling(); // Second call should be ignored

      expect(mockFetch).toHaveBeenCalledTimes(1);

      client.stopPolling();
    });
  });
});
