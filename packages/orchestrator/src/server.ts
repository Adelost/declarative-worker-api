/**
 * Fastify server for the orchestrator API.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Task } from "@dwa/core";
import { registerBackend } from "@dwa/core";
import { enqueueTask, getTaskStatus, createWorkers, shutdown } from "./queue.js";
import { ModalBackend } from "./backends/modal.js";
import { RayBackend } from "./backends/ray.js";

const fastify = Fastify({
  logger: true,
});

// Enable CORS
await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || true,
});

// Register backends
const modalUrl = process.env.MODAL_URL;
if (modalUrl) {
  registerBackend(
    new ModalBackend({
      url: modalUrl,
      token: process.env.MODAL_TOKEN,
    })
  );
  fastify.log.info(`Registered Modal backend: ${modalUrl}`);
}

const rayUrl = process.env.RAY_URL;
if (rayUrl) {
  registerBackend(
    new RayBackend({
      url: rayUrl,
      dashboardUrl: process.env.RAY_DASHBOARD_URL,
    })
  );
  fastify.log.info(`Registered Ray backend: ${rayUrl}`);
}

// Health check
fastify.get("/health", async () => {
  return { status: "healthy", timestamp: new Date().toISOString() };
});

// Create task
fastify.post<{ Body: Task }>("/api/tasks", async (request, reply) => {
  const task = request.body;

  if (!task.type) {
    return reply.status(400).send({ error: "task.type is required" });
  }

  if (!task.payload) {
    return reply.status(400).send({ error: "task.payload is required" });
  }

  try {
    const jobId = await enqueueTask(task);
    return {
      id: jobId,
      status: "pending",
      queue: task.queue || "default",
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({
      error: error instanceof Error ? error.message : "Failed to enqueue task",
    });
  }
});

// Get task status
fastify.get<{
  Params: { id: string };
  Querystring: { queue?: string };
}>("/api/tasks/:id", async (request, reply) => {
  const { id } = request.params;
  const { queue } = request.query;

  const status = await getTaskStatus(id, queue);

  if (!status) {
    return reply.status(404).send({ error: "Task not found" });
  }

  return status;
});

// List tasks with actual job data
fastify.get<{
  Querystring: { queue?: string; status?: string; limit?: number };
}>("/api/tasks", async (request) => {
  const { queue: queueName = "default", status, limit = 50 } = request.query;

  const { listTasks } = await import("./queue.js");
  const tasks = await listTasks(queueName, status, limit);

  return {
    queue: queueName,
    count: tasks.length,
    tasks,
  };
});

// Visualize pipeline DAG (returns Mermaid diagram)
fastify.post<{ Body: Task }>("/api/visualize", async (request, reply) => {
  const task = request.body;

  if (!task.steps?.length) {
    return reply.status(400).send({ error: "No steps in task" });
  }

  const { visualizePipeline } = await import("./engine/visualize.js");
  const diagram = visualizePipeline(task);

  return {
    mermaid: diagram,
    url: `https://mermaid.live/edit#pako:${Buffer.from(JSON.stringify({ code: diagram })).toString("base64")}`,
  };
});

// Cancel task
fastify.delete<{
  Params: { id: string };
  Querystring: { queue?: string };
}>("/api/tasks/:id", async (request, reply) => {
  const { id } = request.params;
  const { queue = "default" } = request.query;

  const status = await getTaskStatus(id, queue);

  if (!status) {
    return reply.status(404).send({ error: "Task not found" });
  }

  if (status.status === "completed" || status.status === "failed") {
    return reply.status(400).send({ error: "Task already finished" });
  }

  // Note: Actual cancellation requires worker cooperation
  return { id, cancelled: true };
});

// Start workers and server
async function start() {
  // Create workers
  const workers = createWorkers();
  fastify.log.info("Workers started");

  // Graceful shutdown
  const signals = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, shutting down...`);

      await Promise.all([
        workers.default.close(),
        workers.gpu.close(),
        workers.cpu.close(),
      ]);

      await shutdown();
      await fastify.close();
      process.exit(0);
    });
  }

  // Start server
  const port = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";

  try {
    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on ${host}:${port}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

start();
