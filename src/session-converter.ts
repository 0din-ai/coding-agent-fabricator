/**
 * Session Converter - Bidirectional Claude Code ↔ Codex JSONL Conversion
 *
 * Converts sessions between Claude Code (~/.claude/projects/) and
 * OpenAI Codex (~/.codex/sessions/) JSONL formats.
 */

import { mkdir, readdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";

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
  | "queue-operation";

export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Record<string, unknown>;
}

export interface ClaudeThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock
  | ClaudeThinkingBlock;

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
    content: ClaudeContentBlock[];
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

export type ClaudeRecord =
  | ClaudeUserRecord
  | ClaudeAssistantRecord
  | ClaudeSummaryRecord
  | ClaudeFileHistorySnapshot;

export interface ClaudeSession {
  sessionId: UUID;
  projectPath: string;
  filePath: string;
  records: ClaudeRecord[];
  messages: (ClaudeUserRecord | ClaudeAssistantRecord)[];
  summary?: ClaudeSummaryRecord;
  fileSnapshots: ClaudeFileHistorySnapshot[];
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
  | "turn_context";

export interface CodexRecordBase {
  timestamp: ISO8601Timestamp;
  type: CodexRecordType;
}

export interface CodexSessionMetaPayload {
  id: ULID;
  timestamp: ISO8601Timestamp;
  cwd: string;
  originator: string;
  cli_version: string;
  instructions: string | null;
  source: string;
  model_provider: string;
  git?: {
    commit_hash: string;
    branch: string;
  };
}

export interface CodexSessionMetaRecord extends CodexRecordBase {
  type: "session_meta";
  payload: CodexSessionMetaPayload;
}

export interface CodexMessagePayload {
  type: "message";
  role: "user" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
}

export interface CodexReasoningPayload {
  type: "reasoning";
  content: null;
  encrypted_content: string;
  summary: Array<{ type: "summary_text"; text: string }>;
}

export interface CodexFunctionCallPayload {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
}

export interface CodexFunctionCallOutputPayload {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type CodexResponseItemPayload =
  | CodexMessagePayload
  | CodexReasoningPayload
  | CodexFunctionCallPayload
  | CodexFunctionCallOutputPayload;

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
  | CodexTokenCountEvent;

export interface CodexEventMsgRecord extends CodexRecordBase {
  type: "event_msg";
  payload: CodexEventMsgPayload;
}

export interface CodexTurnContextPayload {
  cwd: string;
  approval_policy: string;
  sandbox_policy: { type: string };
  model: string;
  effort: "high" | "medium" | "low";
  summary: string;
  user_instructions: string;
  truncation_policy: { mode: string; limit: number };
}

export interface CodexTurnContextRecord extends CodexRecordBase {
  type: "turn_context";
  payload: CodexTurnContextPayload;
}

export type CodexRecord =
  | CodexSessionMetaRecord
  | CodexResponseItemRecord
  | CodexEventMsgRecord
  | CodexTurnContextRecord;

export interface CodexConversationTurn {
  turnNumber: number;
  context: CodexTurnContextPayload;
  userMessage: string;
  reasoning?: string;
  reasoningSummary?: string;
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    callId: string;
    output: string;
  }>;
  assistantMessage: string;
  tokenUsage?: CodexTokenCountEvent["rate_limits"];
}

export interface CodexSession {
  id: ULID;
  filePath: string;
  metadata: CodexSessionMetaPayload;
  records: CodexRecord[];
  turns: CodexConversationTurn[];
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
}

export interface CodexToClaudeOptions {
  generateUuids?: boolean;
  reconstructThreading?: boolean;
  projectPath?: string;
  version?: string;
  outputDir?: string;
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
  if (codexModel.includes("gpt") || codexModel.includes("codex")) {
    return "claude-sonnet-4-5-20250929";
  }
  return codexModel;
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
  const projectPath = projectDir.replace(/^-/, "/").replace(/-/g, "/");

