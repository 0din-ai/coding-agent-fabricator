import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface GeminiProjectLocation {
  cwd: string;
  projectHash: string;
  projectKey: string;
  projectDir: string;
  chatsDir: string;
  historyDir: string;
}

function sanitizeProjectKey(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || "project";
}

async function readProjectRoot(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function findGeminiProjectKeyByCwd(
  rootDir: string,
  cwd: string
): Promise<string | null> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectRoot = await readProjectRoot(
        join(rootDir, entry.name, ".project_root")
      );

      if (projectRoot === cwd) {
        return entry.name;
      }
    }
  } catch {
    // Ignore missing/unreadable roots
  }

  return null;
}

async function candidateGeminiProjectKey(
  cwd: string,
  projectHash: string,
  homeDir: string
): Promise<string> {
  const tmpRoot = join(homeDir, ".gemini", "tmp");
  const historyRoot = join(homeDir, ".gemini", "history");

  const existingKey =
    (await findGeminiProjectKeyByCwd(tmpRoot, cwd)) ||
    (await findGeminiProjectKeyByCwd(historyRoot, cwd));

  if (existingKey) {
    return existingKey;
  }

  const baseKey = sanitizeProjectKey(basename(cwd));
  const baseKeyTmpRoot = await readProjectRoot(
    join(tmpRoot, baseKey, ".project_root")
  );
  const baseKeyHistoryRoot = await readProjectRoot(
    join(historyRoot, baseKey, ".project_root")
  );

  if (
    !baseKeyTmpRoot &&
    !baseKeyHistoryRoot
  ) {
    return baseKey;
  }

  if (baseKeyTmpRoot === cwd || baseKeyHistoryRoot === cwd) {
    return baseKey;
  }

  return `${baseKey}-${projectHash.slice(0, 8)}`;
}

export function generateGeminiProjectHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex");
}

export function slugifyClaudeProjectPath(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, "-") || "-";
}

export function getCurrentDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function getCurrentTimezone(): string {
  return process.env.TZ || Bun.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export async function resolveGeminiProjectLocation(
  cwd: string,
  outputDir?: string
): Promise<GeminiProjectLocation> {
  const homeDir = process.env.HOME || Bun.env.HOME || "/tmp";
  const projectHash = generateGeminiProjectHash(cwd);
  const projectKey = await candidateGeminiProjectKey(cwd, projectHash, homeDir);

  const chatsDir = outputDir || join(homeDir, ".gemini", "tmp", projectKey, "chats");
  const projectDir = dirname(chatsDir);
  const historyDir = join(homeDir, ".gemini", "history", projectKey);

  return {
    cwd,
    projectHash,
    projectKey,
    projectDir,
    chatsDir,
    historyDir,
  };
}

export async function ensureGeminiProjectLocation(
  location: GeminiProjectLocation
): Promise<void> {
  await mkdir(location.chatsDir, { recursive: true });
  await mkdir(location.historyDir, { recursive: true });

  await Bun.write(join(location.projectDir, ".project_root"), `${location.cwd}\n`);
  await Bun.write(join(location.historyDir, ".project_root"), `${location.cwd}\n`);
}
