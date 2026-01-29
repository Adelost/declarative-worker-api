/**
 * Data transforms for converting DWA types to DAUI component formats.
 */

import type { Step, RetryConfig } from "@dwa/core";

/** Step status from the orchestrator */
export interface StepStatus {
  id: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  error?: string;
  result?: unknown;
  retryAttempt?: number;
}

/** DAG node format for DAUI DAGView */
export interface DAGNode {
  id: string;
  label: string;
  status?: "pending" | "running" | "completed" | "failed" | "skipped";
  progress?: number;
  duration?: number;
  dependsOn?: string[];
  error?: string;
  retryAttempt?: number;
  retryMax?: number;
  optional?: boolean;
}

/**
 * Convert pipeline steps and their statuses to DAGView nodes.
 */
export function stepsToDAGNodes(
  steps: Step[],
  stepStatus: StepStatus[]
): DAGNode[] {
  return steps.map((step, index) => {
    const id = step.id ?? `step_${index}`;
    const status = stepStatus.find((s) => s.id === id);

    return {
      id,
      label: step.task,
      status: status?.status ?? "pending",
      progress:
        status?.status === "running" ? estimateProgress(status) : undefined,
      duration: status?.duration,
      dependsOn: step.dependsOn,
      error: status?.error,
      retryAttempt: status?.retryAttempt,
      retryMax: step.retry?.attempts,
      optional: step.optional,
    };
  });
}

/**
 * Estimate progress for a running step.
 * Since we don't have actual progress info, we estimate based on elapsed time.
 */
function estimateProgress(status: StepStatus): number {
  if (!status.startedAt) return 0;

  const elapsed = Date.now() - new Date(status.startedAt).getTime();
  // Assume average step takes 10 seconds, cap at 95%
  return Math.min(95, Math.round((elapsed / 10000) * 100));
}

/** Job list item for the dashboard table */
export interface JobListItem {
  taskId: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
  createdAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  queue?: string;
}

/** API response for task list */
export interface ApiTask {
  id: string;
  status: string;
  type?: string;
  queue?: string;
  progress?: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Convert API task response to job list item.
 */
export function apiTaskToJobItem(task: ApiTask): JobListItem {
  return {
    taskId: task.id,
    type: task.type ?? "unknown",
    status: mapApiStatus(task.status),
    progress: task.progress,
    createdAt: task.createdAt ? new Date(task.createdAt) : undefined,
    startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
    completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
    queue: task.queue,
  };
}

/**
 * Map API status to dashboard status.
 */
function mapApiStatus(
  status: string
): "queued" | "running" | "completed" | "failed" {
  switch (status) {
    case "pending":
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      return "queued";
  }
}

/** Job detail with steps for the detail page */
export interface JobDetail {
  taskId: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
  steps?: Step[];
  stepStatus?: StepStatus[];
  result?: unknown;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  totalDuration?: number;
}

/** API response for single task */
export interface ApiTaskDetail extends ApiTask {
  result?: unknown;
  error?: string;
  steps?: Step[];
  stepStatus?: StepStatus[];
  totalDuration?: number;
}

/**
 * Convert API task detail to job detail.
 */
export function apiTaskToJobDetail(task: ApiTaskDetail): JobDetail {
  return {
    taskId: task.id,
    type: task.type ?? "unknown",
    status: mapApiStatus(task.status),
    progress: task.progress,
    steps: task.steps,
    stepStatus: task.stepStatus,
    result: task.result,
    error: task.error,
    startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
    completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
    totalDuration: task.totalDuration,
  };
}

/**
 * Count jobs by status.
 */
export function countByStatus(
  jobs: JobListItem[],
  status: JobListItem["status"]
): number {
  return jobs.filter((j) => j.status === status).length;
}
