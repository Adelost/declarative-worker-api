/**
 * Task dispatcher - routes tasks to appropriate backends.
 * Supports parallel execution of independent steps via DAG scheduling.
 * Supports chunking for long-running tasks.
 */

import type { Task, Step } from "@dwa/core";
import { selectBackend } from "@dwa/core";
import {
  type ChunkConfig,
  shouldChunk,
  processWithChunking,
} from "./chunking.js";

type ProgressCallback = (progress: number) => void;

/** Step execution status for observability */
export interface StepStatus {
  id: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  error?: string;
  result?: unknown;
}

/** Pipeline execution result with full observability */
export interface PipelineResult {
  steps: unknown[];
  stepResults: Record<string, unknown>;
  stepStatus: StepStatus[];
  finalResult: unknown;
  totalDuration: number;
  parallelGroups: string[][];  // Which steps ran together
}

/** Event emitter for pipeline observability */
export type PipelineEventType = "step:start" | "step:complete" | "step:error" | "pipeline:complete";
export interface PipelineEvent {
  type: PipelineEventType;
  stepId?: string;
  stepTask?: string;
  timestamp: Date;
  data?: unknown;
}
export type PipelineEventCallback = (event: PipelineEvent) => void;

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a task with retry logic.
 */
async function executeWithRetry(
  task: Task,
  executor: () => Promise<unknown>
): Promise<unknown> {
  const retry = task.retry;
  if (!retry || !retry.attempts || retry.attempts <= 1) {
    return executor();
  }

  let lastError: Error | undefined;
  const delay = retry.delay || 1000;

  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    try {
      return await executor();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retry.attempts) {
        const backoffDelay =
          retry.backoff === "exponential"
            ? delay * Math.pow(2, attempt - 1)
            : delay;
        await sleep(backoffDelay);
      }
    }
  }

  throw lastError;
}

/**
 * Process a task through the selected backend.
 * Supports automatic chunking for long-running tasks.
 */
export async function processTask(
  task: Task,
  onProgress?: ProgressCallback,
  onEvent?: PipelineEventCallback,
  chunkConfig?: ChunkConfig
): Promise<unknown> {
  // Handle pipeline tasks
  if (task.steps?.length) {
    // Check if any step has dependencies - use DAG scheduler
    const hasDependencies = task.steps.some((s) => s.dependsOn?.length || s.id);
    if (hasDependencies) {
      return processPipelineDAG(task, onProgress, onEvent);
    }
    // Legacy sequential processing
    return processPipelineSequential(task, onProgress, onEvent);
  }

  // Check if task should be chunked
  if (chunkConfig && await shouldChunk(task, chunkConfig)) {
    return processWithChunking(task, chunkConfig, async (chunkTask) => {
      const backend = await selectBackend(chunkTask);
      return executeWithRetry(chunkTask, () => backend.execute(chunkTask));
    });
  }

  // Single task execution with retry
  const backend = await selectBackend(task);
  return executeWithRetry(task, () => backend.execute(task));
}

/**
 * Process pipeline with DAG-based parallel execution.
 * Steps run in parallel when their dependencies are satisfied.
 */
