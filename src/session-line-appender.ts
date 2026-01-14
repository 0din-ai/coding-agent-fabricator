/**
 * Session Line Appender - Add new lines to Claude Code sessions
 *
 * Enables quickly appending new conversation lines to existing sessions:
 * - User messages (text)
 * - Assistant text messages
 * - Assistant tool calls
 * - Tool results
 *
 * Maintains proper UUID threading and session structure.
 */

import { findJsonlFile, readJsonlFile, writeJsonlFile } from "./jsonl-processor";

// ============================================================================
// TYPES
// ============================================================================

export type LineType = "user" | "assistant-text" | "assistant-tool" | "tool-result";

export interface LineContent {
  /** Type of line to add */
  type: LineType;
  /** Text content (for user/assistant-text) */
  text?: string;
  /** Tool name (for assistant-tool) */
  toolName?: string;
  /** Tool input (for assistant-tool) */
  toolInput?: Record<string, unknown>;
  /** Tool use ID to reference (for tool-result) */
  toolUseId?: string;
  /** Tool result content (for tool-result) */
  toolResult?: string | Record<string, unknown>;
}

export interface AppendLineOptions {
  /** Session ID to modify */
  sessionId: string;
  /** Line content to add */
  content: LineContent;
  /** Optional: create a new session instead of modifying */
  createNew?: boolean;
  /** Optional: direct file path (bypasses findJsonlFile lookup) */
  filePath?: string;
}

export interface AppendMultipleLinesOptions {
  /** Session ID to modify */
  sessionId: string;
  /** Array of line contents to add */
  contents: LineContent[];
  /** Optional: create a new session instead of modifying */
  createNew?: boolean;
  /** Optional: direct file path (bypasses findJsonlFile lookup) */
  filePath?: string;
}

export interface AppendResult {
  success: boolean;
  sessionId: string;
  filePath: string;
  linesAdded: number;
  totalLines: number;
  lastLineUuid: string;
  errors: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a tool use ID
 */
function generateToolUseId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "toolu_";
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Get metadata from existing session lines
 */
function getSessionMetadata(lines: Record<string, unknown>[]): {
  version: string;
  cwd: string;
  gitBranch: string;
  sessionId: string;
} {
  const firstUserOrAssistant = lines.find(
    (line) => line.type === "user" || line.type === "assistant"
  );

  return {
    version: (firstUserOrAssistant?.version as string) || "2.0.76",
    cwd: (firstUserOrAssistant?.cwd as string) || process.cwd(),
    gitBranch: (firstUserOrAssistant?.gitBranch as string) || "",
    sessionId: (firstUserOrAssistant?.sessionId as string) || crypto.randomUUID(),
  };
}

/**
 * Get the last line's UUID for threading
 */
function getLastLineUuid(lines: Record<string, unknown>[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.uuid && (line.type === "user" || line.type === "assistant")) {
      return line.uuid as string;
    }
  }
  return null;
}

/**
 * Create a user message line
 */
