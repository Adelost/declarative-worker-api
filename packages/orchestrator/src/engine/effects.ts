/**
 * Effect handlers for task lifecycle events.
 */

import type { Effect, Task } from "@dwa/core";
import { enqueueTask } from "../queue.js";

export interface EffectContext {
  task: Task;
  jobId?: string;
  result?: unknown;
  error?: string;
  progress?: number;
}

type EffectHandler = (effect: Effect, context: EffectContext) => Promise<void>;

const handlers: Record<string, EffectHandler> = {
  toast: async (effect, context) => {
    if (effect.$event !== "toast") return;

    // Emit via WebSocket or Server-Sent Events
    console.log(`[TOAST] ${effect.variant || "info"}: ${effect.text}`);

    // In production, this would emit to connected clients
    globalThis.__toastEmitter?.emit("toast", {
      text: effect.text,
      variant: effect.variant,
      taskId: context.task.id,
    });
  },

  webhook: async (effect, context) => {
    if (effect.$event !== "webhook") return;

    const body = JSON.stringify({
      task: context.task,
      result: context.result,
      error: context.error,
      jobId: context.jobId,
    });

    await fetch(effect.url, {
      method: effect.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...effect.headers,
      },
      body,
    });
  },

  notify: async (effect, context) => {
    if (effect.$event !== "notify") return;

    const message = interpolate(effect.message, context);

    switch (effect.channel) {
      case "slack":
        await sendSlackNotification(message, effect.target);
        break;
      case "email":
        await sendEmailNotification(message, effect.target);
        break;
      case "discord":
        await sendDiscordNotification(message, effect.target);
        break;
    }
  },

  enqueue: async (effect, context) => {
    if (effect.$event !== "enqueue") return;

    // Allow referencing parent task data in child task
    const childTask = interpolateTask(effect.task, context);
    await enqueueTask(childTask);
  },

  invalidate: async (effect, context) => {
    if (effect.$event !== "invalidate") return;

    // Emit invalidation event for cache/data refresh
    console.log(`[INVALIDATE] path=${effect.path} tags=${effect.tags?.join(",")}`);

    globalThis.__invalidateEmitter?.emit("invalidate", {
      path: effect.path,
      tags: effect.tags,
      taskId: context.task.id,
    });
  },

  emit: async (effect, context) => {
    if (effect.$event !== "emit") return;

    // Emit custom event
    console.log(`[EMIT] ${effect.event}`, effect.data);

    globalThis.__eventEmitter?.emit(effect.event, {
      data: effect.data,
      taskId: context.task.id,
    });
  },
};

/**
 * Run a list of effects.
 */
export async function runEffects(
  effects: Effect[],
  context: EffectContext
): Promise<void> {
  for (const effect of effects) {
    const handler = handlers[effect.$event];
    if (handler) {
      try {
        await handler(effect, context);
      } catch (error) {
        console.error(`Effect error (${effect.$event}):`, error);
      }
    } else {
      console.warn(`Unknown effect type: ${effect.$event}`);
    }
  }
}

/**
 * Interpolate template strings in a message.
 */
function interpolate(template: string, context: EffectContext): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
    const parts = path.split(".");
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[part];
      } else {
        return `{{${path}}}`;
      }
    }

    return String(value ?? "");
  });
}

/**
 * Interpolate template values in a task definition.
 */
function interpolateTask(task: Task, context: EffectContext): Task {
  const interpolated = JSON.stringify(task);
  const resolved = interpolate(interpolated, context);
  return JSON.parse(resolved);
}

// Notification helpers (stubs - implement with actual services)
async function sendSlackNotification(message: string, channel?: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL not configured");
    return;
  }

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: channel || "#general",
      text: message,
    }),
  });
}

async function sendEmailNotification(message: string, to?: string) {
  // Implement with nodemailer, SendGrid, etc.
  console.log(`[EMAIL] To: ${to}, Message: ${message}`);
}

async function sendDiscordNotification(message: string, channel?: string) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("DISCORD_WEBHOOK_URL not configured");
    return;
  }

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
}

// Global emitter types (for SSE/WebSocket integration)
declare global {
  var __toastEmitter: { emit: (event: string, data: unknown) => void } | undefined;
  var __invalidateEmitter: { emit: (event: string, data: unknown) => void } | undefined;
  var __eventEmitter: { emit: (event: string, data: unknown) => void } | undefined;
}