  return {
    sessionId,
    projectPath,
    filePath,
    records,
    messages,
    summary,
    fileSnapshots,
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
      const decodedPath = "/" + dir.replace(/^-/, "").replace(/-/g, "/");

      if (projectPath && !decodedPath.includes(projectPath)) {
        continue;
      }

      const projectDir = join(projectsDir, dir);

      try {
        const files = await readdir(projectDir);
        const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

        for (const file of jsonlFiles) {
          const filePath = join(projectDir, file);
          const sessionId = basename(file, ".jsonl");
          const stat = await Bun.file(filePath).stat();

          entries.push({
            path: filePath,
            format: "claude",
            sessionId,
            timestamp: stat?.mtime?.toISOString() || new Date().toISOString(),
            project: decodedPath,
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
function extractCodexTurns(records: CodexRecord[]): CodexConversationTurn[] {
  const turns: CodexConversationTurn[] = [];
  let currentTurn: Partial<CodexConversationTurn> | null = null;
  let turnNumber = 0;

  const pendingToolCalls = new Map<
    string,
    { name: string; arguments: Record<string, unknown>; callId: string }
  >();

  for (const record of records) {
    if (record.type === "turn_context") {
      if (currentTurn && currentTurn.userMessage) {
        turns.push(currentTurn as CodexConversationTurn);
      }

      turnNumber++;
      currentTurn = {
        turnNumber,
        context: (record as CodexTurnContextRecord).payload,
        userMessage: "",
        toolCalls: [],
        assistantMessage: "",
      };
      pendingToolCalls.clear();
    }

    if (record.type === "event_msg") {
      const eventRecord = record as CodexEventMsgRecord;

      if (eventRecord.payload.type === "user_message" && currentTurn) {
        currentTurn.userMessage = eventRecord.payload.message;
      }

      if (eventRecord.payload.type === "agent_reasoning" && currentTurn) {
        currentTurn.reasoning = eventRecord.payload.text;
      }

      if (eventRecord.payload.type === "agent_message" && currentTurn) {
        currentTurn.assistantMessage = eventRecord.payload.message;
      }

      if (eventRecord.payload.type === "token_count" && currentTurn) {
        currentTurn.tokenUsage = eventRecord.payload.rate_limits;
      }
    }

    if (record.type === "response_item") {
      const responseRecord = record as CodexResponseItemRecord;
      const payload = responseRecord.payload;

      if (payload.type === "reasoning") {
        const reasoningPayload = payload as CodexReasoningPayload;
        if (currentTurn && reasoningPayload.summary?.[0]?.text) {
          currentTurn.reasoningSummary = reasoningPayload.summary[0].text;
        }
      }

      if (payload.type === "function_call") {
        const callPayload = payload as CodexFunctionCallPayload;
        try {
          pendingToolCalls.set(callPayload.call_id, {
            name: callPayload.name,
            arguments: JSON.parse(callPayload.arguments),
            callId: callPayload.call_id,
          });
        } catch {
          pendingToolCalls.set(callPayload.call_id, {
            name: callPayload.name,
            arguments: { raw: callPayload.arguments },
            callId: callPayload.call_id,
          });
        }
      }

      if (payload.type === "function_call_output") {
        const outputPayload = payload as CodexFunctionCallOutputPayload;
        const pendingCall = pendingToolCalls.get(outputPayload.call_id);

        if (pendingCall && currentTurn) {
          currentTurn.toolCalls = currentTurn.toolCalls || [];
          currentTurn.toolCalls.push({
            ...pendingCall,
            output: outputPayload.output,
          });
          pendingToolCalls.delete(outputPayload.call_id);
        }
      }
    }
  }

  if (currentTurn && currentTurn.userMessage) {
    turns.push(currentTurn as CodexConversationTurn);
  }

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

  const turns = extractCodexTurns(records);

  return {
    id: metaRecord.payload.id,
    filePath,
    metadata: metaRecord.payload,
    records,
    turns,
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
    cliVersion = "0.80.0",
    outputDir,
  } = options;

  const homeDir = process.env.HOME || Bun.env.HOME || "/tmp";
  const finalOutputDir = outputDir || join(homeDir, ".codex", "sessions");

  const warnings: string[] = [];
  const errors: string[] = [];
  const records: CodexRecord[] = [];

  const sessionId = generateUlid();
  const timestamp = new Date(
    claudeSession.messages[0]?.timestamp || Date.now()
  );

  // Create session_meta record
  const sessionMeta: CodexSessionMetaRecord = {
    timestamp: timestamp.toISOString(),
    type: "session_meta",
    payload: {
      id: sessionId,
      timestamp: timestamp.toISOString(),
      cwd: claudeSession.metadata.cwd,
      originator: "session-converter",
      cli_version: cliVersion,
      instructions: null,
      source: "converted",
      model_provider: modelProvider,
      ...(claudeSession.metadata.gitBranch
        ? {
            git: {
              commit_hash: "",
              branch: claudeSession.metadata.gitBranch,
            },
          }
        : {}),
    },
  };
  records.push(sessionMeta);

  // Process messages in pairs (user -> assistant = one turn)
  let turnNumber = 0;
  let i = 0;

  while (i < claudeSession.messages.length) {
    const userMsg = claudeSession.messages[i];

    if (userMsg?.type !== "user") {
      i++;
      continue;
    }

    // Find the next assistant message
    let assistantMsg: ClaudeAssistantRecord | null = null;
    for (let j = i + 1; j < claudeSession.messages.length; j++) {
      if (claudeSession.messages[j]!.type === "assistant") {
        assistantMsg = claudeSession.messages[j] as ClaudeAssistantRecord;
        i = j + 1;
        break;
      }
    }

    if (!assistantMsg) {
      i++;
      continue;
    }

    turnNumber++;
    const turnTimestamp = new Date(userMsg.timestamp);

    // Create turn_context
    const turnContext: CodexTurnContextRecord = {
      timestamp: turnTimestamp.toISOString(),
      type: "turn_context",
      payload: {
        cwd: userMsg.cwd,
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
        model,
        effort: "high",
        summary: "auto",
        user_instructions: "",
        truncation_policy: { mode: "tokens", limit: 10000 },
      },
    };
    records.push(turnContext);

    // Extract user text (handle cases where content might not be an array)
    const userContent = Array.isArray(userMsg.message?.content)
      ? userMsg.message.content
      : [];
    const userText = userContent
      .filter((b): b is ClaudeTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Create event_msg for user message
    const userEvent: CodexEventMsgRecord = {
      timestamp: turnTimestamp.toISOString(),
      type: "event_msg",
      payload: {
        type: "user_message",
        message: userText,
        images: [],
      },
    };
    records.push(userEvent);

    // Create response_item for user message
    const userResponse: CodexResponseItemRecord = {
      timestamp: turnTimestamp.toISOString(),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: userText }],
      },
    };
    records.push(userResponse);

    // Process assistant content
    const assistantTimestamp = new Date(assistantMsg.timestamp);

    // Handle assistant content (protect against non-array content)
    const assistantContent = Array.isArray(assistantMsg.message?.content)
      ? assistantMsg.message.content
      : [];

    // Handle thinking blocks
    const thinkingBlocks = assistantContent.filter(
      (b): b is ClaudeThinkingBlock => b.type === "thinking"
    );

    if (thinkingBlocks.length > 0) {
      warnings.push(
        `Turn ${turnNumber}: Thinking content stored as summary (encryption not supported)`
      );

      const reasoningResponse: CodexResponseItemRecord = {
        timestamp: assistantTimestamp.toISOString(),
        type: "response_item",
        payload: {
          type: "reasoning",
          content: null,
          encrypted_content: "",
          summary: thinkingBlocks.map((b) => ({
            type: "summary_text" as const,
            text: b.thinking.substring(0, 500) + "...",
          })),
        },
      };
      records.push(reasoningResponse);

      const reasoningEvent: CodexEventMsgRecord = {
        timestamp: assistantTimestamp.toISOString(),
        type: "event_msg",
        payload: {
          type: "agent_reasoning",
          text: thinkingBlocks[0]!.thinking.substring(0, 200),
        },
      };
      records.push(reasoningEvent);
    }

    // Handle tool uses
    const toolUses = assistantContent.filter(
      (b): b is ClaudeToolUseBlock => b.type === "tool_use"
    );

    // Find matching tool results
    const toolResults = new Map<string, string>();
    for (let k = i; k < claudeSession.messages.length; k++) {
      const msg = claudeSession.messages[k];
      if (msg?.type === "user") {
        const msgContent = Array.isArray(msg.message?.content) ? msg.message.content : [];
        for (const block of msgContent) {
          if (block.type === "tool_result") {
            const resultBlock = block as ClaudeToolResultBlock;
            toolResults.set(
              resultBlock.tool_use_id,
              typeof resultBlock.content === "string"
                ? resultBlock.content
                : JSON.stringify(resultBlock.content)
            );
          }
        }
      }
      if (msg?.type === "assistant") break;
    }

    for (const toolUse of toolUses) {
      const callResponse: CodexResponseItemRecord = {
        timestamp: assistantTimestamp.toISOString(),
        type: "response_item",
        payload: {
          type: "function_call",
          name: mapClaudeToolToCodex(toolUse.name),
          arguments: JSON.stringify(toolUse.input),
          call_id: `call_${toolUse.id.substring(0, 20)}`,
        },
      };
      records.push(callResponse);

      const output = toolResults.get(toolUse.id) || "No output captured";
      const outputResponse: CodexResponseItemRecord = {
        timestamp: assistantTimestamp.toISOString(),
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: `call_${toolUse.id.substring(0, 20)}`,
          output,
        },
      };
      records.push(outputResponse);
    }

    // Handle text response
    const textBlocks = assistantContent.filter(
      (b): b is ClaudeTextBlock => b.type === "text"
    );

    const assistantText = textBlocks.map((b) => b.text).join("\n");

    if (assistantText) {
      const assistantResponse: CodexResponseItemRecord = {
        timestamp: assistantTimestamp.toISOString(),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: assistantText }],
        },
      };
      records.push(assistantResponse);

      const assistantEvent: CodexEventMsgRecord = {
        timestamp: assistantTimestamp.toISOString(),
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: assistantText,
        },
      };
      records.push(assistantEvent);
    }

