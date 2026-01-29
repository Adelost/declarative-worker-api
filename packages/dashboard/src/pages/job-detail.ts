/**
 * Job detail page - Shows pipeline DAG and step details.
 */

import type { Page, Section } from "@daui/core";
import type { DWAClient } from "../lib/client.js";
import { stepsToDAGNodes, type StepStatus } from "../lib/transforms.js";

/** Job detail page configuration */
export interface JobDetailPageConfig {
  /** Task ID to display */
  taskId: string | (() => string);
  /** Navigation function for back button */
  onNavigate?: (path: string) => void;
}

/**
 * Create the job detail page definition.
 */
export function jobDetailPage(
  client: DWAClient,
  config: JobDetailPageConfig
): Page {
  const { taskId, onNavigate } = config;

  // Resolve taskId
  const getTaskId = () => (typeof taskId === "function" ? taskId() : taskId);

  return {
    layout: "full",
    title: () => `Job ${getTaskId()}`,

    sections: [
      // Page header with back button and actions
      {
        molecule: "page-header",
        title: () => client.currentJob?.type ?? "Job",
        subtitle: () => getTaskId(),
        back: onNavigate ? () => onNavigate("/dwa") : undefined,
        actions: [
          {
            atom: "button",
            text: "Cancel",
            variant: "outline",
            icon: "x",
            disabled: () =>
              client.currentJob?.status !== "running" &&
              client.currentJob?.status !== "queued",
            onClick: () => client.cancelTask(getTaskId()),
          },
          {
            atom: "button",
            text: "Retry",
            variant: "outline",
            icon: "refresh-cw",
            disabled: () => client.currentJob?.status !== "failed",
            onClick: async () => {
              const newTaskId = await client.retryTask(getTaskId());
              if (newTaskId && onNavigate) {
                onNavigate(`/dwa/jobs/${newTaskId}`);
              }
            },
          },
        ],
      } as Section,

      // Status summary
      {
        molecule: "grid",
        columns: 4,
        gap: "md",
        items: [
          {
            molecule: "stat-card",
            title: "Status",
            value: () => client.currentJob?.status ?? "-",
            icon: () => {
              const status = client.currentJob?.status;
              return status === "completed"
                ? "check"
                : status === "running"
                  ? "play"
                  : status === "failed"
                    ? "x"
                    : "clock";
            },
            variant: () => {
              const status = client.currentJob?.status;
              return status === "completed"
                ? "success"
                : status === "running"
                  ? "primary"
                  : status === "failed"
                    ? "danger"
                    : "default";
            },
          },
          {
            molecule: "stat-card",
            title: "Progress",
            value: () =>
              client.currentJob?.progress !== undefined
                ? `${client.currentJob.progress}%`
                : "-",
            icon: "loader-2",
          },
          {
            molecule: "stat-card",
            title: "Duration",
            value: () => {
              const duration = client.currentJob?.totalDuration;
              if (duration === undefined) return "-";
              if (duration < 1000) return `${duration}ms`;
              return `${(duration / 1000).toFixed(1)}s`;
            },
            icon: "timer",
          },
          {
            molecule: "stat-card",
            title: "Steps",
            value: () => {
              const steps = client.currentJob?.stepStatus;
              if (!steps) return "-";
              const completed = steps.filter(
                (s) => s.status === "completed"
              ).length;
              return `${completed}/${steps.length}`;
            },
            icon: "list",
          },
        ],
      } as Section,

      // Pipeline DAG visualization
      {
        organism: "card",
        id: "pipeline-card",
        header: {
          atom: "text",
          variant: "h3",
          text: "Pipeline",
        },
        content: [
          {
            organism: "dag-view",
            id: "pipeline-dag",
            nodes: () => {
              const job = client.currentJob;
              if (!job?.steps || !job?.stepStatus) return [];
              return stepsToDAGNodes(job.steps, job.stepStatus);
            },
            layout: "horizontal",
            nodeSize: "md",
            onNodeClick: (node: { id: string }) => {
              client.selectStep(node.id);
            },
          },
        ],
      } as Section,

      // Steps table and result panels
      {
        molecule: "grid",
        columns: 2,
        gap: "md",
        items: [
          // Steps table
          {
            organism: "card",
            id: "steps-card",
            header: {
              atom: "text",
              variant: "h3",
              text: "Steps",
            },
            content: [
              {
                organism: "table",
                id: "steps-table",
                data: () => client.currentJob?.stepStatus ?? [],
                columns: [
                  {
                    field: "id",
                    header: "Step",
                  },
                  {
                    field: "task",
                    header: "Task",
                  },
                  {
                    field: "status",
                    header: "Status",
                    render: (value: unknown) => ({
                      molecule: "badge",
                      text: String(value),
                      variant:
                        value === "completed"
                          ? "success"
                          : value === "running"
                            ? "primary"
                            : value === "failed"
                              ? "danger"
                              : value === "skipped"
                                ? "warning"
                                : "default",
                    }),
                  },
                  {
                    field: "duration",
                    header: "Duration",
                    render: (value: unknown) => {
                      if (value === undefined) {
                        return { atom: "text", text: "-" };
                      }
                      const ms = value as number;
                      if (ms < 1000) return { atom: "text", text: `${ms}ms` };
                      return { atom: "text", text: `${(ms / 1000).toFixed(1)}s` };
                    },
                  },
                ],
                onRowClick: (row: unknown) => {
                  client.selectStep((row as StepStatus).id);
                },
                rowClass: (row: unknown) =>
                  (row as StepStatus).id === client.selectedStepId ? "selected" : "",
              },
            ],
          },

          // Result panel
          {
            organism: "card",
            id: "result-card",
            header: {
              atom: "text",
              variant: "h3",
              text: () =>
                client.selectedStepId
                  ? `Result: ${client.selectedStepId}`
                  : "Result",
            },
            content: [
              {
                atom: "code-block",
                code: () => {
                  const job = client.currentJob;
                  if (!job) return "// No job loaded";

                  // If a step is selected, show its result
                  if (client.selectedStepId && job.stepStatus) {
                    const step = job.stepStatus.find(
                      (s: StepStatus) => s.id === client.selectedStepId
                    );
                    if (step?.error) {
                      return `// Error\n${step.error}`;
                    }
                    if (step?.result !== undefined) {
                      return JSON.stringify(step.result, null, 2);
                    }
                    return "// No result yet";
                  }

                  // Otherwise show final result
                  if (job.error) {
                    return `// Error\n${job.error}`;
                  }
                  if (job.result !== undefined) {
                    return JSON.stringify(job.result, null, 2);
                  }
                  return "// Waiting for result...";
                },
                language: "json",
              },
            ],
          },
        ],
      } as Section,
    ],
  };
}
