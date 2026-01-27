/**
 * Pipeline visualization utilities.
 * Generates Mermaid diagrams for pipeline DAGs.
 */

import type { Task, Step } from "@dwa/core";

/**
 * Generate a Mermaid flowchart diagram for a pipeline.
 */
export function visualizePipeline(task: Task): string {
  const steps = task.steps || [];
  if (steps.length === 0) return "graph LR\n  empty[No steps]";

  const lines: string[] = ["graph TD"];

  // Build step map
  const stepMap = new Map<string, { step: Step; index: number }>();
  steps.forEach((step, index) => {
    const id = step.id || `step_${index}`;
    stepMap.set(id, { step, index });
  });

  // Add nodes
  for (const [id, { step }] of stepMap) {
    const label = step.task.replace(/\./g, "\\n");
    const shape = step.forEach ? `${id}{{${label}\\nforEach}}` : `${id}[${label}]`;
    lines.push(`  ${shape}`);
  }

  // Add edges
  for (const [id, { step, index }] of stepMap) {
    const deps = step.dependsOn || [];

    if (deps.length === 0 && index > 0) {
      // No explicit deps - check if it has an id (DAG mode)
      // If not, it's sequential mode - connect to previous
      const hasExplicitIds = steps.some(s => s.id || s.dependsOn?.length);
      if (!hasExplicitIds) {
        const prevId = `step_${index - 1}`;
        lines.push(`  ${prevId} --> ${id}`);
      }
    }

    for (const depId of deps) {
      lines.push(`  ${depId} --> ${id}`);
    }
  }

  // Style optional steps
  const optionalSteps = Array.from(stepMap.entries())
    .filter(([, { step }]) => step.optional)
    .map(([id]) => id);

  if (optionalSteps.length > 0) {
    lines.push(`  style ${optionalSteps.join(",")} stroke-dasharray: 5 5`);
  }

  return lines.join("\n");
}

/**
 * Generate ASCII art visualization for terminal output.
 */
export function visualizePipelineAscii(task: Task): string {
  const steps = task.steps || [];
  if (steps.length === 0) return "No steps";

  const lines: string[] = [];
  const stepMap = new Map<string, { step: Step; index: number }>();

  steps.forEach((step, index) => {
    const id = step.id || `step_${index}`;
    stepMap.set(id, { step, index });
  });

  // Find roots (steps with no dependencies)
  const roots: string[] = [];
  for (const [id, { step }] of stepMap) {
    if (!step.dependsOn?.length) {
      roots.push(id);
    }
  }

  // Build dependency levels
  const levels: string[][] = [];
  const visited = new Set<string>();

  function getLevel(id: string): number {
    const { step } = stepMap.get(id)!;
    if (!step.dependsOn?.length) return 0;
    return Math.max(...step.dependsOn.map(d => getLevel(d))) + 1;
  }

  for (const [id] of stepMap) {
    const level = getLevel(id);
    if (!levels[level]) levels[level] = [];
    levels[level].push(id);
  }

  // Render levels
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const boxes = level.map(id => {
      const { step } = stepMap.get(id)!;
      const taskName = step.task.length > 20 ? step.task.slice(0, 17) + "..." : step.task;
      const forEach = step.forEach ? " [×N]" : "";
      return `[${id}: ${taskName}${forEach}]`;
    });

    if (i > 0) {
      // Draw connectors
      const prevLevel = levels[i - 1];
      const connectors: string[] = [];

      for (const id of level) {
        const { step } = stepMap.get(id)!;
        const deps = step.dependsOn || [];
        const depIndices = deps.map(d => prevLevel.indexOf(d)).filter(idx => idx >= 0);

        if (depIndices.length > 0) {
          connectors.push("    │");
          connectors.push("    ▼");
        }
      }

      if (connectors.length > 0) {
        lines.push(connectors[0]);
        lines.push(connectors[1]);
      } else {
        lines.push("    │");
        lines.push("    ▼");
      }
    }

    lines.push(boxes.join("  "));
  }

  return lines.join("\n");
}

/**
 * Generate a simple JSON representation of the DAG for external tools.
 */
export function getPipelineGraph(task: Task): {
  nodes: Array<{ id: string; task: string; forEach?: boolean; optional?: boolean }>;
  edges: Array<{ from: string; to: string }>;
} {
  const steps = task.steps || [];
  const nodes: Array<{ id: string; task: string; forEach?: boolean; optional?: boolean }> = [];
  const edges: Array<{ from: string; to: string }> = [];

  steps.forEach((step, index) => {
    const id = step.id || `step_${index}`;
    nodes.push({
      id,
      task: step.task,
      forEach: !!step.forEach,
      optional: step.optional,
    });

    for (const depId of step.dependsOn || []) {
      edges.push({ from: depId, to: id });
    }
  });

  return { nodes, edges };
}
