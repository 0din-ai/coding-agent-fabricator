import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  DEFAULT_CONFIG,
  buildManifests,
  buildReviewTasks,
  createRunId,
  ensureReviewPaths,
  pruneContextPieces,
  runTasksWithLimit,
} from "../review/orchestrator";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "fabricator-review-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("review orchestrator", () => {
  test("createRunId formats ISO time", () => {
    const runId = createRunId(new Date("2026-01-13T15:30:45Z"));
    expect(runId).toBe("20260113-153045");
  });

  test("createRunId accepts prefix", () => {
    const runId = createRunId(new Date("2026-01-13T15:30:45Z"), "claude");
    expect(runId).toBe("claude-20260113-153045");
  });

  test("ensureReviewPaths creates required folders", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      reviewRoot: path.join(tempRoot, "review"),
      targets: {
        codexSessionsDir: path.join(tempRoot, "codex"),
        claudeProjectDirs: [path.join(tempRoot, "claude1")],
        repoRoot: path.join(tempRoot, "repo"),
        callTranscriptsDir: path.join(tempRoot, "transcripts"),
      },
    };

    const paths = await ensureReviewPaths(config);
    await expect(stat(paths.contextDir)).resolves.toBeDefined();
    await expect(stat(paths.blogDir)).resolves.toBeDefined();
    await expect(stat(paths.runsDir)).resolves.toBeDefined();
  });

  test("buildManifests sorts entries by mtime", async () => {
    const codexDir = path.join(tempRoot, "codex");
    const claudeDir = path.join(tempRoot, "claude");
    const reviewRoot = path.join(tempRoot, "review");
    await mkdir(codexDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });

    const olderFile = path.join(codexDir, "older.jsonl");
    const newerFile = path.join(codexDir, "newer.jsonl");
    await writeFile(olderFile, "{}\n");
    await writeFile(newerFile, "{}\n");

    const now = Date.now();
    await utimes(olderFile, now - 20000, now - 20000);
    await utimes(newerFile, now - 10000, now - 10000);

    const config = {
      ...DEFAULT_CONFIG,
      reviewRoot,
      targets: {
        codexSessionsDir: codexDir,
        claudeProjectDirs: [claudeDir],
        repoRoot: path.join(tempRoot, "repo"),
        callTranscriptsDir: path.join(tempRoot, "transcripts"),
      },
    };

    const paths = await ensureReviewPaths(config);
    const manifestPaths = await buildManifests(config, paths, "run-1");
    const manifestRaw = await readFile(manifestPaths.sessions, "utf-8");
    const manifest = JSON.parse(manifestRaw) as {
      entries: Array<{ path: string }>;
    };

    expect(manifest.entries[0]?.path).toBe(olderFile);
    expect(manifest.entries[1]?.path).toBe(newerFile);
  });

  test("pruneContextPieces keeps only newest files", async () => {
    const contextDir = path.join(tempRoot, "context");
    await mkdir(contextDir, { recursive: true });
    const fileA = path.join(contextDir, "a.md");
    const fileB = path.join(contextDir, "b.md");
    const fileC = path.join(contextDir, "c.md");
    await writeFile(fileA, "a");
    await writeFile(fileB, "b");
    await writeFile(fileC, "c");

    const now = Date.now();
    await utimes(fileA, now - 30000, now - 30000);
    await utimes(fileB, now - 20000, now - 20000);
    await utimes(fileC, now - 10000, now - 10000);

    await pruneContextPieces(contextDir, 2);

    const remaining = await Promise.all([
      stat(fileB).then(() => true).catch(() => false),
      stat(fileC).then(() => true).catch(() => false),
    ]);
    const removed = await stat(fileA).then(() => false).catch(() => true);

    expect(remaining).toEqual([true, true]);
    expect(removed).toBe(true);
  });

  test("buildReviewTasks creates analysis tasks and blog task", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      reviewRoot: path.join(tempRoot, "review"),
      targets: {
        codexSessionsDir: path.join(tempRoot, "codex"),
        claudeProjectDirs: [path.join(tempRoot, "claude1")],
        repoRoot: path.join(tempRoot, "repo"),
        callTranscriptsDir: path.join(tempRoot, "transcripts"),
      },
    };
    const paths = await ensureReviewPaths(config);
    const manifests = {
      sessions: path.join(tempRoot, "sessions.json"),
      skills: path.join(tempRoot, "skills.json"),
    };
    const runId = "run-2";

    const { analysisTasks, blogTask } = buildReviewTasks({
      config,
      paths,
      manifests,
      runId,
    });

    expect(analysisTasks).toHaveLength(2);
    expect(blogTask.type).toBe("blog");
    expect(blogTask.outputDir).toContain(runId);
  });

  test("runTasksWithLimit respects concurrency", async () => {
    const logsDir = path.join(tempRoot, "logs");
    await mkdir(logsDir, { recursive: true });
    let active = 0;
    let peak = 0;

    const runner = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const tasks = ["one", "two", "three", "four"].map((id) => ({
      id,
      type: "sessions" as const,
      prompt: "test",
      outputDir: path.join(tempRoot, id),
    }));

    await runTasksWithLimit({
      tasks,
      runner,
      maxConcurrent: 2,
      maxRetries: 0,
      logsDir,
    });

    expect(peak).toBeLessThanOrEqual(2);
  });
});