function createUserLine(
  text: string,
  metadata: { version: string; cwd: string; gitBranch: string; sessionId: string },
  parentUuid: string | null
): Record<string, unknown> {
  return {
    type: "user",
    sessionId: metadata.sessionId,
    timestamp: new Date().toISOString(),
    uuid: crypto.randomUUID(),
    parentUuid,
    isSidechain: false,
    userType: "external",
    cwd: metadata.cwd,
    version: metadata.version,
    gitBranch: metadata.gitBranch,
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

/**
 * Create an assistant text message line
 */
function createAssistantTextLine(
  text: string,
  metadata: { version: string; cwd: string; gitBranch: string; sessionId: string },
  parentUuid: string | null
): Record<string, unknown> {
  return {
    type: "assistant",
    sessionId: metadata.sessionId,
    timestamp: new Date().toISOString(),
    uuid: crypto.randomUUID(),
    parentUuid,
    isSidechain: false,
    userType: "external",
    cwd: metadata.cwd,
    version: metadata.version,
    gitBranch: metadata.gitBranch,
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      id: `msg_${crypto.randomUUID().substring(0, 10)}`,
      type: "message",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  };
}

/**
 * Create an assistant tool call line
 */
function createAssistantToolLine(
  toolName: string,
  toolInput: Record<string, unknown>,
  metadata: { version: string; cwd: string; gitBranch: string; sessionId: string },
  parentUuid: string | null,
  toolUseId?: string
): Record<string, unknown> {
  const id = toolUseId || generateToolUseId();

  return {
    type: "assistant",
    sessionId: metadata.sessionId,
    timestamp: new Date().toISOString(),
    uuid: crypto.randomUUID(),
    parentUuid,
    isSidechain: false,
    userType: "external",
    cwd: metadata.cwd,
    version: metadata.version,
    gitBranch: metadata.gitBranch,
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      id: `msg_${crypto.randomUUID().substring(0, 10)}`,
      type: "message",
      content: [
        {
          type: "tool_use",
          id,
          name: toolName,
          input: toolInput,
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
    _toolUseId: id, // Store for reference
  };
}

/**
 * Create a tool result line (user message with tool_result)
 */
function createToolResultLine(
  toolUseId: string,
  content: string | Record<string, unknown>,
  metadata: { version: string; cwd: string; gitBranch: string; sessionId: string },
  parentUuid: string | null
): Record<string, unknown> {
  return {
    type: "user",
    sessionId: metadata.sessionId,
    timestamp: new Date().toISOString(),
    uuid: crypto.randomUUID(),
    parentUuid,
    isSidechain: false,
    userType: "internal",
    cwd: metadata.cwd,
    version: metadata.version,
    gitBranch: metadata.gitBranch,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: typeof content === "string" ? content : JSON.stringify(content),
        },
      ],
    },
  };
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Append a single line to a session
 */
export async function appendLine(options: AppendLineOptions): Promise<AppendResult> {
  const { sessionId, content, createNew = false, filePath: inputFilePath } = options;
  const errors: string[] = [];

  // Find the session file (use provided path or search)
  const filePath = inputFilePath || await findJsonlFile(sessionId);
  if (!filePath) {
    return {
      success: false,
      sessionId,
      filePath: "",
      linesAdded: 0,
      totalLines: 0,
      lastLineUuid: "",
      errors: [`Session file not found for: ${sessionId}`],
    };
  }

  // Read existing lines
  let lines = (await readJsonlFile(filePath)) as Record<string, unknown>[];
  const metadata = getSessionMetadata(lines);

  // Handle creating new session
  let outputPath = filePath;
  if (createNew) {
    const newSessionId = crypto.randomUUID();
    metadata.sessionId = newSessionId;
    outputPath = filePath.replace(sessionId, newSessionId);

    // Replace session ID in all existing lines
    lines = lines.map((line) => ({
      ...JSON.parse(JSON.stringify(line).replaceAll(sessionId, newSessionId)),
    }));
  }

  // Get parent UUID for threading
  let parentUuid = getLastLineUuid(lines);

  // Create the new line
  let newLine: Record<string, unknown> | null = null;

  switch (content.type) {
    case "user":
      if (!content.text) {
        errors.push("User message requires text");
        break;
      }
      newLine = createUserLine(content.text, metadata, parentUuid);
      break;

    case "assistant-text":
      if (!content.text) {
        errors.push("Assistant text message requires text");
        break;
      }
      newLine = createAssistantTextLine(content.text, metadata, parentUuid);
      break;

    case "assistant-tool":
      if (!content.toolName) {
        errors.push("Tool call requires toolName");
        break;
      }
      newLine = createAssistantToolLine(
        content.toolName,
        content.toolInput || {},
        metadata,
        parentUuid
      );
      break;

    case "tool-result":
      if (!content.toolUseId) {
        errors.push("Tool result requires toolUseId");
        break;
      }
      newLine = createToolResultLine(
        content.toolUseId,
        content.toolResult || "",
        metadata,
        parentUuid
      );
      break;

    default:
      errors.push(`Unknown line type: ${content.type}`);
  }

  if (errors.length > 0 || !newLine) {
    return {
      success: false,
      sessionId: createNew ? metadata.sessionId : sessionId,
      filePath: outputPath,
      linesAdded: 0,
      totalLines: lines.length,
      lastLineUuid: parentUuid || "",
      errors,
    };
  }

  // Add the new line
  lines.push(newLine);

  // Write back
  await writeJsonlFile(outputPath, lines);

  return {
    success: true,
    sessionId: createNew ? metadata.sessionId : sessionId,
    filePath: outputPath,
    linesAdded: 1,
    totalLines: lines.length,
    lastLineUuid: newLine.uuid as string,
    errors: [],
  };
}

/**
 * Append multiple lines to a session
 */
export async function appendMultipleLines(
  options: AppendMultipleLinesOptions
): Promise<AppendResult> {
  const { sessionId, contents, createNew = false, filePath: inputFilePath } = options;
  const errors: string[] = [];

  if (contents.length === 0) {
    return {
      success: false,
      sessionId,
      filePath: "",
      linesAdded: 0,
      totalLines: 0,
      lastLineUuid: "",
      errors: ["No content provided"],
    };
  }

  // Find the session file (use provided path or search)
  const filePath = inputFilePath || await findJsonlFile(sessionId);
  if (!filePath) {
    return {
      success: false,
      sessionId,
      filePath: "",
      linesAdded: 0,
      totalLines: 0,
      lastLineUuid: "",
      errors: [`Session file not found for: ${sessionId}`],
    };
  }

  // Read existing lines
  let lines = (await readJsonlFile(filePath)) as Record<string, unknown>[];
  const metadata = getSessionMetadata(lines);

  // Handle creating new session
  let outputPath = filePath;
  if (createNew) {
    const newSessionId = crypto.randomUUID();
    metadata.sessionId = newSessionId;
    outputPath = filePath.replace(sessionId, newSessionId);

    lines = lines.map((line) => ({
      ...JSON.parse(JSON.stringify(line).replaceAll(sessionId, newSessionId)),
    }));
  }

  // Track tool use IDs for linking tool calls to results
  const toolUseIdMap = new Map<number, string>();
  let parentUuid = getLastLineUuid(lines);
  let linesAdded = 0;
  let lastLineUuid = parentUuid || "";

  // Process each content item
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i]!;
    let newLine: Record<string, unknown> | null = null;

    switch (content.type) {
      case "user":
        if (!content.text) {
          errors.push(`Content ${i}: User message requires text`);
          continue;
        }
        newLine = createUserLine(content.text, metadata, parentUuid);
        break;

      case "assistant-text":
        if (!content.text) {
          errors.push(`Content ${i}: Assistant text message requires text`);
          continue;
        }
        newLine = createAssistantTextLine(content.text, metadata, parentUuid);
        break;

      case "assistant-tool":
        if (!content.toolName) {
          errors.push(`Content ${i}: Tool call requires toolName`);
          continue;
        }
        newLine = createAssistantToolLine(
          content.toolName,
          content.toolInput || {},
          metadata,
          parentUuid
        );
        // Store the tool use ID for potential tool result
        toolUseIdMap.set(i, (newLine as any)._toolUseId);
        break;

      case "tool-result": {
        // Try to find the tool use ID
        let toolUseId = content.toolUseId;

        // If no explicit ID, try to find from previous tool call
        if (!toolUseId) {
          // Look for the most recent tool call
          for (let j = i - 1; j >= 0; j--) {
            const prevToolId = toolUseIdMap.get(j);
            if (prevToolId) {
              toolUseId = prevToolId;
              break;
            }
          }
        }

        if (!toolUseId) {
          errors.push(`Content ${i}: Tool result requires toolUseId or previous tool call`);
          continue;
        }

        newLine = createToolResultLine(
          toolUseId,
          content.toolResult || "",
          metadata,
          parentUuid
        );
        break;
      }

      default:
        errors.push(`Content ${i}: Unknown line type: ${content.type}`);
        continue;
    }

    if (newLine) {
      // Clean up internal tracking field
      if (newLine._toolUseId) {
        delete newLine._toolUseId;
      }

      lines.push(newLine);
      parentUuid = newLine.uuid as string;
      lastLineUuid = parentUuid;
      linesAdded++;
    }
  }

  // Write back
  await writeJsonlFile(outputPath, lines);

  return {
    success: errors.length === 0,
    sessionId: createNew ? metadata.sessionId : sessionId,
    filePath: outputPath,
    linesAdded,
    totalLines: lines.length,
    lastLineUuid,
    errors,
  };
}

