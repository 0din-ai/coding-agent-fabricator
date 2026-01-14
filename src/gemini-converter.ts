/**
 * Gemini Converter - Claude Code ↔ Gemini CLI Session Conversion
 *
 * Converts sessions between Claude Code (~/.claude/projects/) and
 * Gemini CLI (~/.gemini/tmp/{projectHash}/chats/) formats.
 *
 * Key difference: Gemini uses JSON (single file), not JSONL.
 */

import { mkdir, readdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import type {
  ClaudeSession,
  ClaudeUserRecord,
  ClaudeAssistantRecord,
  ClaudeTextBlock,
  ClaudeToolUseBlock,
  ClaudeToolResultBlock,
  ClaudeThinkingBlock,
  ISO8601Timestamp,
  UUID,
} from "./session-converter";

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
  timestamp: ISO8601Timestamp;
  messageCount: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateProjectHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex");
}

function generateGeminiFilename(timestamp: Date, sessionId: string): string {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getDate()).padStart(2, "0");
  const hours = String(timestamp.getHours()).padStart(2, "0");
  const minutes = String(timestamp.getMinutes()).padStart(2, "0");
  const shortId = sessionId.split("-")[0] || sessionId.substring(0, 8);
  return `session-${year}-${month}-${day}T${hours}-${minutes}-${shortId}.json`;
}

function mapClaudeToolToGeminiText(
  toolName: string,
  input: Record<string, unknown>
): string {
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
  const geminiName = mapping[toolName] || toolName.toLowerCase();
  const inputStr = JSON.stringify(input, null, 2);
  return `[Tool Call: ${geminiName}]\n${inputStr}`;
}

// ============================================================================
// PARSER
// ============================================================================

/**
 * Parse a Gemini session JSON file
 */
export async function parseGeminiSession(
  filePath: string
): Promise<GeminiSession> {
  const file = Bun.file(filePath);
  const text = await file.text();
  return JSON.parse(text) as GeminiSession;
}

/**
 * List all Gemini sessions
 */
