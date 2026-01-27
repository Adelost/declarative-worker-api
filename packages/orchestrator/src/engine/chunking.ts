/**
 * Chunking support for long-running tasks.
 * Splits inputs based on task metadata and merges results.
 */

import type { Task } from "@dwa/core";

export interface ChunkConfig {
  inputField: string;
  defaultSize: string;
  overlap: string;
  mergeStrategy: string;
}

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  path?: string;
}

/**
 * Parse duration string to seconds.
 * Supports: "10m", "1h", "30s", "1h30m"
 */
export function parseDuration(duration: string): number {
  let seconds = 0;
  const hourMatch = duration.match(/(\d+)h/);
  const minMatch = duration.match(/(\d+)m/);
  const secMatch = duration.match(/(\d+)s/);

  if (hourMatch) seconds += parseInt(hourMatch[1]) * 3600;
  if (minMatch) seconds += parseInt(minMatch[1]) * 60;
  if (secMatch) seconds += parseInt(secMatch[1]);

  return seconds || 600; // Default to 10 minutes
}

/**
 * Get audio/video duration from file.
 * In a real implementation, this would use ffprobe.
 */
async function getMediaDuration(filePath: string): Promise<number> {
  // This is a placeholder - in production use ffprobe
  // For now, return a mock duration based on typical audio lengths
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    // If ffprobe fails, return 0 to skip chunking
    return 0;
  }
}

/**
 * Split an audio/video file into chunks.
 */
export async function splitMediaFile(
  inputPath: string,
  chunkSizeSeconds: number,
  overlapSeconds: number,
  outputDir: string
): Promise<ChunkInfo[]> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const { mkdir } = await import("fs/promises");
  const path = await import("path");
  const execAsync = promisify(exec);

  await mkdir(outputDir, { recursive: true });

  const duration = await getMediaDuration(inputPath);
  if (duration <= chunkSizeSeconds) {
    // No need to chunk - file is smaller than chunk size
    return [{ index: 0, start: 0, end: duration, path: inputPath }];
  }

  const chunks: ChunkInfo[] = [];
  let start = 0;
  let index = 0;

  while (start < duration) {
    const end = Math.min(start + chunkSizeSeconds, duration);
    const chunkPath = path.join(outputDir, `chunk_${index.toString().padStart(4, "0")}.wav`);

    // Use ffmpeg to extract chunk
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -ss ${start} -t ${chunkSizeSeconds + overlapSeconds} ` +
      `-c:a pcm_s16le -ar 16000 -ac 1 "${chunkPath}"`
    );

    chunks.push({
      index,
      start,
      end,
      path: chunkPath,
    });

    start = end - overlapSeconds;
    if (start >= duration) break;
    index++;
  }

  return chunks;
}

/**
 * Merge transcription results from chunks.
 */
export function mergeTranscriptions(
  results: Array<{ text: string; segments?: Array<{ start: number; end: number; text: string }> }>,
  chunks: ChunkInfo[],
  overlapSeconds: number
): { text: string; segments: Array<{ start: number; end: number; text: string }> } {
  const mergedSegments: Array<{ start: number; end: number; text: string }> = [];
  const textParts: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const chunk = chunks[i];

    if (result.segments) {
      for (const segment of result.segments) {
        // Adjust timestamps to global time
        const globalStart = chunk.start + segment.start;
        const globalEnd = chunk.start + segment.end;

        // Skip segments in overlap region (except for first chunk)
        if (i > 0 && segment.start < overlapSeconds) {
          continue;
        }

        mergedSegments.push({
          start: globalStart,
          end: globalEnd,
          text: segment.text,
        });
      }
    }

    // Handle text (skip overlap region)
    if (result.text) {
      if (i === 0) {
        textParts.push(result.text);
      } else {
        // Try to find overlap and skip duplicate text
        // This is a simple heuristic - could be improved
        textParts.push(result.text);
      }
    }
  }

  return {
    text: textParts.join(" ").trim(),
    segments: mergedSegments,
  };
}

/**
 * Check if a task should be chunked based on input size.
 */
export async function shouldChunk(
  task: Task,
  chunkConfig: ChunkConfig
): Promise<boolean> {
  const inputPath = task.payload?.[chunkConfig.inputField];
  if (!inputPath || typeof inputPath !== "string") {
    return false;
  }

  const duration = await getMediaDuration(inputPath);
  const chunkSize = parseDuration(chunkConfig.defaultSize);

  return duration > chunkSize * 1.5; // Only chunk if significantly longer
}

/**
 * Process a task with chunking.
 */
export async function processWithChunking(
  task: Task,
  chunkConfig: ChunkConfig,
  executor: (chunkTask: Task) => Promise<unknown>
): Promise<unknown> {
  const inputPath = task.payload?.[chunkConfig.inputField];
  if (!inputPath || typeof inputPath !== "string") {
    // No chunking needed - run directly
    return executor(task);
  }

  const chunkSize = parseDuration(chunkConfig.defaultSize);
  const overlap = parseDuration(chunkConfig.overlap);

  // Create temp directory for chunks
  const os = await import("os");
  const path = await import("path");
  const outputDir = path.join(os.tmpdir(), `chunks_${Date.now()}`);

  // Split the file
  const chunks = await splitMediaFile(inputPath, chunkSize, overlap, outputDir);

  if (chunks.length === 1) {
    // No chunking needed
    return executor(task);
  }

  // Process each chunk in parallel (with some concurrency limit)
  const concurrency = 4;
  const results: unknown[] = [];

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        const chunkTask: Task = {
          ...task,
          payload: {
            ...task.payload,
            [chunkConfig.inputField]: chunk.path,
            _chunk: { index: chunk.index, start: chunk.start, end: chunk.end },
          },
        };
        return executor(chunkTask);
      })
    );
    results.push(...batchResults);
  }

  // Merge results based on strategy
  if (chunkConfig.mergeStrategy === "concat_segments") {
    return mergeTranscriptions(
      results as Array<{ text: string; segments?: Array<{ start: number; end: number; text: string }> }>,
      chunks,
      overlap
    );
  }

  // Default: return array of results
  return results;
}

/**
 * Cleanup chunk files after processing.
 */
export async function cleanupChunks(outputDir: string): Promise<void> {
  const { rm } = await import("fs/promises");
  try {
    await rm(outputDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
