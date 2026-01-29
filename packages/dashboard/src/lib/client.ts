/**
 * DWA Client adapter for the dashboard.
 * Provides state management for job lists and SSE subscriptions.
 *
 * This is a framework-agnostic client that can be used with any reactive
 * framework (Svelte, React, Vue, etc.) by wrapping it with the framework's
 * reactive primitives.
 */

import {
  type JobListItem,
  type JobDetail,
  type StepStatus,
  type ApiTask,
  type ApiTaskDetail,
  apiTaskToJobItem,
  apiTaskToJobDetail,
} from "./transforms.js";

/** Connection status */
export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

/** Client configuration */
export interface DWAClientConfig {
  /** Base URL for the DWA API */
  baseUrl: string;
  /** Polling interval in milliseconds (default: 2000) */
  pollInterval?: number;
  /** Pause polling when page is hidden (default: true) */
  pauseOnHidden?: boolean;
}

/** Reactive state for polling data */
export interface PollingState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
}

/** Job subscription handle */
export interface JobSubscription {
  /** Current job detail state */
  current: () => JobDetail | null;
  /** Close the subscription */
  close: () => void;
}

/** State change listener */
export type StateListener = () => void;

/**
 * Simple observable state container.
 * Notifies listeners on state changes.
 */
class ObservableState<T> {
  private _value: T;
  private listeners: Set<StateListener> = new Set();

  constructor(initial: T) {
    this._value = initial;
  }

  get value(): T {
    return this._value;
  }

  set value(newValue: T) {
    this._value = newValue;
    this.notify();
  }

