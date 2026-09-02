import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  CodexEventMsgRecord,
  CodexRecord,
  CodexResponseItemRecord,
  CodexSessionMetaRecord,
  CodexTurnContextRecord,
} from "./session-converter";
import { parseCodexFile } from "./session-converter";

export interface CloneRealCodexSessionResult {
  sourcePath: string;
  destinationPath: string;
  oldSessionId: string;
  newSessionId: string;
}

export interface SeedCodexSessionOptions {
  sessionIdOrFile: string;
  promptText: string;
  outputDir?: string;
  userInstructions?: string;
  cwd?: string;
  currentDate?: string;
  timezone?: string;
}

export interface SeedCodexSessionResult extends CloneRealCodexSessionResult {
  seededPath: string;
}

async function resolveCodexSessionFile(sessionIdOrFile: string): Promise<string> {
  const homeDir = process.env.HOME || Bun.env.HOME;
  if (!homeDir) {
    throw new Error("HOME is not set");
  }

  if (sessionIdOrFile.includes("/") || sessionIdOrFile.endsWith(".jsonl")) {
    if (!existsSync(sessionIdOrFile)) {
      throw new Error(`Source file does not exist: ${sessionIdOrFile}`);
    }
    return sessionIdOrFile;
  }

  const sessionsRoot = join(homeDir, ".codex", "sessions");
  const matches: string[] = [];

  const glob1 = new Bun.Glob(`${sessionsRoot}/**/rollout-*-${sessionIdOrFile}.jsonl`);
  for await (const file of glob1.scan({ absolute: true })) {
    matches.push(file);
  }

  if (matches.length === 0) {
    const glob2 = new Bun.Glob(`${sessionsRoot}/**/*${sessionIdOrFile}*.jsonl`);
    for await (const file of glob2.scan({ absolute: true })) {
      matches.push(file);
    }
  }

  if (matches.length === 0) {
    throw new Error(`Could not find Codex session file for: ${sessionIdOrFile}`);
  }

  let bestPath = matches[0]!;
  let bestMtime = 0;

  for (const p of matches) {
    try {
      const stat = await Bun.file(p).stat();
      const mtime = stat?.mtime ? stat.mtime.getTime() : 0;
      if (mtime >= bestMtime) {
        bestMtime = mtime;
        bestPath = p;
      }
    } catch {
      // Ignore unreadable file and keep scanning.
    }
  }

  return bestPath;
}

function findSessionMetaRecord(records: CodexRecord[]): CodexSessionMetaRecord {
  const record = records.find(
    (r): r is CodexSessionMetaRecord => r.type === "session_meta"
  );

  if (!record) {
    throw new Error("No session_meta record found");
  }

  return record;
}

function buildRolloutFilename(timestamp: Date, sessionId: string): string {
  const ts = timestamp
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "");

  return `rollout-${ts}-${sessionId}.jsonl`;
}

function generateNewTurnId(): string {
  return crypto.randomUUID();
}

export async function cloneRealCodexSession(
  sessionIdOrFile: string,
  outputDir?: string
): Promise<CloneRealCodexSessionResult> {
  const sourcePath = await resolveCodexSessionFile(sessionIdOrFile);
  const sourceText = await Bun.file(sourcePath).text();
  const sourceRecords = await parseCodexFile(sourcePath);
  const sourceMeta = findSessionMetaRecord(sourceRecords);

  const oldSessionId = sourceMeta.payload.id;
  const newSessionId = crypto.randomUUID();
  const targetOutputDir = outputDir || dirname(sourcePath);

  await mkdir(targetOutputDir, { recursive: true });

  const destinationPath = join(
    targetOutputDir,
    buildRolloutFilename(new Date(), newSessionId)
  );

  const destinationText = sourceText.replaceAll(oldSessionId, newSessionId);
  await Bun.write(destinationPath, destinationText);

  const lines = destinationText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    JSON.parse(line);
  }

  return {
    sourcePath,
    destinationPath,
    oldSessionId,
    newSessionId,
  };
}

function cloneRecord<T>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T;
}

export async function seedCodexSessionFromSkeleton(
  options: SeedCodexSessionOptions
): Promise<SeedCodexSessionResult> {
  const { promptText } = options;
  if (!promptText.trim()) {
    throw new Error("promptText must not be empty");
  }

  const cloned = await cloneRealCodexSession(options.sessionIdOrFile, options.outputDir);
  const clonedRecords = await parseCodexFile(cloned.destinationPath);
  const sessionMeta = cloneRecord(findSessionMetaRecord(clonedRecords));
  const now = new Date();
  const nowIso = now.toISOString();

  sessionMeta.timestamp = nowIso;
  sessionMeta.payload.timestamp = nowIso;

  const developerMessages = clonedRecords.filter(
    (record): record is CodexResponseItemRecord =>
      record.type === "response_item" &&
      record.payload.type === "message" &&
      record.payload.role === "developer"
  );

  const lastTurnContext = clonedRecords
    .filter((record): record is CodexTurnContextRecord => record.type === "turn_context")
    .at(-1);

  if (!lastTurnContext) {
    throw new Error("No turn_context record found");
  }

  const seededTurnContext = cloneRecord(lastTurnContext);
  seededTurnContext.timestamp = nowIso;
  seededTurnContext.payload.turn_id = generateNewTurnId();
  if (options.cwd) {
    seededTurnContext.payload.cwd = options.cwd;
  }
  if (options.currentDate) {
    seededTurnContext.payload.current_date = options.currentDate;
  }
  if (options.timezone) {
    seededTurnContext.payload.timezone = options.timezone;
  }
  if (options.userInstructions !== undefined) {
    seededTurnContext.payload.user_instructions = options.userInstructions;
  }

  const userEvent: CodexEventMsgRecord = {
    timestamp: nowIso,
    type: "event_msg",
    payload: {
      type: "user_message",
      message: promptText,
      images: [],
    },
  };

  const userResponse: CodexResponseItemRecord = {
    timestamp: nowIso,
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: promptText }],
    },
  };

  const seededRecords: CodexRecord[] = [
    sessionMeta,
    ...developerMessages.map((record) => cloneRecord(record)),
    seededTurnContext,
    userEvent,
    userResponse,
  ];

  const seededText = seededRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await Bun.write(cloned.destinationPath, seededText);

  const seededPath = cloned.destinationPath;
  const seededFileName = basename(seededPath);
  if (!seededFileName.includes(cloned.newSessionId)) {
    throw new Error("Seeded file name does not contain the new session ID");
  }

  return {
    ...cloned,
    seededPath,
  };
}