    // Add token count event
    if (assistantMsg.message.usage) {
      const tokenEvent: CodexEventMsgRecord = {
        timestamp: assistantTimestamp.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: preserveMetadata ? { claude_usage: assistantMsg.message.usage } : null,
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
      };
      records.push(tokenEvent);
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
    turns: [],
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
      messagesConverted: claudeSession.messages.length,
      toolCallsConverted: claudeSession.messages.reduce((acc, m) => {
        if (m.type === "assistant") {
          const content = Array.isArray(m.message?.content) ? m.message.content : [];
          return acc + content.filter((b) => b.type === "tool_use").length;
        }
        return acc;
      }, 0),
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
  const {
    generateUuids = true,
    reconstructThreading = true,
    projectPath = "/tmp/converted-sessions",
    version = "2.0.76",
    outputDir,
  } = options;

  const homeDir = process.env.HOME || Bun.env.HOME || "/tmp";
  const finalOutputDir = outputDir || join(homeDir, ".claude", "projects");

  const warnings: string[] = [];
  const errors: string[] = [];
  const records: ClaudeRecord[] = [];
  const messages: (ClaudeUserRecord | ClaudeAssistantRecord)[] = [];

  const sessionId = generateUuids ? crypto.randomUUID() : codexSession.id;
  let parentUuid: string | null = null;

  // Process each turn
  for (const turn of codexSession.turns) {
    const userUuid = generateUuids ? crypto.randomUUID() : `user-${turn.turnNumber}`;
    const assistantUuid = generateUuids
      ? crypto.randomUUID()
      : `assistant-${turn.turnNumber}`;

    // Create user record
    const userContent: ClaudeTextBlock[] = [
      {
        type: "text",
        text: turn.userMessage,
      },
    ];

    const userRecord: ClaudeUserRecord = {
      type: "user",
      sessionId,
      timestamp: new Date().toISOString(),
      uuid: userUuid,
      parentUuid: reconstructThreading ? parentUuid : null,
      isSidechain: false,
      userType: "external",
      cwd: turn.context?.cwd || codexSession.metadata.cwd,
      version,
      gitBranch: codexSession.metadata.git?.branch || "",
      message: {
        role: "user",
        content: userContent,
      },
    };

    records.push(userRecord);
    messages.push(userRecord);

    // Create assistant record
    const assistantContent: (
      | ClaudeTextBlock
      | ClaudeToolUseBlock
      | ClaudeThinkingBlock
    )[] = [];

    // Add reasoning if available
    if (turn.reasoning || turn.reasoningSummary) {
      warnings.push(
        `Turn ${turn.turnNumber}: Using reasoning summary (full reasoning was encrypted in Codex)`
      );
      assistantContent.push({
        type: "thinking",
        thinking: turn.reasoning || turn.reasoningSummary || "",
      });
    }

    // Add tool uses
    for (const toolCall of turn.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: `toolu_${toolCall.callId.replace("call_", "")}`,
        name: mapCodexToolToClaude(toolCall.name),
        input: toolCall.arguments,
      });
    }