/** Options for convenience functions */
export interface ConvenienceOptions {
  createNew?: boolean;
  filePath?: string;
}

/**
 * Convenience function: Add a user message
 */
export async function addUserMessage(
  sessionId: string,
  text: string,
  options: ConvenienceOptions = {}
): Promise<AppendResult> {
  return appendLine({
    sessionId,
    content: { type: "user", text },
    createNew: options.createNew,
    filePath: options.filePath,
  });
}

/**
 * Convenience function: Add an assistant text message
 */
export async function addAssistantMessage(
  sessionId: string,
  text: string,
  options: ConvenienceOptions = {}
): Promise<AppendResult> {
  return appendLine({
    sessionId,
    content: { type: "assistant-text", text },
    createNew: options.createNew,
    filePath: options.filePath,
  });
}

/**
 * Convenience function: Add a tool call
 */
export async function addToolCall(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  options: ConvenienceOptions = {}
): Promise<AppendResult> {
  return appendLine({
    sessionId,
    content: { type: "assistant-tool", toolName, toolInput },
    createNew: options.createNew,
    filePath: options.filePath,
  });
}

/**
 * Convenience function: Add a tool result
 */
export async function addToolResult(
  sessionId: string,
  toolUseId: string,
  result: string | Record<string, unknown>,
  options: ConvenienceOptions = {}
): Promise<AppendResult> {
  return appendLine({
    sessionId,
    content: { type: "tool-result", toolUseId, toolResult: result },
    createNew: options.createNew,
    filePath: options.filePath,
  });
}

