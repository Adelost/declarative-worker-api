/**
 * Ray backend client.
 */

import type {
  Backend,
  Task,
  TaskResult,
  RayConfig,
  ResourcePool,
} from "@dwa/core";

export class RayBackend implements Backend {
  name = "ray";
  private url: string;
  private dashboardUrl?: string;

  constructor(config: RayConfig) {
    this.url = config.url;
    this.dashboardUrl = config.dashboardUrl;
  }

  async execute(task: Task): Promise<unknown> {
    const res = await fetch(`${this.url}/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: task.type,
        payload: task.payload,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Ray error: ${res.status} - ${error}`);
    }

    const result = await res.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result;
  }

  async getStatus(taskId: string): Promise<TaskResult> {
    const res = await fetch(`${this.url}/status/${taskId}`);

    if (!res.ok) {
      throw new Error(`Failed to get status: ${res.status}`);
    }

    return res.json();
  }

  async cancel(taskId: string): Promise<boolean> {
    const res = await fetch(`${this.url}/cancel/${taskId}`, {
      method: "POST",
    });

    return res.ok;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getResources(): Promise<ResourcePool> {
    if (!this.dashboardUrl) {
      return {
        gpus: [],
        ram: { total: 0, available: 0 },
        vram: { total: 0, available: 0 },
      };
    }

    try {
      const res = await fetch(`${this.dashboardUrl}/api/cluster_status`);
      const data = await res.json();

      // Parse Ray cluster status
      const gpus = data.autoscaler_report?.active_nodes
        ?.flatMap((node: { gpu?: string }) =>
          node.gpu ? [{ name: node.gpu, vram: 16000, available: true }] : []
        ) || [];

      return {
        gpus,
        ram: { total: 0, available: 0 },
        vram: { total: 0, available: 0 },
      };
    } catch {
      return {
        gpus: [],
        ram: { total: 0, available: 0 },
        vram: { total: 0, available: 0 },
      };
    }
  }
}