export async function listGeminiSessions(): Promise<GeminiSessionListEntry[]> {
  const entries: GeminiSessionListEntry[] = [];
  const homeDir = process.env.HOME || Bun.env.HOME;
  if (!homeDir) return entries;

  const tmpDir = join(homeDir, ".gemini", "tmp");

  try {
    const projectDirs = await readdir(tmpDir);

    for (const projectHash of projectDirs) {
      const chatsDir = join(tmpDir, projectHash, "chats");

      try {
        const files = await readdir(chatsDir);
        const jsonFiles = files.filter((f) => f.endsWith(".json"));

        for (const file of jsonFiles) {
          const filePath = join(chatsDir, file);

          try {
            const session = await parseGeminiSession(filePath);
            entries.push({
              path: filePath,
              format: "gemini",
              sessionId: session.sessionId,
              projectHash: session.projectHash,
              timestamp: session.lastUpdated || session.startTime,
              messageCount: session.messages.length,
            });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Skip directories without chats/
      }
    }
  } catch {
    // tmp directory doesn't exist
  }

  entries.sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return entries;
}

// ============================================================================
// CLAUDE → GEMINI CONVERTER
// ============================================================================

/**
 * Convert a Claude Code session to Gemini format
 */
export async function convertClaudeToGemini(
  claudeSession: ClaudeSession,
  options: ClaudeToGeminiOptions = {}
): Promise<GeminiConversionResult> {
  const {
    model = "gemini-2.5-pro",
    projectHash: customProjectHash,
    outputDir,
  } = options;

  const homeDir = process.env.HOME || Bun.env.HOME || "/tmp";
  const projectHash =
    customProjectHash || generateProjectHash(claudeSession.metadata.cwd);
  const finalOutputDir =
    outputDir || join(homeDir, ".gemini", "tmp", projectHash, "chats");

  const warnings: string[] = [];
  const errors: string[] = [];
  const geminiMessages: GeminiMessage[] = [];

  let toolCallsConverted = 0;
  let thoughtsGenerated = 0;

  const sessionId = crypto.randomUUID();
  const firstTimestamp = claudeSession.messages[0]?.timestamp || new Date().toISOString();
  let lastTimestamp = firstTimestamp;

  // Process messages in pairs (user → assistant)
  let i = 0;

  while (i < claudeSession.messages.length) {
    const msg = claudeSession.messages[i]!;

    if (msg.type === "user") {
      const userMsg = msg as ClaudeUserRecord;
      const userContent = Array.isArray(userMsg.message?.content)
        ? userMsg.message.content
        : [];

      // Extract text content (skip tool_result blocks for user messages)
      const textBlocks = userContent.filter(
        (b): b is ClaudeTextBlock => b.type === "text"
      );
      const userText = textBlocks.map((b) => b.text).join("\n");

      // Only create user message if there's actual text (not just tool results)
      if (userText.trim()) {
        geminiMessages.push({
          id: crypto.randomUUID(),
          timestamp: userMsg.timestamp,
          type: "user",
          content: userText,
        });
        lastTimestamp = userMsg.timestamp;
      }

      i++;
      continue;
    }

    if (msg.type === "assistant") {
      const assistantMsg = msg as ClaudeAssistantRecord;
      const assistantContent = Array.isArray(assistantMsg.message?.content)
        ? assistantMsg.message.content
        : [];

      // Build content string
      const contentParts: string[] = [];

      // Extract thinking blocks → Gemini thoughts
      const thinkingBlocks = assistantContent.filter(
        (b): b is ClaudeThinkingBlock => b.type === "thinking"
      );

      const thoughts: GeminiThought[] = thinkingBlocks.map((block, idx) => {
        thoughtsGenerated++;
        const thinkingText = block.thinking || "";
        // Create a subject from first line or first ~60 chars
        const firstLine = thinkingText.split("\n")[0] || "Reasoning";
        const subject =
          firstLine.length > 60
            ? firstLine.substring(0, 57) + "..."
            : firstLine;

        return {
          subject,
          description: thinkingText.substring(0, 500),
          timestamp: new Date(
            new Date(assistantMsg.timestamp).getTime() + idx * 1000
          ).toISOString(),
        };
      });

      // Extract text blocks
      const textBlocks = assistantContent.filter(
        (b): b is ClaudeTextBlock => b.type === "text"
      );
      if (textBlocks.length > 0) {
        contentParts.push(textBlocks.map((b) => b.text).join("\n"));
      }

      // Extract tool use blocks → embed as text
      const toolUseBlocks = assistantContent.filter(
        (b): b is ClaudeToolUseBlock => b.type === "tool_use"
      );

      for (const toolBlock of toolUseBlocks) {
        toolCallsConverted++;
        contentParts.push(
          mapClaudeToolToGeminiText(toolBlock.name, toolBlock.input)
        );
      }

      // Look ahead for tool results in subsequent user messages
      for (let j = i + 1; j < claudeSession.messages.length; j++) {
        const nextMsg = claudeSession.messages[j];
        if (nextMsg?.type === "user") {
          const nextContent = Array.isArray(
            (nextMsg as ClaudeUserRecord).message?.content
          )
            ? (nextMsg as ClaudeUserRecord).message.content
            : [];

          const toolResults = nextContent.filter(
            (b): b is ClaudeToolResultBlock => b.type === "tool_result"
          );

          if (toolResults.length > 0) {
            for (const result of toolResults) {
              const resultText =
                typeof result.content === "string"
                  ? result.content
                  : JSON.stringify(result.content);
              contentParts.push(
                `[Tool Result: ${result.tool_use_id}]\n${resultText.substring(0, 2000)}`
              );
            }
          }

          // If this user message ONLY had tool_results, skip it
          const hasText = nextContent.some((b) => b.type === "text");
          if (!hasText && toolResults.length > 0) {
            // Don't skip — the main loop will handle it
          }
          break;
        }
        if (nextMsg?.type === "assistant") break;
      }

      const content = contentParts.join("\n\n");

      // Build token counts from Claude usage
      const usage = assistantMsg.message?.usage;
      const inputTokens = usage?.input_tokens || 0;
      const outputTokens = usage?.output_tokens || 0;
      const thinkingTokenCount = thinkingBlocks.reduce(
        (acc, b) => acc + (b.thinking?.length || 0) / 4,
        0
      );
      const toolTokenCount = toolUseBlocks.length * 100; // Approximate

      const tokens: GeminiTokens = {
        input: inputTokens,
        output: outputTokens,
        cached: usage?.cache_read_input_tokens || 0,
        thoughts: Math.round(thinkingTokenCount),
        tool: toolTokenCount,
        total:
          inputTokens +
          outputTokens +
          Math.round(thinkingTokenCount) +
          toolTokenCount,
      };

      if (content.trim() || thoughts.length > 0) {
        geminiMessages.push({
          id: crypto.randomUUID(),
          timestamp: assistantMsg.timestamp,
          type: "gemini",
          content: content || "(no text content)",
          thoughts,
          tokens,
          model,
        });
        lastTimestamp = assistantMsg.timestamp;
      }

      i++;
      continue;
    }

    // Skip other record types
    i++;
  }

  // Build the Gemini session
  const geminiSession: GeminiSession = {
    sessionId,
    projectHash,
    startTime: firstTimestamp,
    lastUpdated: lastTimestamp,
    messages: geminiMessages,
  };

  // Create output directory and write file
  await mkdir(finalOutputDir, { recursive: true });

  const timestamp = new Date(firstTimestamp);
  const filename = generateGeminiFilename(timestamp, sessionId);
  const outputPath = join(finalOutputDir, filename);

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

/**
 * Convert a Claude session file to Gemini format
 */
export async function convertClaudeFileToGemini(
  claudeFilePath: string,
  options?: ClaudeToGeminiOptions
): Promise<GeminiConversionResult> {
  const { parseClaudeSession } = await import("./session-converter");
  const session = await parseClaudeSession(claudeFilePath);
  return convertClaudeToGemini(session, options);
}

/**
 * Detect if a file is in Gemini format
 */
export async function isGeminiFormat(filePath: string): Promise<boolean> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const data = JSON.parse(text);
    return (
      "sessionId" in data &&
      "projectHash" in data &&
      "messages" in data &&
      Array.isArray(data.messages)
    );
  } catch {
    return false;
  }
}
