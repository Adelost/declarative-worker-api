/**
 * Dashboard page - Main view with job list and stats.
 */

import type { Page, Section } from "@daui/core";
import type { DWAClient } from "../lib/client.js";
import { countByStatus, type JobListItem } from "../lib/transforms.js";

/** Dashboard page configuration */
export interface DashboardPageConfig {
  /** Navigation function for row clicks */
  onNavigate?: (path: string) => void;
}

/**
 * Create the dashboard page definition.
 */
export function dashboardPage(
  client: DWAClient,
  config: DashboardPageConfig = {}
): Page {
  const { onNavigate } = config;

  return {
    layout: "full",
    title: "DWA Dashboard",

    sections: [
      // Page header
      {
        molecule: "page-header",
        title: "DWA Dashboard",
        subtitle: () => {
          const status = client.status;
          return status === "connected"
            ? "Connected"
            : status === "connecting"
              ? "Connecting..."
              : status === "error"
                ? "Connection error"
                : "Disconnected";
        },
      } as Section,

      // Stats row
      {
        molecule: "grid",
        columns: 4,
        gap: "md",
        items: [
          {
            molecule: "stat-card",
            title: "Running",
            value: () => countByStatus(client.jobs.data ?? [], "running"),
            icon: "play",
            variant: "primary",
          },
          {
            molecule: "stat-card",
            title: "Queued",
            value: () => countByStatus(client.jobs.data ?? [], "queued"),
            icon: "clock",
            variant: "default",
          },
          {
            molecule: "stat-card",
            title: "Completed",
            value: () => countByStatus(client.jobs.data ?? [], "completed"),
            icon: "check",
            variant: "success",
          },
          {
            molecule: "stat-card",
            title: "Failed",
            value: () => countByStatus(client.jobs.data ?? [], "failed"),
            icon: "x",
            variant: "danger",
          },
        ],
      } as Section,

      // Job list table
      {
        organism: "card",
        id: "jobs-card",
        header: {
          molecule: "stack",
          direction: "row",
          justify: "between",
          align: "center",
          items: [
            {
              atom: "text",
              variant: "h3",
              text: "Jobs",
            },
            {
              atom: "button",
              text: "Refresh",
              variant: "outline",
              size: "sm",
              icon: "refresh-cw",
              onClick: () => client.fetchJobs(),
            },
          ],
        },
        content: [
          {
            organism: "table",
            id: "jobs-table",
            data: () => client.jobs.data ?? [],
            columns: [
              {
                field: "taskId",
                header: "ID",
                width: "200px",
              },
              {
                field: "type",
                header: "Type",
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
                          : "default",
                }),
              },
              {
                field: "progress",
                header: "Progress",
                render: (value: unknown, row: JobListItem) => {
                  if (row.status !== "running" || value === undefined) {
                    return { atom: "text", text: "-" };
                  }
                  return {
                    molecule: "progress",
                    value: value as number,
                    max: 100,
                    size: "sm",
                  };
                },
              },
              {
                field: "queue",
                header: "Queue",
              },
            ],
            searchable: true,
            searchKeys: ["taskId", "type", "status"],
            searchPlaceholder: "Search jobs...",
            paginated: true,
            pageSize: 10,
            emptyText: "No jobs found",
            onRowClick: (row: JobListItem) => {
              if (onNavigate) {
                onNavigate(`/dwa/jobs/${row.taskId}`);
              }
            },
          },
        ],
      } as Section,
    ],
  };
}
