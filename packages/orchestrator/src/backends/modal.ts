/**
 * Modal backend client.
 */

import type {
  Backend,
  Task,
  TaskResult,
  ModalConfig,
  ResourcePool,
} from "@dwa/core";

export class ModalBackend implements Backend {
  name = "modal";
  private url: string;
  private token?: string;
  private timeout: number;

  constructor(config: ModalConfig) {
    this.url = config.url;
    this.token = config.token;
    this.timeout = (config.timeout || 120) * 1000;
  }

  async execute(task: Task): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.url}/run_task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token && { Authorization: `Bearer ${this.token}` }),
        },
        body: JSON.stringify({
          task_type: task.type,
          payload: task.payload,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Modal error: ${res.status} - ${error}`);
      }

      const result = await res.json();

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getStatus(taskId: string): Promise<TaskResult> {
    const res = await fetch(`${this.url}/status/${taskId}`, {
      headers: {
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to get status: ${res.status}`);
    }

    return res.json();
  }

  async cancel(taskId: string): Promise<boolean> {
    const res = await fetch(`${this.url}/cancel/${taskId}`, {
      method: "POST",
      headers: {
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
      },
    });

    return res.ok;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health_check`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getResources(): Promise<ResourcePool> {
    // Modal manages resources internally
    // Return a placeholder indicating GPU availability
    return {
      gpus: [
        { name: "T4", vram: 16000, available: true },
        { name: "A10G", vram: 24000, available: true },
        { name: "A100", vram: 40000, available: true },
      ],
      ram: { total: 32000, available: 32000 },
      vram: { total: 80000, available: 80000 },
    };
  }
}
