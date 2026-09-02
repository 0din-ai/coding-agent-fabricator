/**
 * Session Converter - Bidirectional Claude Code ↔ Codex JSONL Conversion
 *
 * Converts sessions between Claude Code (~/.claude/projects/) and
 * OpenAI Codex (~/.codex/sessions/) JSONL formats.
 */

import { mkdir, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename, dirname } from "node:path";
import {
  getCurrentDateString,
  getCurrentTimezone,
  slugifyClaudeProjectPath,
} from "./session-routing";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ISO8601Timestamp = string;
export type UUID = string;
export type ULID = string;

// --------------------------------------------------------------------------
// Claude Code Format Types
// --------------------------------------------------------------------------

export type ClaudeMessageType =
  | "user"
  | "assistant"
  | "summary"
  | "file-history-snapshot"
  | "queue-operation"
  | "attachment"
  | "last-prompt"
  | "atis-latch"
  | "mode"
  | "ai-title"
  | "pr-link"
  | "system"
  | "permission-mode"
  | "bridge-session"
  | "cost-state";

export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

export interface ClaudeThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface ClaudeFallbackBlock {
  type: "fallback";
  from: string;
  to: string;
}

export interface ClaudeImageBlock {
  type: "image";
  source: {
    type: string;
    media_type?: string;
    data?: string;
    url?: string;
    [key: string]: unknown;
  };
}

export interface ClaudeDocumentBlock {
  type: "document";
  source: {
    type: string;
    media_type?: string;
    data?: string;
    [key: string]: unknown;
  };
}

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock
  | ClaudeThinkingBlock
  | ClaudeFallbackBlock
  | ClaudeImageBlock
  | ClaudeDocumentBlock;

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  service_tier?: string;
}

export interface ClaudeRecordBase {
  type: ClaudeMessageType;
  sessionId: UUID;
  timestamp: ISO8601Timestamp;
  uuid: UUID;
  parentUuid: UUID | null;
  isSidechain: boolean;
  userType: "external" | "internal";
  cwd: string;
  version: string;
  gitBranch: string;
}

export interface ClaudeUserRecord extends ClaudeRecordBase {
  type: "user";
  message: {
    role: "user";
    content: string | ClaudeContentBlock[];
  };
  slug?: string;
}

export interface ClaudeAssistantRecord extends ClaudeRecordBase {
  type: "assistant";
  message: {
    role: "assistant";
    model: string;
    id: string;
    type: "message";
    content: ClaudeContentBlock[];
    stop_reason: "end_turn" | "tool_use" | "stop_sequence" | null;
    stop_sequence: string | null;
    usage: ClaudeUsage;
  };
  requestId?: string;
}

export interface ClaudeSummaryRecord {
  type: "summary";
  summary: string;
  leafUuid: UUID;
}

export interface ClaudeFileHistorySnapshot {
  type: "file-history-snapshot";
  messageId: UUID;
  snapshot: {
    messageId: UUID;
    trackedFileBackups: Record<string, unknown>;
    timestamp: ISO8601Timestamp;
  };
  isSnapshotUpdate: boolean;
}

export interface ClaudeSystemRecord extends ClaudeRecordBase {
  type: "system";
  subtype: "informational";
  content: string;
  isMeta: true;
  level: "info";
  entrypoint: "cli";
}

export interface ClaudeAuxiliaryRecord {
  type: Exclude<
    ClaudeMessageType,
    "user" | "assistant" | "summary" | "file-history-snapshot" | "system"
  >;
  sessionId?: UUID;
  timestamp?: ISO8601Timestamp;
  [key: string]: unknown;
}

export type ClaudeRecord =
  | ClaudeUserRecord
  | ClaudeAssistantRecord
  | ClaudeSummaryRecord
  | ClaudeFileHistorySnapshot
  | ClaudeSystemRecord
  | ClaudeAuxiliaryRecord;

export interface ClaudeSession {
  sessionId: UUID;
  projectPath: string;
  filePath: string;
  records: ClaudeRecord[];
  messages: (ClaudeUserRecord | ClaudeAssistantRecord)[];
  summary?: ClaudeSummaryRecord;
  fileSnapshots: ClaudeFileHistorySnapshot[];
  recordCounts?: Record<string, number>;
  metadata: {
    version: string;
    cwd: string;
    gitBranch: string;
    totalTokens: {
      input: number;
      output: number;
    };
  };
}

// --------------------------------------------------------------------------
// Codex Format Types
// --------------------------------------------------------------------------

export type CodexRecordType =
  | "session_meta"
  | "response_item"
  | "event_msg"
  | "turn_context"
  | "world_state"
  | "compacted"
  | "inter_agent_communication_metadata"
  | "function_call"
  | "function_call_output"
  | "reasoning"
  | "message";

export interface CodexRecordBase {
  ordinal?: number;
  timestamp?: ISO8601Timestamp;
  type: CodexRecordType;
}

export interface CodexSessionMetaPayload {
  id: ULID;
  timestamp: ISO8601Timestamp;
  cwd: string;
  originator: string;
  cli_version: string;
  instructions: string | null;
  source: string | Record<string, unknown>;
  model_provider: string;
  base_instructions?: string | { text: string } | null;
  git?: {
    commit_hash: string;
    branch: string;
    repository_url?: string;
  };
  [key: string]: unknown;
}

export interface CodexSessionMetaRecord extends CodexRecordBase {
  type: "session_meta";
  payload: CodexSessionMetaPayload;
}

export interface CodexTextContent {
  type: "input_text" | "output_text" | "text";
  text: string;
}

export interface CodexImageContent {
  type: "input_image";
  image_url: string;
  detail?: string;
}

export type CodexMessageContent = CodexTextContent | CodexImageContent;

export interface CodexMessagePayload {
  type: "message";
  role: "user" | "assistant" | "developer";
  content: CodexMessageContent[];
  [key: string]: unknown;
}

export interface CodexReasoningPayload {
  type: "reasoning";
  content?: unknown;
  encrypted_content?: string;
  summary: Array<{ type: "summary_text"; text: string }>;
  [key: string]: unknown;
}

export interface CodexFunctionCallPayload {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
  namespace?: string;
  [key: string]: unknown;
}

export interface CodexFunctionCallOutputPayload {
  type: "function_call_output";
  call_id: string;
  output: unknown;
  [key: string]: unknown;
}

export interface CodexCustomToolCallPayload {
  type: "custom_tool_call";
  name: string;
  input: string;
  call_id: string;
  status?: string;
  [key: string]: unknown;
}

export interface CodexCustomToolCallOutputPayload {
  type: "custom_tool_call_output";
  call_id: string;
  output: unknown;
  name?: string;
  [key: string]: unknown;
}

