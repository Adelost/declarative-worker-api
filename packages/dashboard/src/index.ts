/**
 * @dwa/dashboard - Debug dashboard for DWA with DAUI components
 *
 * Provides plug-and-play dashboard pages for visualizing DWA pipelines
 * and monitoring job execution in real-time.
 *
 * @example
 * ```typescript
 * import { createDWADashboard } from '@dwa/dashboard';
 *
 * const dwa = createDWADashboard({
 *   apiUrl: 'http://localhost:3000'
 * });
 *
 * // Start monitoring
 * dwa.client.startPolling();
 *
 * // Use pages in your app
 * app.addPage('/debug', dwa.pages.dashboard);
 * app.addPage('/debug/jobs/:id', dwa.pages.jobDetail);
 * ```
 */

import { createDWAClient, type DWAClientConfig, type DWAClient } from "./lib/client.js";
import { dashboardPage, type DashboardPageConfig } from "./pages/dashboard.js";
import { jobDetailPage, type JobDetailPageConfig } from "./pages/job-detail.js";

// Re-export types
export type {
  DWAClient,
  DWAClientConfig,
  DashboardPageConfig,
  JobDetailPageConfig,
};

export {
  createDWAClient,
  dashboardPage,
  jobDetailPage,
};

// Re-export transforms
export {
  stepsToDAGNodes,
  apiTaskToJobItem,
  apiTaskToJobDetail,
  countByStatus,
  type DAGNode,
  type StepStatus,
  type JobListItem,
  type JobDetail,
  type ApiTask,
  type ApiTaskDetail,
} from "./lib/transforms.js";

/** Dashboard configuration */
export interface DashboardConfig {
  /** Base URL for the DWA API */
  apiUrl: string;
  /** Base path for dashboard routes (default: '/dwa') */
  basePath?: string;
  /** Polling interval in milliseconds (default: 2000) */
  pollInterval?: number;
}

/** Dashboard plugin return type */
export interface DWADashboard {
  /** DWA client for managing connections and state */
  client: DWAClient;
  /** Page factories for the dashboard */
  pages: {
    /** Main dashboard with job list and stats */
    dashboard: (config?: Partial<DashboardPageConfig>) => ReturnType<typeof dashboardPage>;
    /** Job detail with DAG visualization */
    jobDetail: (config: JobDetailPageConfig) => ReturnType<typeof jobDetailPage>;
  };
  /** Cleanup function */
  destroy: () => void;
}

/**
 * Create a DWA dashboard plugin.
 *
 * @param config - Dashboard configuration
 * @returns Dashboard plugin with client and page factories
 *
 * @example
 * ```typescript
 * const dwa = createDWADashboard({
 *   apiUrl: 'http://localhost:3000',
 *   basePath: '/debug'
 * });
 *
 * // In your app setup
 * dwa.client.startPolling();
 *
 * // Register routes
 * router.add('/debug', () => dwa.pages.dashboard());
 * router.add('/debug/jobs/:id', ({ params }) =>
 *   dwa.pages.jobDetail({
 *     taskId: params.id,
 *     onNavigate: (path) => router.navigate(path)
 *   })
 * );
 *
 * // Cleanup on app unmount
 * onDestroy(() => dwa.destroy());
 * ```
 */
export function createDWADashboard(config: DashboardConfig): DWADashboard {
  const { apiUrl, basePath = "/dwa", pollInterval = 2000 } = config;

  // Create the client
  const client = createDWAClient({
    baseUrl: apiUrl,
    pollInterval,
    pauseOnHidden: true,
  });

  return {
    client,

    pages: {
      dashboard: (pageConfig = {}) =>
        dashboardPage(client, {
          onNavigate: pageConfig.onNavigate ?? ((path) => {
            // Default navigation using window.location
            if (typeof window !== "undefined") {
              window.location.href = path;
            }
          }),
        }),

      jobDetail: (pageConfig) =>
        jobDetailPage(client, {
          taskId: pageConfig.taskId,
          onNavigate: pageConfig.onNavigate ?? ((path) => {
            if (typeof window !== "undefined") {
              window.location.href = path;
            }
          }),
        }),
    },

    destroy: () => {
      client.stopPolling();
    },
  };
}