    // Add text response
    if (turn.assistantMessage) {
      assistantContent.push({
        type: "text",
        text: turn.assistantMessage,
      });
    }

    const assistantRecord: ClaudeAssistantRecord = {
      type: "assistant",
      sessionId,
      timestamp: new Date().toISOString(),
      uuid: assistantUuid,
      parentUuid: reconstructThreading ? userUuid : null,
      isSidechain: false,
      userType: "external",
      cwd: turn.context?.cwd || codexSession.metadata.cwd,
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

    // Add tool results as user messages
    if (turn.toolCalls.length > 0) {
      const toolResultUuid = generateUuids
        ? crypto.randomUUID()
        : `tool-result-${turn.turnNumber}`;

      const toolResultContent: ClaudeToolResultBlock[] = turn.toolCalls.map(
        (call) => ({
          type: "tool_result" as const,
          tool_use_id: `toolu_${call.callId.replace("call_", "")}`,
          content: call.output,
        })
      );

      const toolResultRecord: ClaudeUserRecord = {
        type: "user",
        sessionId,
        timestamp: new Date().toISOString(),
        uuid: toolResultUuid,
        parentUuid: reconstructThreading ? assistantUuid : null,
        isSidechain: false,
        userType: "internal",
        cwd: turn.context?.cwd || codexSession.metadata.cwd,
        version,
        gitBranch: codexSession.metadata.git?.branch || "",
        message: {
          role: "user",
          content: toolResultContent,
        },
      };

      records.push(toolResultRecord);
      messages.push(toolResultRecord);

      parentUuid = toolResultUuid;
    } else {
      parentUuid = assistantUuid;
    }
  }