export interface CodexWebSearchCallPayload {
  type: "web_search_call";
  status?: string;
  action: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CodexToolSearchCallPayload {
  type: "tool_search_call";
  call_id: string;
  arguments: Record<string, unknown>;
  status?: string;
  execution?: string;
  [key: string]: unknown;
}

export interface CodexToolSearchOutputPayload {
  type: "tool_search_output";
  call_id: string;
  tools: unknown[];
  status?: string;
  execution?: string;
  [key: string]: unknown;
}

export interface CodexAgentMessagePayload {
  type: "agent_message";
  author: string;
  recipient: string;
  content: CodexMessageContent[];
  [key: string]: unknown;
}

export interface CodexGhostSnapshotPayload {
  type: "ghost_snapshot";
  ghost_commit: Record<string, unknown>;
  [key: string]: unknown;
}

export type CodexResponseItemPayload =
  | CodexMessagePayload
  | CodexReasoningPayload
  | CodexFunctionCallPayload
  | CodexFunctionCallOutputPayload
  | CodexCustomToolCallPayload
  | CodexCustomToolCallOutputPayload
  | CodexWebSearchCallPayload
  | CodexToolSearchCallPayload
  | CodexToolSearchOutputPayload
  | CodexAgentMessagePayload
  | CodexGhostSnapshotPayload;

export interface CodexResponseItemRecord extends CodexRecordBase {
  type: "response_item";
  payload: CodexResponseItemPayload;
}

export interface CodexUserMessageEvent {
  type: "user_message";
  message: string;
  images: string[];
}

export interface CodexAgentReasoningEvent {
  type: "agent_reasoning";
  text: string;
}

export interface CodexAgentMessageEvent {
  type: "agent_message";
  message: string;
}

export interface CodexTokenCountEvent {
  type: "token_count";
  info: unknown | null;
  rate_limits: {
    primary: { used_percent: number; window_minutes: number; resets_at: number };
    secondary: { used_percent: number; window_minutes: number; resets_at: number };
    credits: { has_credits: boolean; unlimited: boolean; balance: number | null };
    plan_type: string | null;
  };
}

export type CodexEventMsgPayload =
  | CodexUserMessageEvent
  | CodexAgentReasoningEvent
  | CodexAgentMessageEvent
  | CodexTokenCountEvent
  | ({
      type:
        | "item_completed"
        | "exec_command_end"
        | "patch_apply_end"
        | "task_started"
        | "task_complete"
        | "thread_settings_applied"
        | "context_compacted"
        | "sub_agent_activity"
        | "web_search_end"
        | "turn_aborted"
        | "mcp_tool_call_end"
        | "view_image_tool_call"
        | "image_generation_end"
        | "dynamic_tool_call_request"
        | "dynamic_tool_call_response"
        | "error"
        | "collab_waiting_end"
        | "collab_agent_spawn_end"
        | "collab_close_end"
        | "collab_agent_interaction_end"
        | "thread_goal_updated"
        | "thread_name_updated"
        | "thread_rolled_back"
        | "turn_completed"
        | "task_completed";
      [key: string]: unknown;
    });

export interface CodexEventMsgRecord extends CodexRecordBase {
  type: "event_msg";
  payload: CodexEventMsgPayload;
}

export interface CodexTurnContextPayload {
  turn_id?: string;
  cwd: string;
  current_date?: string;
  timezone?: string;
  approval_policy?: string;
  sandbox_policy?: { type: string } | string;
  model?: string;
  personality?: string;
  collaboration_mode?: Record<string, unknown>;
  realtime_active?: boolean;
  effort?: string;
  summary?: string;
  user_instructions?: string;
  developer_instructions?: string;
  truncation_policy?: { mode: string; limit: number };
  [key: string]: unknown;
}

export interface CodexTurnContextRecord extends CodexRecordBase {
  type: "turn_context";
  payload: CodexTurnContextPayload;
}

export interface CodexWorldStateRecord extends CodexRecordBase {
  type: "world_state";
  payload: { full: boolean; state: Record<string, unknown> };
}

export interface CodexCompactedRecord extends CodexRecordBase {
  type: "compacted";
  payload: {
    message: string;
    replacement_history: unknown[];
    [key: string]: unknown;
  };
}

export interface CodexInterAgentMetadataRecord extends CodexRecordBase {
  type: "inter_agent_communication_metadata";
  payload: { trigger_turn: boolean; [key: string]: unknown };
}

export interface CodexLegacyResponseRecord extends CodexRecordBase {
  type: "function_call" | "function_call_output" | "reasoning" | "message";
  [key: string]: unknown;
}

export type CodexRecord =
  | CodexSessionMetaRecord
  | CodexResponseItemRecord
  | CodexEventMsgRecord
  | CodexTurnContextRecord
  | CodexWorldStateRecord
  | CodexCompactedRecord
  | CodexInterAgentMetadataRecord
  | CodexLegacyResponseRecord;

export interface CodexConversationToolCall {
  kind: "function" | "custom" | "web_search" | "tool_search";
  name: string;
  arguments: Record<string, unknown>;
  callId: string;
  output: string;
  rawOutput?: unknown;
  namespace?: string;
  status?: string;
}

export interface CodexConversationTurn {
  turnNumber: number;
  context: CodexTurnContextPayload;
  timestamp?: ISO8601Timestamp;
  userMessage: string;
  userImages: string[];
  reasoning?: string;
  reasoningSummary?: string;
  toolCalls: CodexConversationToolCall[];
  agentMessages: Array<{ author: string; recipient: string; text: string }>;
  assistantMessage: string;
  tokenUsage?: CodexTokenCountEvent["rate_limits"];
}

export interface CodexSession {
  id: ULID;
  filePath: string;
  metadata: CodexSessionMetaPayload;
  records: CodexRecord[];
  turns: CodexConversationTurn[];
  recordCounts?: Record<string, number>;
  responseItemCounts?: Record<string, number>;
  eventCounts?: Record<string, number>;
  compactions?: CodexCompactedRecord["payload"][];
  developerMessages?: Array<{ text: string; timestamp?: ISO8601Timestamp }>;
  totalRecords: {
    session_meta: number;
    response_item: number;
    event_msg: number;
    turn_context: number;
  };
}

// --------------------------------------------------------------------------
// Conversion Options & Results
// --------------------------------------------------------------------------

export interface ClaudeToCodexOptions {
  preserveMetadata?: boolean;
  model?: string;
  modelProvider?: string;
  cliVersion?: string;
  outputDir?: string;
  targetCwd?: string;
}

export interface CodexToClaudeOptions {
  generateUuids?: boolean;
  reconstructThreading?: boolean;
  projectPath?: string;
  version?: string;
  outputDir?: string;
  targetCwd?: string;
}

export interface ConversionResult<T> {
  success: boolean;
  outputPath: string;
  session: T;
  warnings: string[];
  errors: string[];
  statistics: {
    recordsConverted: number;
    messagesConverted: number;
    toolCallsConverted: number;
    metadataPreserved: boolean;
  };
}

export interface SessionListEntry {
  path: string;
  format: "claude" | "codex";
  sessionId: string;
  timestamp: ISO8601Timestamp;
  project?: string;
  messageCount?: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateUlid(): string {
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = crypto.randomUUID().replace(/-/g, "").substring(0, 20);
  return `${timestamp}${random}`;
}

function generateCodexFilename(timestamp: Date, sessionId: string): string {
  const ts = timestamp
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "");
  return `rollout-${ts}-${sessionId}.jsonl`;
}

function mapClaudeToolToCodex(claudeTool: string): string {
  const mapping: Record<string, string> = {
    Bash: "shell_command",
    Read: "read_file",
    Write: "write_file",
    Edit: "edit_file",
    Glob: "list_files",
    Grep: "search_files",
    Task: "agent_task",
    WebFetch: "web_fetch",
    WebSearch: "web_search",
  };
  return mapping[claudeTool] || claudeTool.toLowerCase();
}

function mapCodexToolToClaude(codexTool: string): string {
  const mapping: Record<string, string> = {
    shell_command: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    list_files: "Glob",
    search_files: "Grep",
    agent_task: "Task",
    web_fetch: "WebFetch",
    web_search: "WebSearch",
  };
  return mapping[codexTool] || codexTool;
}

function mapCodexModelToClaude(codexModel: string): string {
  if (
    codexModel.includes("gpt") ||
    codexModel.includes("codex") ||
    codexModel.includes("gemini")
  ) {
    return process.env.AGENT_CLAUDE_MODEL || "claude-opus-5";
  }
  return codexModel;
}

function recordCounts(records: Array<{ type?: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const type = record.type || "unknown";
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function normalizeClaudeTimestamps(records: ClaudeRecord[]): ClaudeRecord[] {
  let lastTimestampMs = 0;

  return records.map((record) => {
    if (!("timestamp" in record) || typeof record.timestamp !== "string") {
      return record;
    }

    const parsed = new Date(record.timestamp).getTime();
    const timestamp = Math.max(
      Number.isNaN(parsed) ? Date.now() : parsed,
      lastTimestampMs + 1
    );
    lastTimestampMs = timestamp;

    if (timestamp === parsed) return record;
    return { ...record, timestamp: new Date(timestamp).toISOString() } as ClaudeRecord;
  });
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return { value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: value };
  }
}

function stringifyPortableContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return String(item ?? "");
        const block = item as Record<string, unknown>;
        if (typeof block.text === "string") return block.text;
        if (typeof block.image_url === "string") {
          const url = block.image_url;
          const label = url.startsWith("data:")
            ? url.slice(0, url.indexOf(",") + 1) + "<base64>"
            : url;
          return `[Image: ${label}]`;
        }
        return JSON.stringify(block);
      })
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(value);
}

