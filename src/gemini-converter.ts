/**
 * Gemini Converter - Claude Code <-> Gemini CLI Session Conversion
 *
 * Also provides Gemini <-> Codex wrappers by bridging through Claude-shaped
 * in-memory sessions while preserving target cwd/project routing.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  buildClaudeSessionFromCodex,
  convertClaudeToCodex,
  parseClaudeSession,
  parseCodexSession,
  writeClaudeSession,
  type ClaudeAssistantRecord,
  type ClaudeContentBlock,
  type ClaudeSession,
  type ClaudeTextBlock,
  type ClaudeThinkingBlock,
  type ClaudeToCodexOptions,
  type ClaudeToolResultBlock,
  type ClaudeToolUseBlock,
  type ClaudeUserRecord,
  type CodexSession,
  type CodexToClaudeOptions,
  type ConversionResult,
  type ISO8601Timestamp,
  type UUID,
} from "./session-converter";
import {
  ensureGeminiProjectLocation,
  generateGeminiProjectHash,
  resolveGeminiProjectLocation,
} from "./session-routing";

// ============================================================================
// GEMINI FORMAT TYPES
// ============================================================================

export interface GeminiThought {
  subject: string;
  description: string;
  timestamp: ISO8601Timestamp;
}

export interface GeminiTokens {
  input: number;
  output: number;
  cached: number;
  thoughts: number;
  tool: number;
  total: number;
}

export interface GeminiToolFunctionResponse {
  id?: string;
  name?: string;
  response?: {
    output?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GeminiToolResultItem {
  functionResponse?: GeminiToolFunctionResponse;
  text?: string;
  [key: string]: unknown;
}

export interface GeminiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: GeminiToolResultItem[];
  status?: string;
  timestamp?: ISO8601Timestamp;
  resultDisplay?: string;
  displayName?: string;
  description?: string;
}

export interface GeminiUserMessage {
  id: UUID;
  timestamp: ISO8601Timestamp;
  type: "user";
  content: string;
}

export interface GeminiAssistantMessage {
  id: UUID;
  timestamp: ISO8601Timestamp;
  type: "gemini";
  content: string;
  thoughts: GeminiThought[];
  tokens: GeminiTokens;
  model: string;
  toolCalls?: GeminiToolCall[];
}

export type GeminiMessage = GeminiUserMessage | GeminiAssistantMessage;

export interface GeminiSession {
  sessionId: UUID;
  projectHash: string;
  startTime: ISO8601Timestamp;
  lastUpdated: ISO8601Timestamp;
  messages: GeminiMessage[];
}

// ============================================================================
// CONVERSION OPTIONS
// ============================================================================

export interface ClaudeToGeminiOptions {
  model?: string;
  projectHash?: string;
  outputDir?: string;
  targetCwd?: string;
}

export interface GeminiToClaudeOptions {
  generateUuids?: boolean;
  version?: string;
  outputDir?: string;
  targetCwd?: string;
}

export interface GeminiToCodexOptions
  extends Omit<ClaudeToCodexOptions, "targetCwd"> {
  targetCwd?: string;
}

export interface GeminiConversionResult {
  success: boolean;
  outputPath: string;
  session: GeminiSession;
  warnings: string[];
  errors: string[];
  statistics: {
    recordsConverted: number;
    messagesConverted: number;
    toolCallsConverted: number;
    thoughtsGenerated: number;
  };
}

export interface GeminiSessionListEntry {
  path: string;
  format: "gemini";
  sessionId: string;
  projectHash: string;
  projectKey: string;
  projectRoot?: string;
  timestamp: ISO8601Timestamp;
  messageCount: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateGeminiFilename(timestamp: Date, sessionId: string): string {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getDate()).padStart(2, "0");
  const hours = String(timestamp.getHours()).padStart(2, "0");
  const minutes = String(timestamp.getMinutes()).padStart(2, "0");
  const shortId = sessionId.split("-")[0] || sessionId.substring(0, 8);
  return `session-${year}-${month}-${day}T${hours}-${minutes}-${shortId}.json`;
}

function mapClaudeToolToGeminiName(toolName: string): string {
  const mapping: Record<string, string> = {
    Bash: "run_shell_command",
    Read: "read_file",
    Write: "write_file",
    Edit: "edit",
    Glob: "list_files",
    Grep: "search_file_content",
    Task: "delegate_to_agent",
    WebFetch: "web_fetch",
    WebSearch: "google_web_search",
  };

  return mapping[toolName] || toolName.toLowerCase();
}

function mapGeminiToolToClaudeName(toolName: string): string {
  const mapping: Record<string, string> = {
    run_shell_command: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit: "Edit",
    list_files: "Glob",
    search_file_content: "Grep",
    delegate_to_agent: "Task",
    web_fetch: "WebFetch",
    google_web_search: "WebSearch",
  };

  return mapping[toolName] || toolName;
}

function mapGeminiModelToClaude(model?: string): string {
  if (!model) {
    return process.env.AGENT_CLAUDE_MODEL || "claude-opus-5";
  }

  if (model.includes("gemini") || model.includes("gpt") || model.includes("codex")) {
    return process.env.AGENT_CLAUDE_MODEL || "claude-opus-5";
  }

  return model;
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content, null, 2);
}

function stringifyGeminiToolCallOutput(toolCall: GeminiToolCall): string {
  const firstResult = toolCall.result?.[0];
  const output = firstResult?.functionResponse?.response?.output;

  if (typeof output === "string" && output.trim()) {
    return output;
  }

  if (typeof toolCall.resultDisplay === "string" && toolCall.resultDisplay.trim()) {
    return toolCall.resultDisplay;
  }

  if (toolCall.result && toolCall.result.length > 0) {
    return JSON.stringify(toolCall.result, null, 2);
  }

  return "No output captured";
}

function serializeClaudeToolResultsAsGeminiUserMessage(
  toolResults: ClaudeToolResultBlock[],
  assistantToolUses: ClaudeToolUseBlock[]
): string {
  const toolNameById = new Map(
    assistantToolUses.map((toolUse) => [toolUse.id, mapClaudeToolToGeminiName(toolUse.name)])
  );

  return toolResults
    .map((toolResult) => {
      const name = toolNameById.get(toolResult.tool_use_id) || toolResult.tool_use_id;
      const output = stringifyToolResultContent(toolResult.content);
      return `[Function Response: ${name}]${output}`;
    })
    .join("\n\n");
}

function isGeminiFunctionResponseMessage(content: string): boolean {
  const trimmed = content.trim();
  const prefix = "[Function Response:";
  if (!trimmed.startsWith(prefix)) return false;

  const closingBracket = trimmed.indexOf("]", prefix.length);
  return (
    closingBracket > prefix.length &&
    trimmed.slice(prefix.length, closingBracket).trim().length > 0
  );
}

function extractClaudeToolResultsFromGemini(
  toolCalls: GeminiToolCall[]
): ClaudeToolResultBlock[] {
  return toolCalls.map((toolCall) => ({
    type: "tool_result",
    tool_use_id: `toolu_${toolCall.id.replace(/^toolu_/, "")}`,
    content: stringifyGeminiToolCallOutput(toolCall),
  }));
}

function buildClaudeReasoningTextBlocks(thoughts: GeminiThought[]): ClaudeTextBlock[] {
  if (thoughts.length === 0) {
    return [];
  }

  return [
    {
      type: "text",
      text: `[Imported thoughts]\n${thoughts
        .map((thought) => `${thought.subject}\n${thought.description}`.trim())
        .join("\n\n")}`,
    },
  ];
}

function normalizeGeminiUserContent(content: string): string {
  return content.trim();
}

function defaultGeminiTokens(): GeminiTokens {
  return {
    input: 0,
    output: 0,
    cached: 0,
    thoughts: 0,
    tool: 0,
    total: 0,
  };
}

// ============================================================================
// PARSER
// ============================================================================

export async function parseGeminiSession(filePath: string): Promise<GeminiSession> {
  const text = await Bun.file(filePath).text();
  return JSON.parse(text) as GeminiSession;
}

export async function listGeminiSessions(): Promise<GeminiSessionListEntry[]> {
  const entries: GeminiSessionListEntry[] = [];
  const homeDir = process.env.HOME || Bun.env.HOME;
  if (!homeDir) return entries;

  const tmpDir = join(homeDir, ".gemini", "tmp");

  try {
    const projectDirs = await readdir(tmpDir, { withFileTypes: true });

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) continue;

      const projectKey = projectDir.name;
      const chatsDir = join(tmpDir, projectKey, "chats");
      const projectRootPath = join(tmpDir, projectKey, ".project_root");
      const projectRoot = (await Bun.file(projectRootPath).exists())
        ? (await Bun.file(projectRootPath).text()).trim()
        : undefined;

      try {
        const files = await readdir(chatsDir);
        const jsonFiles = files.filter((file) => file.endsWith(".json"));

        for (const file of jsonFiles) {
          const filePath = join(chatsDir, file);

          try {
            const session = await parseGeminiSession(filePath);
            entries.push({
              path: filePath,
              format: "gemini",
              sessionId: session.sessionId,
              projectHash: session.projectHash,
              projectKey,
              projectRoot,
              timestamp: session.lastUpdated || session.startTime,
              messageCount: session.messages.length,
            });
          } catch {
            // Skip unreadable files.
          }
        }
      } catch {
        // Skip directories without chats/.
      }
    }
  } catch {
    // Ignore missing ~/.gemini/tmp.
  }

  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return entries;
}

// ============================================================================
// CLAUDE -> GEMINI
// ============================================================================

export async function convertClaudeToGemini(
  claudeSession: ClaudeSession,
  options: ClaudeToGeminiOptions = {}
): Promise<GeminiConversionResult> {
  const {
    model = "gemini-2.5-pro",
    projectHash: customProjectHash,
    outputDir,
    targetCwd,
  } = options;

  const effectiveCwd = targetCwd || claudeSession.metadata.cwd;
  const projectLocation = await resolveGeminiProjectLocation(effectiveCwd, outputDir);
  await ensureGeminiProjectLocation(projectLocation);

  const warnings: string[] = [];
  const errors: string[] = [];
  const geminiMessages: GeminiMessage[] = [];

  let toolCallsConverted = 0;
  let thoughtsGenerated = 0;

  const sessionId = crypto.randomUUID();
  const firstTimestamp = claudeSession.messages[0]?.timestamp || new Date().toISOString();
  let lastTimestamp = firstTimestamp;

  for (let i = 0; i < claudeSession.messages.length; i++) {
    const message = claudeSession.messages[i]!;

    if (message.type === "user") {
      const userMessage = message as ClaudeUserRecord;
      const content = Array.isArray(userMessage.message?.content)
        ? userMessage.message.content
        : [];

      const textBlocks = content.filter(
        (block): block is ClaudeTextBlock => block.type === "text"
      );
      const toolResultBlocks = content.filter(
        (block): block is ClaudeToolResultBlock => block.type === "tool_result"
      );

      const userText = textBlocks.map((block) => block.text).join("\n").trim();

      if (userText) {
        geminiMessages.push({
          id: crypto.randomUUID(),
          timestamp: userMessage.timestamp,
          type: "user",
          content: userText,
        });
        lastTimestamp = userMessage.timestamp;
        continue;
      }

      if (toolResultBlocks.length > 0) {
        let previousAssistantToolUses: ClaudeToolUseBlock[] = [];

        for (let j = i - 1; j >= 0; j--) {
          const candidate = claudeSession.messages[j];
          if (candidate?.type !== "assistant") continue;
          const assistantContent = Array.isArray(candidate.message?.content)
            ? candidate.message.content
            : [];
          previousAssistantToolUses = assistantContent.filter(
            (block): block is ClaudeToolUseBlock => block.type === "tool_use"
          );
          break;
        }

        geminiMessages.push({
          id: crypto.randomUUID(),
          timestamp: userMessage.timestamp,
          type: "user",
          content: serializeClaudeToolResultsAsGeminiUserMessage(
            toolResultBlocks,
            previousAssistantToolUses
          ),
        });
        lastTimestamp = userMessage.timestamp;
      }

      continue;
    }

    const assistantMessage = message as ClaudeAssistantRecord;
    const content = Array.isArray(assistantMessage.message?.content)
      ? assistantMessage.message.content
      : [];

    const textBlocks = content.filter(
      (block): block is ClaudeTextBlock => block.type === "text"
    );
    const thinkingBlocks = content.filter(
      (block): block is ClaudeThinkingBlock => block.type === "thinking"
    );
    const toolUseBlocks = content.filter(
      (block): block is ClaudeToolUseBlock => block.type === "tool_use"
    );

    const thoughts: GeminiThought[] = thinkingBlocks.map((block, index) => {
      thoughtsGenerated++;
      const firstLine = block.thinking.split("\n")[0] || "Reasoning";
      return {
        subject: firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine,
        description: block.thinking,
        timestamp: new Date(
          new Date(assistantMessage.timestamp).getTime() + index * 1000
        ).toISOString(),
      };
    });

    const toolResultLookup = new Map<string, ClaudeToolResultBlock>();
    for (let j = i + 1; j < claudeSession.messages.length; j++) {
      const nextMessage = claudeSession.messages[j];
      if (!nextMessage || nextMessage.type !== "user") break;

      const nextContent = Array.isArray(nextMessage.message?.content)
        ? nextMessage.message.content
        : [];
      const toolResults = nextContent.filter(
        (block): block is ClaudeToolResultBlock => block.type === "tool_result"
      );

      for (const toolResult of toolResults) {
        toolResultLookup.set(toolResult.tool_use_id, toolResult);
      }

      if (toolResults.length === 0) {
        break;
      }
    }

    const toolCalls: GeminiToolCall[] = toolUseBlocks.map((toolUse) => {
      toolCallsConverted++;
      const matchingResult = toolResultLookup.get(toolUse.id);
      const output = matchingResult
        ? stringifyToolResultContent(matchingResult.content)
        : "No output captured";

      return {
        id: toolUse.id,
        name: mapClaudeToolToGeminiName(toolUse.name),
        args: toolUse.input,
        status: "success",
        timestamp: assistantMessage.timestamp,
        resultDisplay: output,
        result: [
          {
            functionResponse: {
              id: toolUse.id,
              name: mapClaudeToolToGeminiName(toolUse.name),
              response: {
                output,
              },
            },
          },
        ],
      };
    });

    const inputTokens = assistantMessage.message.usage?.input_tokens || 0;
    const outputTokens = assistantMessage.message.usage?.output_tokens || 0;
    const cachedTokens = assistantMessage.message.usage?.cache_read_input_tokens || 0;
    const toolTokenEstimate = toolCalls.length * 100;
    const thoughtTokenEstimate = Math.round(
      thinkingBlocks.reduce((acc, block) => acc + block.thinking.length / 4, 0)
    );

    const tokens: GeminiTokens = {
      input: inputTokens,
      output: outputTokens,
      cached: cachedTokens,
      thoughts: thoughtTokenEstimate,
      tool: toolTokenEstimate,
      total:
        inputTokens +
        outputTokens +
        cachedTokens +
        thoughtTokenEstimate +
        toolTokenEstimate,
    };

    geminiMessages.push({
      id: crypto.randomUUID(),
      timestamp: assistantMessage.timestamp,
      type: "gemini",
      content: textBlocks.map((block) => block.text).join("\n").trim() || "(no text content)",
      thoughts,
      tokens,
      model,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
    lastTimestamp = assistantMessage.timestamp;
  }

  const geminiSession: GeminiSession = {
    sessionId,
    projectHash: customProjectHash || projectLocation.projectHash,
    startTime: firstTimestamp,
    lastUpdated: lastTimestamp,
    messages: geminiMessages,
  };

  const filename = generateGeminiFilename(new Date(firstTimestamp), sessionId);
  const outputPath = join(projectLocation.chatsDir, filename);
  await Bun.write(outputPath, JSON.stringify(geminiSession, null, 2));

  return {
    success: errors.length === 0,
    outputPath,
    session: geminiSession,
    warnings,
    errors,
    statistics: {
      recordsConverted: geminiMessages.length,
      messagesConverted: geminiMessages.length,
      toolCallsConverted,
      thoughtsGenerated,
    },
  };
}

export async function convertClaudeFileToGemini(
  claudeFilePath: string,
  options?: ClaudeToGeminiOptions
): Promise<GeminiConversionResult> {
  const session = await parseClaudeSession(claudeFilePath);
  return convertClaudeToGemini(session, options);
}

// ============================================================================
// GEMINI -> CLAUDE
// ============================================================================

function buildClaudeSessionFromGemini(
  geminiSession: GeminiSession,
  options: GeminiToClaudeOptions = {}
): ClaudeSession {
  const {
    generateUuids = true,
    version = process.env.AGENT_CLAUDE_VERSION || "2.1.170",
    targetCwd = process.cwd(),
  } = options;

  const sessionId = generateUuids ? crypto.randomUUID() : geminiSession.sessionId;
  const records: ClaudeSession["records"] = [];
  const messages: ClaudeSession["messages"] = [];

  let parentUuid: string | null = null;
  let pendingToolCalls: GeminiToolCall[] = [];
  let pendingParentUuid: string | null = null;

  const flushPendingToolResults = (timestamp?: string) => {
    if (pendingToolCalls.length === 0 || !pendingParentUuid) {
      return;
    }

    const toolResultUuid = generateUuids ? crypto.randomUUID() : `tool-result-${records.length}`;
    const toolResultRecord: ClaudeUserRecord = {
      type: "user",
      sessionId,
      timestamp: timestamp || new Date().toISOString(),
      uuid: toolResultUuid,
      parentUuid: pendingParentUuid,
      isSidechain: false,
      userType: "internal",
      cwd: targetCwd,
      version,
      gitBranch: "",
      message: {
        role: "user",
        content: extractClaudeToolResultsFromGemini(pendingToolCalls),
      },
    };

    records.push(toolResultRecord);
    messages.push(toolResultRecord);
    parentUuid = toolResultUuid;
    pendingToolCalls = [];
    pendingParentUuid = null;
  };

  for (const message of geminiSession.messages) {
    if (message.type === "user") {
      const content = normalizeGeminiUserContent(message.content);

      if (isGeminiFunctionResponseMessage(content)) {
        flushPendingToolResults(message.timestamp);
        continue;
      }

      flushPendingToolResults(message.timestamp);

      const userUuid = generateUuids ? crypto.randomUUID() : message.id;
      const userRecord: ClaudeUserRecord = {
        type: "user",
        sessionId,
        timestamp: message.timestamp,
        uuid: userUuid,
        parentUuid,
        isSidechain: false,
        userType: "external",
        cwd: targetCwd,
        version,
        gitBranch: "",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        },
      };

      records.push(userRecord);
      messages.push(userRecord);
      parentUuid = userUuid;
      continue;
    }

    flushPendingToolResults(message.timestamp);

    const assistantUuid = generateUuids ? crypto.randomUUID() : message.id;
    const assistantContent: ClaudeContentBlock[] = [];

    assistantContent.push(...buildClaudeReasoningTextBlocks(message.thoughts || []));

    for (const toolCall of message.toolCalls || []) {
      assistantContent.push({
        type: "tool_use",
        id: `toolu_${toolCall.id.replace(/^toolu_/, "")}`,
        name: mapGeminiToolToClaudeName(toolCall.name),
        input: toolCall.args || {},
      });
    }

    if (message.content.trim()) {
      assistantContent.push({
        type: "text",
        text: message.content.trim(),
      });
    }

    const assistantRecord: ClaudeAssistantRecord = {
      type: "assistant",
      sessionId,
      timestamp: message.timestamp,
      uuid: assistantUuid,
      parentUuid,
      isSidechain: false,
      userType: "external",
      cwd: targetCwd,
      version,
      gitBranch: "",
      message: {
        role: "assistant",
        model: mapGeminiModelToClaude(message.model),
        id: `msg_${assistantUuid.substring(0, 10)}`,
        type: "message",
        content: assistantContent,
        stop_reason: (message.toolCalls?.length || 0) > 0 ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: message.tokens?.input || 0,
          output_tokens: message.tokens?.output || 0,
          cache_read_input_tokens: message.tokens?.cached || 0,
        },
      },
    };

    records.push(assistantRecord);
    messages.push(assistantRecord);
    parentUuid = assistantUuid;

    if ((message.toolCalls?.length || 0) > 0) {
      pendingToolCalls = message.toolCalls || [];
      pendingParentUuid = assistantUuid;
    }
  }

  flushPendingToolResults(geminiSession.lastUpdated);

  return {
    sessionId,
    projectPath: targetCwd,
    filePath: "",
    records,
    messages,
    summary: undefined,
    fileSnapshots: [],
    metadata: {
      version,
      cwd: targetCwd,
      gitBranch: "",
      totalTokens: {
        input: geminiSession.messages.reduce((acc, message) => {
          if (message.type !== "gemini") return acc;
          return acc + (message.tokens?.input || 0);
        }, 0),
        output: geminiSession.messages.reduce((acc, message) => {
          if (message.type !== "gemini") return acc;
          return acc + (message.tokens?.output || 0);
        }, 0),
      },
    },
  };
}

export async function convertGeminiToClaude(
  geminiSession: GeminiSession,
  options: GeminiToClaudeOptions = {}
): Promise<ConversionResult<ClaudeSession>> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const claudeSession = buildClaudeSessionFromGemini(geminiSession, options);
  const outputPath = await writeClaudeSession(claudeSession, {
    outputDir: options.outputDir,
    targetCwd: options.targetCwd,
  });

  if (geminiSession.messages.some((message) => message.type === "user" && isGeminiFunctionResponseMessage(message.content))) {
    warnings.push(
      "Gemini serialized function-response user messages were converted into Claude internal tool_result records."
    );
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
      toolCallsConverted: geminiSession.messages.reduce((acc, message) => {
        if (message.type !== "gemini") return acc;
        return acc + (message.toolCalls?.length || 0);
      }, 0),
      metadataPreserved: true,
    },
  };
}

export async function convertGeminiFileToClaude(
  geminiFilePath: string,
  options?: GeminiToClaudeOptions
): Promise<ConversionResult<ClaudeSession>> {
  const session = await parseGeminiSession(geminiFilePath);
  return convertGeminiToClaude(session, options);
}

// ============================================================================
// GEMINI <-> CODEX
// ============================================================================

export async function convertGeminiToCodex(
  geminiSession: GeminiSession,
  options: GeminiToCodexOptions = {}
): Promise<ConversionResult<CodexSession>> {
  const claudeSession = buildClaudeSessionFromGemini(geminiSession, {
    targetCwd: options.targetCwd,
    generateUuids: true,
  });

  return convertClaudeToCodex(claudeSession, {
    ...options,
    targetCwd: options.targetCwd,
  });
}

export async function convertGeminiFileToCodex(
  geminiFilePath: string,
  options?: GeminiToCodexOptions
): Promise<ConversionResult<CodexSession>> {
  const session = await parseGeminiSession(geminiFilePath);
  return convertGeminiToCodex(session, options);
}

export async function convertCodexToGemini(
  codexSession: CodexSession,
  options: ClaudeToGeminiOptions = {}
): Promise<GeminiConversionResult> {
  const claudeSession = buildClaudeSessionFromCodex(codexSession, {
    targetCwd: options.targetCwd,
  } satisfies Omit<CodexToClaudeOptions, "outputDir">);

  return convertClaudeToGemini(claudeSession, options);
}

export async function convertCodexFileToGemini(
  codexFilePath: string,
  options?: ClaudeToGeminiOptions
): Promise<GeminiConversionResult> {
  const session = await parseCodexSession(codexFilePath);
  return convertCodexToGemini(session, options);
}

// ============================================================================
// DETECTION
// ============================================================================

export async function isGeminiFormat(filePath: string): Promise<boolean> {
  try {
    const text = await Bun.file(filePath).text();
    const data = JSON.parse(text);
    return (
      data &&
      typeof data === "object" &&
      "sessionId" in data &&
      "projectHash" in data &&
      "messages" in data &&
      Array.isArray((data as { messages: unknown[] }).messages)
    );
  } catch {
    return false;
  }
}
