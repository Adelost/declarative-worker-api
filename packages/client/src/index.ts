/**
 * @dwa/client
 *
 * Minimal typed SDK for declarative-worker-api.
 * Works in any Node.js/browser environment.
 *
 * For tRPC users: import the router types directly from @dwa/orchestrator
 */

import type { TaskName, TaskPayloads } from "@dwa/core";

export interface WorkerAIConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export interface TaskResult<T = unknown> {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: T;
  error?: string;
  progress?: number;
}

export interface SubmitOptions {
  /** Priority in queue (higher = sooner) */
  priority?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Webhook URL for completion notification */
  webhookUrl?: string;
}

/**
 * Worker AI DSL Client
 *
 * @example
 * ```ts
 * const ai = new WorkerAI({ baseUrl: "http://localhost:3000" });
 *
 * // Submit a task (fully typed!)
 * const { taskId } = await ai.submit("openai.chat", {
 *   messages: [{ role: "user", content: "Hello!" }]
 * });
 *
 * // Check status
 * const status = await ai.status(taskId);
 *
 * // Wait for completion
 * const result = await ai.wait(taskId);
 * ```
 */
export class WorkerAI {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: WorkerAIConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Submit a task for processing
   */
  async submit<T extends TaskName>(
    task: T,
    payload: TaskPayloads[T],
    options?: SubmitOptions
  ): Promise<{ taskId: string }> {
    const response = await this.fetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ task, payload, ...options }),
    });
    return response.json();
  }

  /**
   * Get task status
   */
  async status<T = unknown>(taskId: string): Promise<TaskResult<T>> {
    const response = await this.fetch(`/api/tasks/${taskId}`);
    return response.json();
  }

  /**
   * Wait for task completion (polls until done)
   */
  async wait<T = unknown>(
    taskId: string,
    pollInterval = 1000,
    maxWait = 300000
  ): Promise<TaskResult<T>> {
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const result = await this.status<T>(taskId);

      if (result.status === "completed" || result.status === "failed") {
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Task ${taskId} timed out after ${maxWait}ms`);
  }

  /**
   * Cancel a running task
   */
  async cancel(taskId: string): Promise<{ success: boolean }> {
    const response = await this.fetch(`/api/tasks/${taskId}`, {
      method: "DELETE",
    });
    return response.json();
  }

  /**
   * List available task types
   */
  async listTasks(): Promise<{ tasks: TaskName[] }> {
    const response = await this.fetch("/api/tasks/types");
    return response.json();
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: "ok" | "error"; version: string }> {
    const response = await this.fetch("/health");
    return response.json();
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...headers, ...init?.headers },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Convenience export
export default WorkerAI;

// Re-export types for consumers
export type { TaskName, TaskPayloads } from "@dwa/core";