function claudeText(content: string | ClaudeContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "fallback") {
        return `Model fallback: ${block.from} -> ${block.to}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function codexText(content: CodexMessageContent[] | unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is CodexTextContent =>
        !!block && typeof block === "object" && typeof block.text === "string"
    )
    .map((block) => block.text)
    .join("\n");
}

function codexImages(content: CodexMessageContent[] | unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block): block is CodexImageContent =>
        !!block &&
        typeof block === "object" &&
        block.type === "input_image" &&
        typeof block.image_url === "string"
    )
    .map((block) => block.image_url);
}

function codexImageToClaude(imageUrl: string): ClaudeImageBlock {
  const match = imageUrl.match(/^data:([^;,]+);base64,(.*)$/s);
  if (match) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: match[1],
        data: match[2],
      },
    };
  }
  return { type: "image", source: { type: "url", url: imageUrl } };
}

function codexToolOutputToClaude(value: unknown): unknown {
  if (!Array.isArray(value)) return stringifyPortableContent(value);
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      return { type: "text", text: String(item ?? "") };
    }
    const block = item as Record<string, unknown>;
    if (typeof block.text === "string") {
      return { type: "text", text: block.text };
    }
    if (block.type === "input_image" && typeof block.image_url === "string") {
      return codexImageToClaude(block.image_url);
    }
    return { type: "text", text: JSON.stringify(block) };
  });
}

function claudeMediaToCodex(
  content: string | ClaudeContentBlock[]
): CodexImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (block.type !== "image") return [];
    if (block.source.type === "base64" && block.source.data) {
      return [
        {
          type: "input_image" as const,
          image_url: `data:${block.source.media_type || "image/png"};base64,${block.source.data}`,
          detail: "auto",
        },
      ];
    }
    if (block.source.url) {
      return [
        {
          type: "input_image" as const,
          image_url: block.source.url,
          detail: "auto",
        },
      ];
    }
    return [];
  });
}

function claudeToolOutput(content: unknown): unknown {
  if (!Array.isArray(content)) return stringifyPortableContent(content);
  return content.map((item) => {
    if (!item || typeof item !== "object") {
      return { type: "input_text", text: String(item ?? "") };
    }
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      return { type: "input_text", text: block.text };
    }
    if (block.type === "image" && block.source && typeof block.source === "object") {
      const source = block.source as Record<string, unknown>;
      if (source.type === "base64" && typeof source.data === "string") {
        return {
          type: "input_image",
          image_url: `data:${typeof source.media_type === "string" ? source.media_type : "image/png"};base64,${source.data}`,
          detail: "auto",
        };
      }
    }
    return { type: "input_text", text: JSON.stringify(block) };
  });
}

export function applyClaudeTargetCwd(
  session: ClaudeSession,
  targetCwd: string
): ClaudeSession {
  const projectPath = targetCwd;

  const remappedRecords = session.records.map((record) => {
    if ("cwd" in record) {
      return {
        ...record,
        cwd: targetCwd,
      } as ClaudeRecord;
    }

    return record;
  });

  const remappedMessages = remappedRecords.filter(
    (record): record is ClaudeUserRecord | ClaudeAssistantRecord =>
      record.type === "user" || record.type === "assistant"
  );

  return {
    ...session,
    projectPath,
    records: remappedRecords,
    messages: remappedMessages,
    metadata: {
      ...session.metadata,
      cwd: targetCwd,
    },
  };
}

export async function writeClaudeSession(
  session: ClaudeSession,
  options: Pick<CodexToClaudeOptions, "outputDir" | "targetCwd">
): Promise<string> {
  const finalSession = options.targetCwd
    ? applyClaudeTargetCwd(session, options.targetCwd)
    : session;
  finalSession.records = normalizeClaudeTimestamps(finalSession.records);
  finalSession.messages = finalSession.records.filter(
    (record): record is ClaudeUserRecord | ClaudeAssistantRecord =>
      record.type === "user" || record.type === "assistant"
  );
  finalSession.recordCounts = recordCounts(finalSession.records);

  const homeDir = process.env.HOME || Bun.env.HOME || "/tmp";
  const finalOutputDir = options.outputDir || join(homeDir, ".claude", "projects");
  const projectPath = finalSession.projectPath || finalSession.metadata.cwd || "/tmp/converted-sessions";
  const encodedProjectPath = slugifyClaudeProjectPath(projectPath);
  const projectDir = join(finalOutputDir, encodedProjectPath);

  await mkdir(projectDir, { recursive: true });

  const outputPath = join(projectDir, `${finalSession.sessionId}.jsonl`);
  const content =
    finalSession.records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await Bun.write(outputPath, content);

  finalSession.filePath = outputPath;
  session.filePath = outputPath;
  session.projectPath = finalSession.projectPath;
  session.records = finalSession.records;
  session.messages = finalSession.messages;
  session.metadata = finalSession.metadata;

  return outputPath;
}

export function buildClaudeSessionFromCodex(
  codexSession: CodexSession,
  options: Omit<CodexToClaudeOptions, "outputDir"> = {}
): ClaudeSession {
  const {
    generateUuids = true,
    reconstructThreading = true,
    projectPath,
    version = process.env.AGENT_CLAUDE_VERSION || "2.1.170",
    targetCwd,
  } = options;

  const finalCwd =
    targetCwd || projectPath || codexSession.metadata.cwd || "/tmp/converted-sessions";
  const sessionId = generateUuids ? crypto.randomUUID() : codexSession.id;
  let parentUuid: string | null = null;

  const records: ClaudeRecord[] = [];
  const messages: (ClaudeUserRecord | ClaudeAssistantRecord)[] = [];
  let lastTimestampMs = 0;
  const nextTimestamp = (candidate?: string) => {
    const parsed = candidate ? new Date(candidate).getTime() : Date.now();
    const timestamp = Math.max(
      Number.isNaN(parsed) ? Date.now() : parsed,
      lastTimestampMs + 1
    );
    lastTimestampMs = timestamp;
    return new Date(timestamp).toISOString();
  };

  const addSystemRecord = (text: string, timestamp?: string) => {
    const uuid = crypto.randomUUID();
    const record: ClaudeSystemRecord = {
      type: "system",
      subtype: "informational",
      content: text,
      isMeta: true,
      level: "info",
      entrypoint: "cli",
      sessionId,
      timestamp: nextTimestamp(timestamp),
      uuid,
      parentUuid: reconstructThreading ? parentUuid : null,
      isSidechain: false,
      userType: "external",
      cwd: finalCwd,
      version,
      gitBranch: codexSession.metadata.git?.branch || "",
    };
    records.push(record);
    if (reconstructThreading) parentUuid = uuid;
  };

  for (const developerMessage of codexSession.developerMessages || []) {
    addSystemRecord(
      `[Imported Codex developer message]\n${developerMessage.text}`,
      developerMessage.timestamp
    );
  }
  for (const compaction of codexSession.compactions || []) {
    addSystemRecord(`[Imported Codex compaction]\n${compaction.message}`);
  }

  for (const turn of codexSession.turns) {
    const userUuid = generateUuids ? crypto.randomUUID() : `user-${turn.turnNumber}`;
    const assistantUuid = generateUuids
      ? crypto.randomUUID()
      : `assistant-${turn.turnNumber}`;

    const userContent: ClaudeContentBlock[] = [];
    if (turn.userMessage) {
      userContent.push({ type: "text", text: turn.userMessage });
    }
    userContent.push(...turn.userImages.map(codexImageToClaude));
    const userTimestamp = nextTimestamp(turn.timestamp);

    const userRecord: ClaudeUserRecord = {
      type: "user",
      sessionId,
      timestamp: userTimestamp,
      uuid: userUuid,
      parentUuid: reconstructThreading ? parentUuid : null,
      isSidechain: false,
      userType: "external",
      cwd: finalCwd,
      version,
      gitBranch: codexSession.metadata.git?.branch || "",
      message: {
        role: "user",
        content: userContent,
      },
    };

    records.push(userRecord);
    messages.push(userRecord);

    const assistantContent: ClaudeContentBlock[] = [];

    if (turn.reasoning || turn.reasoningSummary) {
      assistantContent.push({
        type: "text",
        text: `[Imported reasoning]\n${turn.reasoning || turn.reasoningSummary || ""}`,
      });
    }

    for (const toolCall of turn.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: `toolu_${toolCall.callId.replace("call_", "")}`,
        name: mapCodexToolToClaude(toolCall.name),
        input: toolCall.arguments,
      });
    }

    for (const agentMessage of turn.agentMessages) {
      assistantContent.push({
        type: "text",
        text: `[Agent ${agentMessage.author} -> ${agentMessage.recipient}]\n${agentMessage.text}`,
      });
    }

    if (turn.assistantMessage) {
      assistantContent.push({
        type: "text",
        text: turn.assistantMessage,
      });
    }

    if (assistantContent.length === 0) {
      parentUuid = userUuid;
      continue;
    }

    const assistantTimestamp = nextTimestamp(turn.timestamp);

    const assistantRecord: ClaudeAssistantRecord = {
      type: "assistant",
      sessionId,
      timestamp: assistantTimestamp,
      uuid: assistantUuid,
      parentUuid: reconstructThreading ? userUuid : null,
      isSidechain: false,
      userType: "external",
      cwd: finalCwd,
      version,
      gitBranch: codexSession.metadata.git?.branch || "",
      message: {
        role: "assistant",
        model: mapCodexModelToClaude(turn.context?.model || "gpt-5.2-codex"),
        id: `msg_${assistantUuid.substring(0, 10)}`,
        type: "message",
        content: assistantContent,
        stop_reason: turn.toolCalls.length > 0 ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    };

    records.push(assistantRecord);
    messages.push(assistantRecord);

    if (turn.toolCalls.length > 0) {
      const toolResultUuid = generateUuids
        ? crypto.randomUUID()
        : `tool-result-${turn.turnNumber}`;

      const toolResultRecord: ClaudeUserRecord = {
        type: "user",
        sessionId,
        timestamp: nextTimestamp(turn.timestamp),
        uuid: toolResultUuid,
        parentUuid: reconstructThreading ? assistantUuid : null,
        isSidechain: false,
        userType: "internal",
        cwd: finalCwd,
        version,
        gitBranch: codexSession.metadata.git?.branch || "",
        message: {
          role: "user",
          content: turn.toolCalls.map((call) => ({
            type: "tool_result" as const,
            tool_use_id: `toolu_${call.callId.replace("call_", "")}`,
            content: codexToolOutputToClaude(call.rawOutput ?? call.output),
          })),
        },
      };

      records.push(toolResultRecord);
      messages.push(toolResultRecord);
      parentUuid = toolResultUuid;
    } else {
      parentUuid = assistantUuid;
    }
  }

  return {
    sessionId,
    projectPath: finalCwd,
    filePath: "",
    records,
    messages,
    summary: undefined,
    fileSnapshots: [],
    recordCounts: recordCounts(records),
    metadata: {
      version,
      cwd: finalCwd,
      gitBranch: codexSession.metadata.git?.branch || "",
      totalTokens: {
        input: 0,
        output: 0,
      },
    },
  };
}

// ============================================================================
// CLAUDE CODE PARSER
// ============================================================================

/**
 * Parse a Claude Code JSONL file
 */
export async function parseClaudeFile(filePath: string): Promise<ClaudeRecord[]> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");
  const records: ClaudeRecord[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as ClaudeRecord);
    } catch {
      // Skip malformed lines
    }
  }

  return records;
}

/**
 * Parse a Claude Code session from a JSONL file
 */
export async function parseClaudeSession(filePath: string): Promise<ClaudeSession> {
  const records = await parseClaudeFile(filePath);

  const messages = records.filter(
    (r): r is ClaudeUserRecord | ClaudeAssistantRecord =>
      r.type === "user" || r.type === "assistant"
  );

  const summary = records.find(
    (r): r is ClaudeSummaryRecord => r.type === "summary"
  );

  const fileSnapshots = records.filter(
    (r): r is ClaudeFileHistorySnapshot => r.type === "file-history-snapshot"
  );

  const firstMessage = messages[0];
  const sessionId = firstMessage?.sessionId || basename(filePath, ".jsonl");

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const msg of messages) {
    if (msg.type === "assistant" && msg.message?.usage) {
      totalInputTokens += msg.message.usage.input_tokens || 0;
      totalOutputTokens += msg.message.usage.output_tokens || 0;
    }
  }

  const projectDir = basename(dirname(filePath));
  const fallbackProjectPath = projectDir.replace(/^-/, "/").replace(/-/g, "/");
  const projectPath = firstMessage?.cwd || fallbackProjectPath;

  return {
    sessionId,
    projectPath,
    filePath,
    records,
    messages,
    summary,
    fileSnapshots,
    recordCounts: recordCounts(records),
    metadata: {
      version: firstMessage?.version || "unknown",
      cwd: firstMessage?.cwd || "",
      gitBranch: firstMessage?.gitBranch || "",
      totalTokens: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
    },
  };
}

async function readClaudeSessionCwd(filePath: string): Promise<string | undefined> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { cwd?: unknown };
        if (typeof record.cwd === "string" && record.cwd) return record.cwd;
      } catch {
        // Skip malformed records.
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }

  return undefined;
}

/**
 * List all Claude Code sessions
 */
export async function listClaudeSessions(
  projectPath?: string
): Promise<SessionListEntry[]> {
  const entries: SessionListEntry[] = [];
  const homeDir = process.env.HOME || Bun.env.HOME;
  if (!homeDir) return entries;

  const projectsDir = join(homeDir, ".claude", "projects");

  try {
    const projectDirs = await readdir(projectsDir);

    for (const dir of projectDirs) {
      const projectDir = join(projectsDir, dir);
      const fallbackProjectPath = "/" + dir.replace(/^-/, "").replace(/-/g, "/");

      try {
        const files = await readdir(projectDir);
        const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

        for (const file of jsonlFiles) {
          const filePath = join(projectDir, file);
          const storedProjectPath =
            (await readClaudeSessionCwd(filePath)) || fallbackProjectPath;

          if (projectPath && !storedProjectPath.includes(projectPath)) {
            continue;
          }

          const sessionId = basename(file, ".jsonl");
          const stat = await Bun.file(filePath).stat();

          entries.push({
            path: filePath,
            format: "claude",
            sessionId,
            timestamp: stat?.mtime?.toISOString() || new Date().toISOString(),
            project: storedProjectPath,
          });
        }
      } catch {
        // Skip unreadable directories
      }
    }
  } catch {
    // Directory doesn't exist
  }

  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return entries;
}

// ============================================================================
// CODEX PARSER
// ============================================================================

/**
 * Parse a Codex JSONL file
 */
export async function parseCodexFile(filePath: string): Promise<CodexRecord[]> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n");
  const records: CodexRecord[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as CodexRecord);
    } catch {
      // Skip malformed lines
    }
  }

  return records;
}

/**
 * Extract conversation turns from Codex records
 */
function extractCodexTurns(
  records: CodexRecord[],
  metadata: CodexSessionMetaPayload
): CodexConversationTurn[] {
  const turns: CodexConversationTurn[] = [];
  let currentTurn: Partial<CodexConversationTurn> | null = null;
  let turnNumber = 0;

  let lastContext: CodexTurnContextPayload = {
    cwd: metadata.cwd,
    model: "",
  };
  const responseItemIds = new Set(
    records.flatMap((record) => {
      if (record.type !== "response_item") return [];
      const id = (record.payload as Record<string, unknown>).id;
      return typeof id === "string" ? [id] : [];
    })
  );
  let generatedCallId = 0;
  const pendingToolCalls = new Map<string, CodexConversationToolCall>();

  const startTurn = (timestamp?: string) => {
    turnNumber++;
    currentTurn = {
      turnNumber,
      context: lastContext,
      timestamp,
      userMessage: "",
      userImages: [],
      toolCalls: [],
      agentMessages: [],
      assistantMessage: "",
    };
    return currentTurn;
  };

  const ensureTurn = (timestamp?: string) => currentTurn || startTurn(timestamp);

  const finishTurn = () => {
    if (
      currentTurn &&
      (currentTurn.userMessage ||
        currentTurn.assistantMessage ||
        currentTurn.reasoning ||
        currentTurn.reasoningSummary ||
        currentTurn.toolCalls?.length ||
        currentTurn.agentMessages?.length)
    ) {
      turns.push(currentTurn as CodexConversationTurn);
    } else if (currentTurn) {
      turnNumber--;
    }
    currentTurn = null;
  };

  const appendText = (
    field: "assistantMessage" | "reasoning" | "reasoningSummary",
    text: string,
    timestamp?: string
  ) => {
    if (!text) return;
    const turn = ensureTurn(timestamp);
    const existing = turn[field] || "";
    if (existing === text || existing.split("\n").includes(text)) return;
    turn[field] = existing ? `${existing}\n${text}` : text;
  };

  const setUserMessage = (text: string, images: string[], timestamp?: string) => {
    let turn = ensureTurn(timestamp);
    if (
      text &&
      turn.userMessage &&
      turn.userMessage !== text &&
      (turn.assistantMessage || turn.reasoning || turn.toolCalls?.length)
    ) {
      finishTurn();
      turn = ensureTurn(timestamp);
    }
    if (text && !turn.userMessage) turn.userMessage = text;
    const existingImages = new Set(turn.userImages || []);
    for (const image of images) existingImages.add(image);
    turn.userImages = [...existingImages];
  };

  const addToolCall = (
    kind: CodexConversationToolCall["kind"],
    payload: Record<string, unknown>,
    timestamp?: string
  ) => {
    const callId =
      (typeof payload.call_id === "string" && payload.call_id) ||
      (typeof payload.id === "string" && payload.id) ||
      `generated_call_${++generatedCallId}`;
    const name =
        typeof payload.name === "string"
          ? payload.name
          : kind === "web_search"
            ? "web_search"
            : kind === "tool_search"
              ? "tool_search"
              : "unknown_tool";
    const argumentsValue = parseToolArguments(
      payload.arguments ?? payload.input ?? payload.action ?? {}
    );
    const existing = pendingToolCalls.get(callId);
    if (existing) {
      existing.kind = kind;
      existing.name = name;
      existing.arguments = argumentsValue;
      if (typeof payload.namespace === "string") existing.namespace = payload.namespace;
      if (typeof payload.status === "string") existing.status = payload.status;
      return existing;
    }
    const call: CodexConversationToolCall = {
      kind,
      name,
      arguments: argumentsValue,
      callId,
      output:
        kind === "web_search" && payload.status
          ? stringifyPortableContent({ status: payload.status })
          : "",
      ...(typeof payload.namespace === "string"
        ? { namespace: payload.namespace }
        : {}),
      ...(typeof payload.status === "string" ? { status: payload.status } : {}),
    };
    ensureTurn(timestamp).toolCalls!.push(call);
    pendingToolCalls.set(callId, call);
    return call;
  };

  const applyToolOutput = (
    callId: unknown,
    output: unknown,
    fallbackName?: string,
    timestamp?: string
  ) => {
    if (typeof callId !== "string") return;
    let call = pendingToolCalls.get(callId);
    if (!call) {
      call = {
        kind: "custom",
        name: fallbackName || "tool_result",
        arguments: {},
        callId,
        output: "",
      };
      ensureTurn(timestamp).toolCalls!.push(call);
      pendingToolCalls.set(callId, call);
    }
    call.rawOutput = output;
    call.output = stringifyPortableContent(output);
  };

  const unresolvedCurrentTool = (names: string[]) =>
    [...(currentTurn?.toolCalls || [])]
      .reverse()
      .find(
        (call) =>
          names.includes(call.name) && typeof call.rawOutput === "undefined"
      );

  for (const record of records) {
    if (record.type === "turn_context") {
      finishTurn();
      lastContext = (record as CodexTurnContextRecord).payload;
      startTurn(record.timestamp);
      continue;
    }

    if (record.type === "event_msg") {
      const eventRecord = record as CodexEventMsgRecord;
      const payload = eventRecord.payload as Record<string, unknown>;

      if (payload.type === "user_message") {
        const images = [payload.images, payload.local_images]
          .flatMap((value) => (Array.isArray(value) ? value : []))
          .filter((value): value is string => typeof value === "string");
        setUserMessage(
          typeof payload.message === "string" ? payload.message : "",
          images,
          record.timestamp
        );
      }

      if (payload.type === "agent_reasoning" && typeof payload.text === "string") {
        appendText("reasoning", payload.text, record.timestamp);
      }

      if (payload.type === "agent_message" && typeof payload.message === "string") {
        appendText("assistantMessage", payload.message, record.timestamp);
      }

      if (payload.type === "token_count") {
        const turn = ensureTurn(record.timestamp);
        if (payload.rate_limits && typeof payload.rate_limits === "object") {
          turn.tokenUsage = payload.rate_limits as CodexTokenCountEvent["rate_limits"];
        }
      }

      if (payload.type === "web_search_end") {
        applyToolOutput(
          payload.call_id,
          payload.results ?? payload.action ?? payload.query,
          "web_search",
          record.timestamp
        );
      }

      if (payload.type === "dynamic_tool_call_request") {
        addToolCall(
          "custom",
          {
            call_id: payload.callId,
            name: payload.tool,
            arguments: payload.arguments,
            namespace: payload.namespace,
          },
          record.timestamp
        );
      }

      if (payload.type === "dynamic_tool_call_response") {
        applyToolOutput(
          payload.call_id,
          payload.content_items ?? payload.error,
          typeof payload.tool === "string" ? payload.tool : undefined,
          record.timestamp
        );
      }

      if (payload.type === "exec_command_end") {
        applyToolOutput(
          payload.call_id,
          payload.formatted_output ?? payload.aggregated_output ?? {
            stdout: payload.stdout,
            stderr: payload.stderr,
            exit_code: payload.exit_code,
          },
          "exec_command",
          record.timestamp
        );
      }

      if (payload.type === "patch_apply_end") {
        applyToolOutput(
          payload.call_id,
          {
            stdout: payload.stdout,
            stderr: payload.stderr,
            success: payload.success,
            changes: payload.changes,
          },
          "apply_patch",
          record.timestamp
        );
      }

      if (payload.type === "mcp_tool_call_end") {
        applyToolOutput(
          payload.call_id,
          payload.result,
          "mcp_tool_call",
          record.timestamp
        );
      }

      if (payload.type === "image_generation_end") {
        applyToolOutput(
          payload.call_id,
          payload.result ?? payload.saved_path,
          "image_generation",
          record.timestamp
        );
      }

      if (payload.type === "item_completed" && payload.item && typeof payload.item === "object") {
        const item = payload.item as Record<string, unknown>;
        const itemId = typeof item.id === "string" ? item.id : "";
        if (itemId && !responseItemIds.has(itemId)) {
          if (item.type === "UserMessage") {
            setUserMessage(
              stringifyPortableContent(item.content),
              [],
              record.timestamp
            );
          } else if (item.type === "AgentMessage") {
            appendText(
              "assistantMessage",
              stringifyPortableContent(item.content),
              record.timestamp
            );
          } else if (item.type === "Reasoning") {
            appendText(
              "reasoningSummary",
              stringifyPortableContent(item.summary_text ?? item.raw_content),
              record.timestamp
            );
          } else if (item.type === "CommandExecution") {
            const existing = unresolvedCurrentTool([
              "exec",
              "exec_command",
              "shell_command",
            ]);
            const callId = existing?.callId || itemId;
            if (existing && typeof item.status === "string") {
              existing.status = item.status;
            } else if (!existing) {
              addToolCall(
                "custom",
                {
                  call_id: callId,
                  name: "exec_command",
                  arguments: { command: item.command, cwd: item.cwd },
                  status: item.status,
                },
                record.timestamp
              );
            }
            applyToolOutput(
              callId,
              item.formatted_output ?? item.aggregated_output,
              "exec_command",
              record.timestamp
            );
          } else if (item.type === "FileChange") {
            const existing = unresolvedCurrentTool(["apply_patch"]);
            const callId = existing?.callId || itemId;
            if (existing && typeof item.status === "string") {
              existing.status = item.status;
            } else if (!existing) {
              addToolCall(
                "custom",
                {
                  call_id: callId,
                  name: "apply_patch",
                  arguments: { changes: item.changes },
                  status: item.status,
                },
                record.timestamp
              );
            }
            applyToolOutput(
              callId,
              { stdout: item.stdout, stderr: item.stderr },
              "apply_patch",
              record.timestamp
            );
          } else if (item.type === "ImageView") {
            const existing = unresolvedCurrentTool(["view_image"]);
            if (existing) {
              existing.status = "completed";
            } else {
              addToolCall(
                "custom",
                {
                  call_id: itemId,
                  name: "view_image",
                  arguments: { path: item.path },
                  status: "completed",
                },
                record.timestamp
              );
            }
          }
        }
      }
    }

    const isLegacyResponse = [
      "function_call",
      "function_call_output",
      "reasoning",
      "message",
    ].includes(record.type);

    if (record.type === "response_item" || isLegacyResponse) {
      const payload = (record.type === "response_item"
        ? (record as CodexResponseItemRecord).payload
        : record) as CodexResponseItemPayload;
      const payloadType =
        payload.type ||
        ("role" in payload && "content" in payload ? "message" : undefined);

      if (payloadType === "message") {
        const messagePayload = payload as CodexMessagePayload;
        const text = codexText(messagePayload.content);
        const images = codexImages(messagePayload.content);

        if (messagePayload.role === "user") {
          setUserMessage(text, images, record.timestamp);
        }

        if (messagePayload.role === "assistant") {
          appendText("assistantMessage", text, record.timestamp);
        }
      }

      if (payloadType === "reasoning") {
        const reasoningPayload = payload as CodexReasoningPayload;
        appendText(
          "reasoningSummary",
          Array.isArray(reasoningPayload.summary)
            ? reasoningPayload.summary.map((item) => item.text).join("\n")
            : "",
          record.timestamp
        );
      }

      if (payloadType === "function_call") {
        addToolCall(
          "function",
          payload as unknown as Record<string, unknown>,
          record.timestamp
        );
      }

      if (payloadType === "function_call_output") {
        const outputPayload = payload as CodexFunctionCallOutputPayload;
        applyToolOutput(
          outputPayload.call_id,
          outputPayload.output,
          undefined,
          record.timestamp
        );
      }

      if (payloadType === "custom_tool_call") {
        addToolCall(
          "custom",
          payload as unknown as Record<string, unknown>,
          record.timestamp
        );
      }

      if (payloadType === "custom_tool_call_output") {
        const outputPayload = payload as CodexCustomToolCallOutputPayload;
        applyToolOutput(
          outputPayload.call_id,
          outputPayload.output,
          outputPayload.name,
          record.timestamp
        );
      }

      if (payloadType === "web_search_call") {
        addToolCall(
          "web_search",
          payload as unknown as Record<string, unknown>,
          record.timestamp
        );
      }

      if (payloadType === "tool_search_call") {
        addToolCall(
          "tool_search",
          payload as unknown as Record<string, unknown>,
          record.timestamp
        );
      }

      if (payloadType === "tool_search_output") {
        const outputPayload = payload as CodexToolSearchOutputPayload;
        applyToolOutput(
          outputPayload.call_id,
          outputPayload.tools,
          "tool_search",
          record.timestamp
        );
      }

      if (payloadType === "agent_message") {
        const agentPayload = payload as CodexAgentMessagePayload;
        const text = codexText(agentPayload.content);
        if (text) {
          ensureTurn(record.timestamp).agentMessages!.push({
            author: agentPayload.author,
            recipient: agentPayload.recipient,
            text,
          });
        }
      }
    }
  }

  finishTurn();

  return turns;
}

/**
 * Parse a Codex session from a JSONL file
 */
export async function parseCodexSession(filePath: string): Promise<CodexSession> {
  const records = await parseCodexFile(filePath);

  const metaRecord = records.find(
    (r): r is CodexSessionMetaRecord => r.type === "session_meta"
  );

  if (!metaRecord) {
    throw new Error("No session_meta record found in Codex file");
  }

  const totalRecords = {
    session_meta: records.filter((r) => r.type === "session_meta").length,
    response_item: records.filter((r) => r.type === "response_item").length,
    event_msg: records.filter((r) => r.type === "event_msg").length,
    turn_context: records.filter((r) => r.type === "turn_context").length,
  };

  const counts = recordCounts(records);
  const responseItemCounts: Record<string, number> = {};
  const eventCounts: Record<string, number> = {};
  const developerMessages: Array<{ text: string; timestamp?: string }> = [];
  for (const record of records) {
    if (record.type === "response_item") {
      const payload = record.payload as CodexResponseItemPayload;
      const type = payload.type ||
        ("role" in payload && "content" in payload ? "message" : "unknown");
      responseItemCounts[type] = (responseItemCounts[type] || 0) + 1;
      if (type === "message") {
        const message = payload as CodexMessagePayload;
        if (message.role === "developer") {
          const text = codexText(message.content);
          if (text) developerMessages.push({ text, timestamp: record.timestamp });
        }
      }
    } else if (record.type === "event_msg") {
      const type = record.payload.type;
      eventCounts[type] = (eventCounts[type] || 0) + 1;
    } else if (["function_call", "function_call_output", "reasoning", "message"].includes(record.type)) {
      responseItemCounts[record.type] = (responseItemCounts[record.type] || 0) + 1;
      if (record.type === "message") {
        const message = record as unknown as CodexMessagePayload;
        if (message.role === "developer") {
          const text = codexText(message.content);
          if (text) developerMessages.push({ text, timestamp: record.timestamp });
        }
      }
    }
  }
  const turns = extractCodexTurns(records, metaRecord.payload);

  return {
    id: metaRecord.payload.id,
    filePath,
    metadata: metaRecord.payload,
    records,
    turns,
    recordCounts: counts,
    responseItemCounts,
    eventCounts,
    compactions: records
      .filter((record): record is CodexCompactedRecord => record.type === "compacted")
      .map((record) => record.payload),
    developerMessages,
    totalRecords,
  };
}

/**
 * List all Codex sessions
 */
export async function listCodexSessions(): Promise<SessionListEntry[]> {
  const entries: SessionListEntry[] = [];
  const homeDir = process.env.HOME || Bun.env.HOME;
  if (!homeDir) return entries;

  const sessionsDir = join(homeDir, ".codex", "sessions");

  async function scanDirectory(dir: string) {
    try {
      const items = await readdir(dir, { withFileTypes: true });

      for (const item of items) {
        const fullPath = join(dir, item.name);

        if (item.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (item.name.endsWith(".jsonl")) {
          const match = item.name.match(
            /rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.jsonl/
          );

          if (match) {
            const timestamp = match[1]!.replace(/-/g, (m, i) =>
              i > 9 ? ":" : m
            );
            const sessionId = match[2]!;

            entries.push({
              path: fullPath,
              format: "codex",
              sessionId,
              timestamp: new Date(timestamp).toISOString(),
            });
          } else {
            const stat = await Bun.file(fullPath).stat();
            entries.push({
              path: fullPath,
              format: "codex",
              sessionId: basename(item.name, ".jsonl"),
              timestamp: stat?.mtime?.toISOString() || new Date().toISOString(),
            });
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  try {
    await scanDirectory(sessionsDir);
  } catch {
    // Directory doesn't exist
  }

  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return entries;
}

// ============================================================================
// CONVERTERS
// ============================================================================

/**
 * Convert a Claude Code session to Codex format
 */
export async function convertClaudeToCodex(
  claudeSession: ClaudeSession,
  options: ClaudeToCodexOptions = {}
): Promise<ConversionResult<CodexSession>> {
  const {
    preserveMetadata = true,
    model = "gpt-5.2-codex",
    modelProvider = "openai",
    cliVersion = process.env.AGENT_CODEX_VERSION || "0.130.0",
    outputDir,
    targetCwd,
  } = options;

  const homeDir = process.env.HOME || Bun.env.HOME || "/tmp";
  const finalOutputDir = outputDir || join(homeDir, ".codex", "sessions");
  const effectiveCwd = targetCwd || claudeSession.metadata.cwd;
  const effectiveSession = targetCwd
    ? applyClaudeTargetCwd(claudeSession, targetCwd)
    : claudeSession;

  const warnings: string[] = [];
  const errors: string[] = [];
  const records: CodexRecord[] = [];

  const pushRecord = <T extends CodexRecord>(record: T): T => {
    record.ordinal = records.length;
    records.push(record);
    return record;
  };

  const sourceCounts =
    effectiveSession.recordCounts || recordCounts(effectiveSession.records);
  const untranslatedMetadata = Object.entries(sourceCounts)
    .filter(
      ([type]) =>
        ![
          "user",
          "assistant",
          "summary",
          "system",
          "file-history-snapshot",
        ].includes(type)
    )
    .map(([type, count]) => `${type}=${count}`)
    .sort();
  if (untranslatedMetadata.length > 0) {
    warnings.push(
      `Claude metadata retained in the source only: ${untranslatedMetadata.join(", ")}`
    );
  }

  const sessionId = generateUlid();
  const timestamp = new Date(
    effectiveSession.messages[0]?.timestamp || Date.now()
  );

  warnings.push(
    "Synthetic Claude-to-Codex conversion does not preserve the full client-authored Codex frame. Prefer cloning a real Codex session and seeding its task turn for resume-quality seeds."
  );

  // Create session_meta record
  const sessionMeta: CodexSessionMetaRecord = {
    timestamp: timestamp.toISOString(),
    type: "session_meta",
    payload: {
      id: sessionId,
      timestamp: timestamp.toISOString(),
      cwd: effectiveCwd,
      originator: "session-converter",
      cli_version: cliVersion,
      instructions: null,
      source: "converted",
      model_provider: modelProvider,
      ...(effectiveSession.metadata.gitBranch
        ? {
            git: {
              commit_hash: "",
              branch: effectiveSession.metadata.gitBranch,
            },
          }
        : {}),
    },
  };
  pushRecord(sessionMeta);

  let turnNumber = 0;
  const callIdFor = (toolUseId: string) => {
    const clean = toolUseId.replace(/^toolu_/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    return clean.startsWith("call_") ? clean : `call_${clean}`;
  };
  const asDate = (value?: string) => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  };
  const addTurnContext = (record: ClaudeUserRecord | ClaudeAssistantRecord) => {
    const date = asDate(record.timestamp);
    turnNumber++;
    pushRecord<CodexTurnContextRecord>({
      timestamp: date.toISOString(),
      type: "turn_context",
      payload: {
        cwd: record.cwd || effectiveCwd,
        turn_id: crypto.randomUUID(),
        current_date: getCurrentDateString(date),
        timezone: getCurrentTimezone(),
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
        model,
        personality: "pragmatic",
        collaboration_mode: {
          mode: "default",
          settings: {
            model,
            reasoning_effort: "high",
            developer_instructions: null,
          },
        },
        realtime_active: false,
        effort: "high",
        summary: "auto",
        user_instructions: "",
        truncation_policy: { mode: "tokens", limit: 10000 },
      },
    });
  };

  let hasActiveTurn = false;
  let toolCallsConverted = 0;

  for (const sourceRecord of effectiveSession.records) {
    if (sourceRecord.type === "summary") {
      pushRecord<CodexResponseItemRecord>({
        timestamp: timestamp.toISOString(),
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: `[Claude summary]\n${sourceRecord.summary}` }],
        },
      });
      continue;
    }

    if (sourceRecord.type === "system") {
      const content = sourceRecord.content;
      if (typeof content === "string" && content.trim()) {
        pushRecord<CodexResponseItemRecord>({
          timestamp:
            typeof sourceRecord.timestamp === "string"
              ? asDate(sourceRecord.timestamp).toISOString()
              : timestamp.toISOString(),
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: `[Claude system: ${String(sourceRecord.subtype || "informational")}]\n${content}`,
              },
            ],
          },
        });
      }
      continue;
    }

    if (sourceRecord.type === "user") {
      const sourceContent = sourceRecord.message?.content ?? [];
      const blocks = Array.isArray(sourceContent) ? sourceContent : [];
      const toolResults = blocks.filter(
        (block): block is ClaudeToolResultBlock => block.type === "tool_result"
      );

      for (const toolResult of toolResults) {
        pushRecord<CodexResponseItemRecord>({
          timestamp: asDate(sourceRecord.timestamp).toISOString(),
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: callIdFor(toolResult.tool_use_id),
            output: claudeToolOutput(toolResult.content),
          },
        });
      }

      const userText = claudeText(sourceContent);
      const images = claudeMediaToCodex(sourceContent);
      const hasExternalContent =
        sourceRecord.userType !== "internal" && (userText || images.length > 0);
      if (!hasExternalContent) continue;

      addTurnContext(sourceRecord);
      hasActiveTurn = true;
      const userTimestamp = asDate(sourceRecord.timestamp).toISOString();
      pushRecord<CodexEventMsgRecord>({
        timestamp: userTimestamp,
        type: "event_msg",
        payload: {
          type: "user_message",
          message: userText,
          images: images.map((image) => image.image_url),
        },
      });
      pushRecord<CodexResponseItemRecord>({
        timestamp: userTimestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            ...(userText ? [{ type: "input_text" as const, text: userText }] : []),
            ...images,
          ],
        },
      });
      continue;
    }

    if (sourceRecord.type !== "assistant") continue;
    if (!hasActiveTurn) {
      addTurnContext(sourceRecord);
      hasActiveTurn = true;
    }

    const assistantTimestamp = asDate(sourceRecord.timestamp).toISOString();
    const assistantContent = Array.isArray(sourceRecord.message?.content)
      ? sourceRecord.message.content
      : [];
    const thinkingBlocks = assistantContent.filter(
      (block): block is ClaudeThinkingBlock => block.type === "thinking"
    );
    if (thinkingBlocks.length > 0) {
      warnings.push(
        `Turn ${turnNumber}: Thinking content stored as summary (encryption not supported)`
      );
      pushRecord<CodexResponseItemRecord>({
        timestamp: assistantTimestamp,
        type: "response_item",
        payload: {
          type: "reasoning",
          content: null,
          encrypted_content: "",
          summary: thinkingBlocks.map((block) => ({
            type: "summary_text",
            text: block.thinking,
          })),
        },
      });
      pushRecord<CodexEventMsgRecord>({
        timestamp: assistantTimestamp,
        type: "event_msg",
        payload: {
          type: "agent_reasoning",
          text: thinkingBlocks.map((block) => block.thinking).join("\n"),
        },
      });
    }

    for (const toolUse of assistantContent.filter(
      (block): block is ClaudeToolUseBlock => block.type === "tool_use"
    )) {
      toolCallsConverted++;
      pushRecord<CodexResponseItemRecord>({
        timestamp: assistantTimestamp,
        type: "response_item",
        payload: {
          type: "function_call",
          name: mapClaudeToolToCodex(toolUse.name),
          arguments: JSON.stringify(toolUse.input),
          call_id: callIdFor(toolUse.id),
        },
      });
    }

    const assistantText = claudeText(assistantContent);
    if (assistantText) {
      pushRecord<CodexResponseItemRecord>({
        timestamp: assistantTimestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: assistantText }],
        },
      });
      pushRecord<CodexEventMsgRecord>({
        timestamp: assistantTimestamp,
        type: "event_msg",
        payload: { type: "agent_message", message: assistantText },
      });
    }

    if (sourceRecord.message.usage) {
      pushRecord<CodexEventMsgRecord>({
        timestamp: assistantTimestamp,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: preserveMetadata ? { claude_usage: sourceRecord.message.usage } : null,
          rate_limits: {
            primary: {
              used_percent: 0,
              window_minutes: 300,
              resets_at: Date.now() / 1000 + 300 * 60,
            },
            secondary: {
              used_percent: 0,
              window_minutes: 10080,
              resets_at: Date.now() / 1000 + 10080 * 60,
            },
            credits: {
              has_credits: false,
              unlimited: false,
              balance: null,
            },
            plan_type: null,
          },
        },
      });
    }
  }

  // Create output path
  const dateDir = join(
    finalOutputDir,
    timestamp.getFullYear().toString(),
    (timestamp.getMonth() + 1).toString().padStart(2, "0"),
    timestamp.getDate().toString().padStart(2, "0")
  );

  await mkdir(dateDir, { recursive: true });

  const filename = generateCodexFilename(timestamp, sessionId);
  const outputPath = join(dateDir, filename);

  // Write JSONL file
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await Bun.write(outputPath, content);

  // Build result session
  const codexSession: CodexSession = {
    id: sessionId,
    filePath: outputPath,
    metadata: sessionMeta.payload,
    records,
    turns: extractCodexTurns(records, sessionMeta.payload),
    recordCounts: recordCounts(records),
    compactions: [],
    totalRecords: {
      session_meta: 1,
      response_item: records.filter((r) => r.type === "response_item").length,
      event_msg: records.filter((r) => r.type === "event_msg").length,
      turn_context: records.filter((r) => r.type === "turn_context").length,
    },
  };

  return {
    success: errors.length === 0,
    outputPath,
    session: codexSession,
    warnings,
    errors,
    statistics: {
      recordsConverted: records.length,
      messagesConverted: effectiveSession.messages.length,
      toolCallsConverted,
      metadataPreserved: preserveMetadata,
    },
  };
}

/**
 * Convert a Codex session to Claude Code format
 */
export async function convertCodexToClaude(
  codexSession: CodexSession,
  options: CodexToClaudeOptions = {}
): Promise<ConversionResult<ClaudeSession>> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const claudeSession = buildClaudeSessionFromCodex(codexSession, options);
  const outputPath = await writeClaudeSession(claudeSession, options);

  if (codexSession.developerMessages?.length) {
    warnings.push(
      `${codexSession.developerMessages.length} Codex developer message(s) were preserved as Claude system records.`
    );
  }
  if (codexSession.compactions?.length) {
    warnings.push(
      `${codexSession.compactions.length} Codex compaction message(s) were preserved as Claude system records.`
    );
  }

  const sourceOnlyRecords = Object.entries(codexSession.recordCounts || {})
    .filter(([type]) =>
      ["world_state", "inter_agent_communication_metadata"].includes(type)
    )
    .map(([type, count]) => `${type}=${count}`);
  if (sourceOnlyRecords.length > 0) {
    warnings.push(
      `Codex runtime metadata retained in the source only: ${sourceOnlyRecords.join(", ")}`
    );
  }

  for (const turn of codexSession.turns) {
    if (turn.reasoning || turn.reasoningSummary) {
      warnings.push(
        `Turn ${turn.turnNumber}: Using reasoning summary (full reasoning was encrypted in Codex)`
      );
    }
  }

  return {
    success: errors.length === 0,
    outputPath,
    session: claudeSession,
    warnings,
    errors,
    statistics: {
      recordsConverted: claudeSession.records.length,
      messagesConverted: claudeSession.messages.length,
      toolCallsConverted: codexSession.turns.reduce(
        (acc, t) => acc + t.toolCalls.length,
        0
      ),
      metadataPreserved: true,
    },
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a Claude session for conversion
 */
export function validateClaudeSession(session: ClaudeSession): string[] {
  const issues: string[] = [];

  if (!session.sessionId) {
    issues.push("Missing sessionId");
  }

  if (session.messages.length === 0) {
    issues.push("No messages in session");
  }

  const uuids = new Set(session.messages.map((m) => m.uuid));
  for (const msg of session.messages) {
    if (msg.parentUuid && !uuids.has(msg.parentUuid)) {
      issues.push(`Message ${msg.uuid} has orphaned parentUuid ${msg.parentUuid}`);
    }
  }

  return issues;
}

/**
 * Validate a Codex session for conversion
 */
export function validateCodexSession(session: CodexSession): string[] {
  const issues: string[] = [];

  if (!session.id) {
    issues.push("Missing session ID");
  }

  if (!session.metadata) {
    issues.push("Missing session metadata");
  }

  if (session.turns.length === 0) {
    issues.push("No conversation turns found");
  }

  for (const [index, turn] of session.turns.entries()) {
    if (!turn.userMessage && turn.userImages.length === 0) {
      issues.push(`Turn ${turn.turnNumber} missing user message`);
    }
    const isTrailingUserTurn = index === session.turns.length - 1;
    if (
      !isTrailingUserTurn &&
      !turn.assistantMessage &&
      turn.toolCalls.length === 0 &&
      turn.agentMessages.length === 0
    ) {
      issues.push(`Turn ${turn.turnNumber} missing assistant response`);
    }
  }

  return issues;
}

// ============================================================================
// HIGH-LEVEL API
// ============================================================================

/**
 * Convert a Claude session file to Codex format
 */
export async function convertClaudeFileToCodex(
  claudeFilePath: string,
  options?: ClaudeToCodexOptions
): Promise<ConversionResult<CodexSession>> {
  const session = await parseClaudeSession(claudeFilePath);
  return convertClaudeToCodex(session, options);
}

/**
 * Convert a Codex session file to Claude format
 */
export async function convertCodexFileToClaude(
  codexFilePath: string,
  options?: CodexToClaudeOptions
): Promise<ConversionResult<ClaudeSession>> {
  const session = await parseCodexSession(codexFilePath);
  return convertCodexToClaude(session, options);
}

/**
 * Detect the format of a session file
 */
export async function detectSessionFormat(
  filePath: string
): Promise<"claude" | "codex" | "gemini" | "unknown"> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const trimmed = text.trim();
    if (!trimmed) return "unknown";

    // Gemini chats are single JSON documents rather than JSONL.
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        "sessionId" in parsed &&
        "projectHash" in parsed &&
        "messages" in parsed &&
        Array.isArray((parsed as { messages: unknown[] }).messages)
      ) {
        return "gemini";
      }
    } catch {
      // Fall through to JSONL detection.
    }

    for (const line of trimmed.split("\n").filter(Boolean).slice(0, 100)) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (record.type === "session_meta" && record.payload) {
        return "codex";
      }

      if (
        typeof record.sessionId === "string" &&
        (typeof record.uuid === "string" ||
          [
            "attachment",
            "last-prompt",
            "atis-latch",
            "mode",
            "ai-title",
            "pr-link",
            "system",
            "permission-mode",
            "file-history-snapshot",
            "bridge-session",
            "cost-state",
          ].includes(String(record.type)))
      ) {
        return "claude";
      }
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}