  update(updater: (current: T) => T): void {
    this._value = updater(this._value);
    this.notify();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Create a DWA client for the dashboard.
 */
export function createDWAClient(config: DWAClientConfig) {
  const { baseUrl, pollInterval = 2000, pauseOnHidden = true } = config;

  // Observable state
  const statusState = new ObservableState<ConnectionStatus>("disconnected");
  const jobsState = new ObservableState<PollingState<JobListItem[]>>({
    data: null,
    loading: false,
    error: null,
    lastUpdated: null,
  });
  const currentJobState = new ObservableState<JobDetail | null>(null);
  const selectedStepIdState = new ObservableState<string | null>(null);

  // Polling control
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let isPaused = false;

  /**
   * Fetch job list from API.
   */
  async function fetchJobs(
    options: { queue?: string; status?: string; limit?: number } = {}
  ): Promise<void> {
    jobsState.update((s) => ({ ...s, loading: true }));

    try {
      const params = new URLSearchParams();
      if (options.queue) params.set("queue", options.queue);
      if (options.status) params.set("status", options.status);
      if (options.limit) params.set("limit", String(options.limit));

      const url = `${baseUrl}/api/tasks${params.toString() ? `?${params}` : ""}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as ApiTask[];
      jobsState.value = {
        data: data.map(apiTaskToJobItem),
        loading: false,
        error: null,
        lastUpdated: new Date(),
      };
      statusState.value = "connected";
    } catch (error) {
      jobsState.update((s) => ({
        ...s,
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }));
      statusState.value = "error";
    }
  }

  /**
   * Start polling for job list updates.
   */
  function startPolling(): void {
    if (pollTimer) return;

    // Initial fetch
    fetchJobs();

    // Set up interval
    pollTimer = setInterval(() => {
      if (!isPaused) {
        fetchJobs();
      }
    }, pollInterval);

    // Handle visibility change
    if (pauseOnHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    statusState.value = "connecting";
  }

  /**
   * Stop polling.
   */
  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }

    statusState.value = "disconnected";
  }

  /**
   * Handle page visibility change.
   */
  function handleVisibilityChange(): void {
    isPaused = document.hidden;
    if (!isPaused) {
      // Refresh immediately when page becomes visible
      fetchJobs();
    }
  }

  /**
   * Subscribe to a specific job's updates via SSE.
   */
  function subscribeToJob(taskId: string): JobSubscription {
    let eventSource: EventSource | null = null;

    // Fetch initial job detail
    fetchJobDetail(taskId);

    // Set up SSE subscription
    const streamUrl = `${baseUrl}/api/tasks/stream?taskId=${taskId}`;
    eventSource = new EventSource(streamUrl);

    eventSource.onopen = () => {
      statusState.value = "connected";
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleJobEvent(taskId, data);
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      statusState.value = "error";
      // Fallback to polling if SSE fails
      const pollFallback = setInterval(() => {
        fetchJobDetail(taskId);
      }, pollInterval);

      return () => {
        clearInterval(pollFallback);
      };
    };

    return {
      current: () => currentJobState.value,
      close: () => {
        eventSource?.close();
        currentJobState.value = null;
      },
    };
  }

  /**
   * Fetch a single job's detail.
   */
  async function fetchJobDetail(taskId: string): Promise<void> {
    try {
      const response = await fetch(`${baseUrl}/api/tasks/${taskId}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as ApiTaskDetail;
      currentJobState.value = apiTaskToJobDetail(data);
    } catch (error) {
      console.error("Failed to fetch job detail:", error);
    }
  }

  /**
   * Handle SSE event for a job.
   */
  function handleJobEvent(taskId: string, event: Record<string, unknown>): void {
    const currentJob = currentJobState.value;
    if (!currentJob || currentJob.taskId !== taskId) return;

    const eventType = event.type as string;

    switch (eventType) {
      case "step:start":
        updateStepStatus(event.stepId as string, {
          status: "running",
          startedAt: new Date(),
        });
        break;

      case "step:complete":
        updateStepStatus(event.stepId as string, {
          status: "completed",
          completedAt: new Date(),
          result: event.data,
        });
        break;

      case "step:error":
        updateStepStatus(event.stepId as string, {
          status: "failed",
          completedAt: new Date(),
          error: (event.data as { error?: string })?.error,
        });
        break;

      case "pipeline:complete":
        currentJobState.value = {
          ...currentJob,
          status: "completed",
          completedAt: new Date(),
          totalDuration: (event.data as { totalDuration?: number })?.totalDuration,
        };
        break;
    }
  }

  /**
   * Update a step's status in the current job.
   */
  function updateStepStatus(
    stepId: string,
    update: Partial<StepStatus>
  ): void {
    const currentJob = currentJobState.value;
    if (!currentJob?.stepStatus) return;

    const stepIndex = currentJob.stepStatus.findIndex((s: StepStatus) => s.id === stepId);
    if (stepIndex === -1) return;

    currentJobState.value = {
      ...currentJob,
      stepStatus: currentJob.stepStatus.map((s: StepStatus, i: number) =>
        i === stepIndex ? { ...s, ...update } : s
      ),
    };
  }

  /**
   * Cancel a running task.
   */
  async function cancelTask(taskId: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Refresh job list
      await fetchJobs();
      return true;
    } catch (error) {
      console.error("Failed to cancel task:", error);
      return false;
    }
  }

  /**
   * Retry a failed task.
   */
  async function retryTask(taskId: string): Promise<string | null> {
    try {
      const response = await fetch(`${baseUrl}/api/tasks/${taskId}/retry`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as { taskId: string };

      // Refresh job list
      await fetchJobs();
      return data.taskId;
    } catch (error) {
      console.error("Failed to retry task:", error);
      return null;
    }
  }

  /**
   * Select a step in the current job.
   */
  function selectStep(stepId: string | null): void {
    selectedStepIdState.value = stepId;
  }

  /**
   * Subscribe to all state changes.
   */
  function subscribe(listener: StateListener): () => void {
    const unsubs = [
      statusState.subscribe(listener),
      jobsState.subscribe(listener),
      currentJobState.subscribe(listener),
      selectedStepIdState.subscribe(listener),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }

  return {
    // Getters
    get status() {
      return statusState.value;
    },
    get jobs() {
      return jobsState.value;
    },
    get currentJob() {
      return currentJobState.value;
    },
    get selectedStepId() {
      return selectedStepIdState.value;
    },

    // Methods
    startPolling,
    stopPolling,
    fetchJobs,
    subscribeToJob,
    fetchJobDetail,
    cancelTask,
    retryTask,
    selectStep,
    subscribe,
  };
}

export type DWAClient = ReturnType<typeof createDWAClient>;
