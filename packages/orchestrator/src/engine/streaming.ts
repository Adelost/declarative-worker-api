/**
 * Streaming support for tasks that yield results incrementally.
 * Uses Server-Sent Events (SSE) for real-time updates.
 */

import type { Task } from "@dwa/core";

export interface StreamEvent {
  type: "chunk" | "progress" | "complete" | "error";
  data: unknown;
  timestamp: number;
}

export type StreamCallback = (event: StreamEvent) => void;

/**
 * Create SSE-formatted message.
 */
export function formatSSE(event: StreamEvent): string {
  const data = JSON.stringify(event);
  return `event: ${event.type}\ndata: ${data}\n\n`;
}

/**
 * Create a streaming response for SSE.
 */
export function createSSEResponse(headers: Record<string, string> = {}): {
  headers: Record<string, string>;
  write: (event: StreamEvent) => void;
  end: () => void;
  stream: ReadableStream<Uint8Array>;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      // Stream was cancelled by client
    },
  });

  return {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...headers,
    },
    write: (event: StreamEvent) => {
      const message = formatSSE(event);
      controller.enqueue(encoder.encode(message));
    },
    end: () => {
      controller.close();
    },
    stream,
  };
}

/**
 * Stream processor that handles generator-based tasks.
 */
export async function processStreamingTask(
  task: Task,
  generator: AsyncGenerator<unknown>,
  onChunk: StreamCallback
): Promise<unknown[]> {
  const results: unknown[] = [];
  let index = 0;

  try {
    for await (const chunk of generator) {
      results.push(chunk);
      onChunk({
        type: "chunk",
        data: { index, chunk },
        timestamp: Date.now(),
      });
      index++;
    }

    onChunk({
      type: "complete",
      data: { totalChunks: results.length },
      timestamp: Date.now(),
    });
  } catch (error) {
    onChunk({
      type: "error",
      data: { error: error instanceof Error ? error.message : String(error) },
      timestamp: Date.now(),
    });
    throw error;
  }

  return results;
}

/**
 * Create a progress stream that emits regular updates.
 */
export function createProgressStream(
  estimatedDuration: number,
  intervalMs = 1000
): {
  start: () => void;
  stop: () => void;
  onProgress: (callback: (progress: number) => void) => void;
} {
  let timer: ReturnType<typeof setInterval> | null = null;
  let startTime: number;
  let progressCallback: ((progress: number) => void) | null = null;

  return {
    start: () => {
      startTime = Date.now();
      timer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / estimatedDuration, 0.99);
        if (progressCallback) {
          progressCallback(progress);
        }
      }, intervalMs);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (progressCallback) {
        progressCallback(1.0);
      }
    },
    onProgress: (callback: (progress: number) => void) => {
      progressCallback = callback;
    },
  };
}

/**
 * Fastify plugin for SSE streaming endpoint.
 */
export function createStreamingRoutes() {
  return {
    /**
     * SSE endpoint for streaming task results.
     *
     * Example usage:
     * ```
     * const eventSource = new EventSource('/api/tasks/stream?taskId=abc123');
     * eventSource.onmessage = (e) => console.log(JSON.parse(e.data));
     * ```
     */
    streamTask: async (request: { query: { taskId: string } }, reply: {
      headers: (headers: Record<string, string>) => void;
      raw: { write: (data: string) => void; end: () => void };
    }) => {
      const { taskId } = request.query;

      // Set SSE headers
      reply.headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send initial connected event
      const sendEvent = (event: StreamEvent) => {
        reply.raw.write(formatSSE(event));
      };

      sendEvent({
        type: "progress",
        data: { status: "connected", taskId },
        timestamp: Date.now(),
      });

      // The actual streaming would be implemented based on
      // task queue events - this is a placeholder for the pattern
      return { streaming: true, taskId };
    },
  };
}

/**
 * Type guard for checking if a result is a generator.
 */
export function isAsyncGenerator(value: unknown): value is AsyncGenerator {
  return (
    value !== null &&
    typeof value === "object" &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncGenerator).next === "function"
  );
}

/**
 * Wrap a generator task result for streaming.
 */
export async function* wrapGeneratorForStreaming<T>(
  generator: AsyncGenerator<T>,
  transform?: (chunk: T, index: number) => unknown
): AsyncGenerator<unknown> {
  let index = 0;
  for await (const chunk of generator) {
    yield transform ? transform(chunk, index) : chunk;
    index++;
  }
}