/**
 * Convenience function: Add a complete tool interaction (call + result)
 */
export async function addToolInteraction(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  result: string | Record<string, unknown>,
  options: ConvenienceOptions = {}
): Promise<AppendResult> {
  return appendMultipleLines({
    sessionId,
    contents: [
      { type: "assistant-tool", toolName, toolInput },
      { type: "tool-result", toolResult: result },
    ],
    createNew: options.createNew,
    filePath: options.filePath,
  });
}

/**
 * Convenience function: Add a full exchange (user question + assistant response)
 */
export async function addExchange(
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
  options: ConvenienceOptions = {}
): Promise<AppendResult> {
  return appendMultipleLines({
    sessionId,
    contents: [
      { type: "user", text: userMessage },
      { type: "assistant-text", text: assistantResponse },
    ],
    createNew: options.createNew,
    filePath: options.filePath,
  });
}

/**
 * Parse a simple DSL for line content
 *
 * Format:
 *   user: "message text"
 *   assistant: "response text"
 *   tool: ToolName {"input": "value"}
 *   result: "output text"
 */
export function parseDSL(dsl: string): LineContent[] {
  const contents: LineContent[] = [];
  const lines = dsl.trim().split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // User message: user: "text"
    const userMatch = trimmed.match(/^user:\s*"(.+)"$/);
    if (userMatch) {
      contents.push({ type: "user", text: userMatch[1] });
      continue;
    }

    // Assistant text: assistant: "text"
    const assistantMatch = trimmed.match(/^assistant:\s*"(.+)"$/);
    if (assistantMatch) {
      contents.push({ type: "assistant-text", text: assistantMatch[1] });
      continue;
    }

    // Tool call: tool: ToolName {"input": "value"}
    const toolMatch = trimmed.match(/^tool:\s*(\w+)\s*({.+})?$/);
    if (toolMatch) {
      const toolName = toolMatch[1]!;
      let toolInput: Record<string, unknown> = {};
      if (toolMatch[2]) {
        try {
          toolInput = JSON.parse(toolMatch[2]);
        } catch {
          // Invalid JSON, use empty input
        }
      }
      contents.push({ type: "assistant-tool", toolName, toolInput });
      continue;
    }

    // Tool result: result: "text" or result: {"key": "value"}
    const resultMatch = trimmed.match(/^result:\s*(.+)$/);
    if (resultMatch) {
      let result: string | Record<string, unknown> = resultMatch[1]!;
      // Try to parse as JSON
      if (result.startsWith("{") || result.startsWith("[")) {
        try {
          result = JSON.parse(result);
        } catch {
          // Keep as string
        }
      } else if (result.startsWith('"') && result.endsWith('"')) {
        // Remove quotes
        result = result.slice(1, -1);
      }
      contents.push({ type: "tool-result", toolResult: result });
      continue;
    }
  }

  return contents;
}

/**
 * Add lines from a DSL string
 */
export async function addFromDSL(
  sessionId: string,
  dsl: string,
  options: ConvenienceOptions = {}
): Promise<AppendResult> {
  const contents = parseDSL(dsl);

  if (contents.length === 0) {
    return {
      success: false,
      sessionId,
      filePath: "",
      linesAdded: 0,
      totalLines: 0,
      lastLineUuid: "",
      errors: ["No valid content parsed from DSL"],
    };
  }

  return appendMultipleLines({
    sessionId,
    contents,
    createNew: options.createNew,
    filePath: options.filePath,
  });
}