  // Create output directory
  const encodedProjectPath = projectPath.replace(/\//g, "-").replace(/^-/, "");
  const projectDir = join(finalOutputDir, encodedProjectPath);
  await mkdir(projectDir, { recursive: true });

  const outputPath = join(projectDir, `${sessionId}.jsonl`);

  // Write JSONL file
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await Bun.write(outputPath, content);

  // Build result session
  const claudeSession: ClaudeSession = {
    sessionId,
    projectPath,
    filePath: outputPath,
    records,
    messages,
    summary: undefined,
    fileSnapshots: [],
    metadata: {
      version,
      cwd: codexSession.metadata.cwd,
      gitBranch: codexSession.metadata.git?.branch || "",
      totalTokens: {
        input: 0,
        output: 0,
      },
    },
  };

  return {
    success: errors.length === 0,
    outputPath,
    session: claudeSession,
    warnings,
    errors,
    statistics: {
      recordsConverted: records.length,
      messagesConverted: codexSession.turns.length * 2,
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

  for (const turn of session.turns) {
    if (!turn.userMessage) {
      issues.push(`Turn ${turn.turnNumber} missing user message`);
    }
    if (!turn.assistantMessage && turn.toolCalls.length === 0) {
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
): Promise<"claude" | "codex" | "unknown"> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const firstLine = text.split("\n")[0];
    if (!firstLine) return "unknown";

    const record = JSON.parse(firstLine);

    // Codex files start with session_meta
    if (record.type === "session_meta" && record.payload?.originator) {
      return "codex";
    }

    // Claude files have sessionId and uuid
    if (record.sessionId && record.uuid) {
      return "claude";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}