async function processPipelineDAG(
  task: Task,
  onProgress?: ProgressCallback,
  onEvent?: PipelineEventCallback
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const steps = task.steps!;

  // Build step map with auto-generated IDs if needed
  const stepMap = new Map<string, Step>();
  const stepIndexToId = new Map<number, string>();

  steps.forEach((step, index) => {
    const id = step.id || `step_${index}`;
    stepMap.set(id, step);
    stepIndexToId.set(index, id);
  });

  // Results keyed by step ID
  const results: Record<string, unknown> = {};
  const completed = new Set<string>();
  const failed = new Set<string>();
  const running = new Set<string>();

  // Step status tracking for observability
  const stepStatuses: Map<string, StepStatus> = new Map();
  const parallelGroups: string[][] = [];

  // Initialize step statuses
  for (const [id, step] of stepMap) {
    stepStatuses.set(id, {
      id,
      task: step.task,
      status: "pending",
    });
  }

  // Context for template resolution
  const context = {
    payload: task.payload,
    steps: results,
  };

  // Helper to emit events
  const emit = (type: PipelineEventType, stepId?: string, data?: unknown) => {
    if (onEvent) {
      const step = stepId ? stepMap.get(stepId) : undefined;
      onEvent({
        type,
        stepId,
        stepTask: step?.task,
        timestamp: new Date(),
        data,
      });
    }
  };

  /**
   * Check if a step's dependencies are satisfied.
   */
  function canRun(step: Step, stepId: string): boolean {
    if (running.has(stepId) || completed.has(stepId) || failed.has(stepId)) {
      return false;
    }

    const deps = step.dependsOn || [];
    return deps.every((depId) => completed.has(depId));
  }

  /**
   * Get all steps that can run now.
   */
  function getRunnableSteps(): Array<{ id: string; step: Step }> {
    const runnable: Array<{ id: string; step: Step }> = [];

    for (const [id, step] of stepMap) {
      if (canRun(step, id)) {
        runnable.push({ id, step });
      }
    }

    return runnable;
  }

  /**
   * Execute a single step (with optional forEach).
   */
  async function executeStep(
    stepId: string,
    step: Step
  ): Promise<{ id: string; result?: unknown; error?: Error }> {
    running.add(stepId);

    // Update status to running
    const status = stepStatuses.get(stepId)!;
    status.status = "running";
    status.startedAt = new Date();
    emit("step:start", stepId);

    try {
      // Handle forEach - run step for each item in array
      if (step.forEach) {
        const items = resolveTemplate(step.forEach, context);

        if (!Array.isArray(items)) {
          throw new Error(
            `forEach template "${step.forEach}" did not resolve to array, got: ${typeof items}`
          );
        }

        const concurrency = step.forEachConcurrency || items.length;
        const itemResults: unknown[] = [];

        // Process items in batches based on concurrency
        for (let i = 0; i < items.length; i += concurrency) {
          const batch = items.slice(i, i + concurrency);
          const batchPromises = batch.map(async (item, batchIndex) => {
            const index = i + batchIndex;
            const itemContext = {
              ...context,
              item,
              index,
            };

            const resolvedInput = resolveTemplates(step.input || {}, itemContext);

            const stepTask: Task = {
              type: step.task,
              backend: task.backend,
              payload: resolvedInput,
              resources: step.resources || task.resources,
              retry: step.retry || task.retry,
            };

            const backend = await selectBackend(stepTask);
            return executeWithRetry(stepTask, () => backend.execute(stepTask));
          });

          const batchResults = await Promise.all(batchPromises);
          itemResults.push(...batchResults);
        }

        running.delete(stepId);
        completed.add(stepId);
        results[stepId] = itemResults;

        // Update status
        status.status = "completed";
        status.completedAt = new Date();
        status.duration = status.completedAt.getTime() - status.startedAt!.getTime();
        status.result = itemResults;
        emit("step:complete", stepId, { itemCount: itemResults.length });

        return { id: stepId, result: itemResults };
      }

      // Regular single execution
      const resolvedInput = resolveTemplates(step.input || {}, context);

      const stepTask: Task = {
        type: step.task,
        backend: task.backend,
        payload: resolvedInput,
        resources: step.resources || task.resources,
        retry: step.retry || task.retry,
      };

      const backend = await selectBackend(stepTask);
      const result = await executeWithRetry(stepTask, () =>
        backend.execute(stepTask)
      );

      running.delete(stepId);
      completed.add(stepId);
      results[stepId] = result;

      // Update status
      status.status = "completed";
      status.completedAt = new Date();
      status.duration = status.completedAt.getTime() - status.startedAt!.getTime();
      status.result = result;
      emit("step:complete", stepId, result);

      return { id: stepId, result };
    } catch (error) {
      running.delete(stepId);
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (step.optional) {
        completed.add(stepId); // Mark as completed so dependents can run
        results[stepId] = { error: errorMsg, skipped: true };

        // Update status
        status.status = "skipped";
        status.completedAt = new Date();
        status.duration = status.completedAt.getTime() - status.startedAt!.getTime();
        status.error = errorMsg;
        emit("step:error", stepId, { error: errorMsg, optional: true });

        return { id: stepId, result: results[stepId] };
      }

      failed.add(stepId);

      // Update status
      status.status = "failed";
      status.completedAt = new Date();
      status.duration = status.completedAt.getTime() - status.startedAt!.getTime();
      status.error = errorMsg;
      emit("step:error", stepId, { error: errorMsg });

      return {
        id: stepId,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  // Main execution loop
  const totalSteps = steps.length;
  let processedSteps = 0;

  while (completed.size + failed.size < totalSteps) {
    const runnable = getRunnableSteps();

    if (runnable.length === 0) {
      // Check for deadlock (no runnable steps but not all completed)
      if (running.size === 0) {
        const remaining = steps
          .filter((_, i) => {
            const id = stepIndexToId.get(i)!;
            return !completed.has(id) && !failed.has(id);
          })
          .map((s) => s.task);

        throw new Error(
          `Pipeline deadlock: cannot run remaining steps [${remaining.join(", ")}]. ` +
            `Check for circular dependencies or missing dependency IDs.`
        );
      }
      // Wait for running steps to complete
      await sleep(10);
      continue;
    }

    // Track which steps ran in parallel
    if (runnable.length > 1) {
      parallelGroups.push(runnable.map(r => r.id));
    }

    // Run all runnable steps in parallel
    const executions = runnable.map(({ id, step }) => executeStep(id, step));
    const outcomes = await Promise.all(executions);

    // Check for failures
    for (const outcome of outcomes) {
      if (outcome.error) {
        throw outcome.error;
      }
    }

    // Update progress
    processedSteps = completed.size;
    const progress = Math.round((processedSteps / totalSteps) * 100);
    onProgress?.(progress);
  }

  // Build ordered results array for backward compatibility
  const orderedResults: unknown[] = [];
  steps.forEach((_, index) => {
    const id = stepIndexToId.get(index)!;
    orderedResults.push(results[id]);
  });

  const totalDuration = Date.now() - pipelineStart;

  // Emit pipeline complete
  emit("pipeline:complete", undefined, { totalDuration, stepCount: steps.length });

  return {
    steps: orderedResults,
    stepResults: results,
    stepStatus: Array.from(stepStatuses.values()),
    finalResult: orderedResults[orderedResults.length - 1],
    totalDuration,
    parallelGroups,
  };
}

/**
 * Process pipeline sequentially (legacy mode for backward compatibility).
 */
async function processPipelineSequential(
  task: Task,
  onProgress?: ProgressCallback,
  onEvent?: PipelineEventCallback
): Promise<PipelineResult> {
  const pipelineStart = Date.now();
  const steps = task.steps!;
  const stepResults: unknown[] = [];
  const stepStatuses: StepStatus[] = [];
  const context = {
    payload: task.payload,
    steps: stepResults,
  };

  // Helper to emit events
  const emit = (type: PipelineEventType, stepId?: string, data?: unknown) => {
    if (onEvent) {
      const step = stepId ? steps[parseInt(stepId.replace("step_", ""))] : undefined;
      onEvent({
        type,
        stepId,
        stepTask: step?.task,
        timestamp: new Date(),
        data,
      });
    }
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = `step_${i}`;
    const progress = Math.round((i / steps.length) * 100);
    onProgress?.(progress);

    const status: StepStatus = {
      id: stepId,
      task: step.task,
      status: "running",
      startedAt: new Date(),
    };
    stepStatuses.push(status);
    emit("step:start", stepId);

    try {
      const resolvedInput = resolveTemplates(step.input || {}, context);

      const stepTask: Task = {
        type: step.task,
        backend: task.backend,
        payload: resolvedInput,
        resources: step.resources || task.resources,
        retry: step.retry || task.retry,
      };

      const backend = await selectBackend(stepTask);
      const result = await executeWithRetry(stepTask, () =>
        backend.execute(stepTask)
      );

      stepResults.push(result);
      context.steps = stepResults;

      status.status = "completed";
      status.completedAt = new Date();
      status.duration = status.completedAt.getTime() - status.startedAt!.getTime();
      status.result = result;
      emit("step:complete", stepId, result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (step.optional) {
        stepResults.push({ error: errorMsg, skipped: true });
        status.status = "skipped";
        status.completedAt = new Date();
        status.duration = status.completedAt.getTime() - status.startedAt!.getTime();
        status.error = errorMsg;
        emit("step:error", stepId, { error: errorMsg, optional: true });
        continue;
      }

      status.status = "failed";
      status.completedAt = new Date();
      status.duration = status.completedAt.getTime() - status.startedAt!.getTime();
      status.error = errorMsg;
      emit("step:error", stepId, { error: errorMsg });
      throw error;
    }
  }

  const totalDuration = Date.now() - pipelineStart;
  emit("pipeline:complete", undefined, { totalDuration, stepCount: steps.length });

  // Build stepResults record for compatibility
  const stepResultsRecord: Record<string, unknown> = {};
  stepResults.forEach((result, i) => {
    stepResultsRecord[`step_${i}`] = result;
  });

  return {
    steps: stepResults,
    stepResults: stepResultsRecord,
    stepStatus: stepStatuses,
    finalResult: stepResults[stepResults.length - 1],
    totalDuration,
    parallelGroups: [], // Sequential has no parallel groups
  };
}

/**
 * Resolve a single template string like "{{steps.scenes.keyframes}}".
 */
function resolveTemplate(
  template: string,
  context: Record<string, unknown>
): unknown {
  if (template.startsWith("{{") && template.endsWith("}}")) {
    const path = template.slice(2, -2).trim();
    return getNestedValue(context, path);
  }
  return template;
}

/**
 * Resolve template strings like "{{payload.url}}" or "{{steps.download.path}}".
 */
function resolveTemplates(
  input: Record<string, string>,
  context: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value === "string" &&
      value.startsWith("{{") &&
      value.endsWith("}}")
    ) {
      const path = value.slice(2, -2).trim();
      resolved[key] = getNestedValue(context, path);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
