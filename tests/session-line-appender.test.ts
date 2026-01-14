import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import {
  appendLine,
  appendMultipleLines,
  addUserMessage,
  addAssistantMessage,
  addToolCall,
  addToolResult,
  addToolInteraction,
  addExchange,
  parseDSL,
  addFromDSL,
  type LineContent,
} from "../src/session-line-appender";

// Test directory setup
const TEST_DIR = "/tmp/fabricator-line-appender-tests";
const SESSION_DIR = join(TEST_DIR, "sessions");

// Sample session data
const sampleSession = {
  sessionId: "test-session-123",
  lines: [
    {
      type: "user",
      sessionId: "test-session-123",
      timestamp: "2025-01-13T10:00:00.000Z",
      uuid: "user-uuid-001",
      parentUuid: null,
      isSidechain: false,
      userType: "external",
      cwd: "/test/project",
      version: "2.0.76",
      gitBranch: "main",
      message: {
        role: "user",
        content: [{ type: "text", text: "Hello, Claude!" }],
      },
    },
    {
      type: "assistant",
      sessionId: "test-session-123",
      timestamp: "2025-01-13T10:00:01.000Z",
      uuid: "assistant-uuid-001",
      parentUuid: "user-uuid-001",
      isSidechain: false,
      userType: "external",
      cwd: "/test/project",
      version: "2.0.76",
      gitBranch: "main",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        id: "msg_test001",
        type: "message",
        content: [{ type: "text", text: "Hello! How can I help you?" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    },
  ],
};

async function createTestSession(): Promise<string> {
  await mkdir(SESSION_DIR, { recursive: true });
  const filePath = join(SESSION_DIR, `${sampleSession.sessionId}.jsonl`);
  const content = sampleSession.lines.map((line) => JSON.stringify(line)).join("\n");
  await writeFile(filePath, content);
  return filePath;
}

async function readTestSession(filePath: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(filePath, "utf-8");
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("Session Line Appender", () => {
  beforeEach(async () => {
    await mkdir(SESSION_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("parseDSL", () => {
    test("parses user message", () => {
      const result = parseDSL('user: "Hello, world!"');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "user", text: "Hello, world!" });
    });

    test("parses assistant message", () => {
      const result = parseDSL('assistant: "I can help with that."');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "assistant-text", text: "I can help with that." });
    });

    test("parses tool call without input", () => {
      const result = parseDSL("tool: Read");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "assistant-tool", toolName: "Read", toolInput: {} });
    });

    test("parses tool call with input", () => {
      const result = parseDSL('tool: Read {"file_path": "/tmp/test.txt"}');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: "assistant-tool",
        toolName: "Read",
        toolInput: { file_path: "/tmp/test.txt" },
      });
    });

    test("parses tool result string", () => {
      const result = parseDSL('result: "File contents here"');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "tool-result", toolResult: "File contents here" });
    });

    test("parses tool result JSON", () => {
      const result = parseDSL('result: {"status": "success"}');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "tool-result", toolResult: { status: "success" } });
    });

    test("parses multiple lines", () => {
      const dsl = `
        user: "What is 2+2?"
        assistant: "The answer is 4."
        tool: Calculator {"operation": "add", "a": 2, "b": 2}
        result: "4"
      `;
      const result = parseDSL(dsl);
      expect(result).toHaveLength(4);
      expect(result[0]!.type).toBe("user");
      expect(result[1]!.type).toBe("assistant-text");
      expect(result[2]!.type).toBe("assistant-tool");
      expect(result[3]!.type).toBe("tool-result");
    });

    test("skips empty lines", () => {
      const dsl = `
        user: "Hello"

        assistant: "Hi"
      `;
      const result = parseDSL(dsl);
      expect(result).toHaveLength(2);
    });

    test("handles invalid JSON gracefully", () => {
      const result = parseDSL("tool: Broken {invalid json}");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "assistant-tool", toolName: "Broken", toolInput: {} });
    });
  });

  describe("appendLine", () => {
    test("appends user message to session", async () => {
      const filePath = await createTestSession();
      const result = await appendLine({
        sessionId: sampleSession.sessionId,
        content: { type: "user", text: "New user message" },
        filePath,
      });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(1);
      expect(result.totalLines).toBe(3);

      const lines = await readTestSession(filePath);
      expect(lines).toHaveLength(3);
      const newLine = lines[2] as any;
      expect(newLine.type).toBe("user");
      expect(newLine.message.content[0].text).toBe("New user message");
      expect(newLine.parentUuid).toBe("assistant-uuid-001");
    });

    test("appends assistant text message to session", async () => {
      const filePath = await createTestSession();
      const result = await appendLine({
        sessionId: sampleSession.sessionId,
        content: { type: "assistant-text", text: "New assistant response" },
        filePath,
      });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(1);

      const lines = await readTestSession(filePath);
      const newLine = lines[2] as any;
      expect(newLine.type).toBe("assistant");
      expect(newLine.message.content[0].text).toBe("New assistant response");
      expect(newLine.message.content[0].type).toBe("text");
    });

    test("appends assistant tool call to session", async () => {
      const filePath = await createTestSession();
      const result = await appendLine({
        sessionId: sampleSession.sessionId,
        content: {
          type: "assistant-tool",
          toolName: "Read",
          toolInput: { file_path: "/test/file.txt" },
        },
        filePath,
      });

      expect(result.success).toBe(true);

      const lines = await readTestSession(filePath);
      const newLine = lines[2] as any;
      expect(newLine.type).toBe("assistant");
      expect(newLine.message.content[0].type).toBe("tool_use");
      expect(newLine.message.content[0].name).toBe("Read");
      expect(newLine.message.content[0].input).toEqual({ file_path: "/test/file.txt" });
      expect(newLine.message.stop_reason).toBe("tool_use");
    });

    test("appends tool result to session", async () => {
      const filePath = await createTestSession();
      const result = await appendLine({
        sessionId: sampleSession.sessionId,
        content: {
          type: "tool-result",
          toolUseId: "toolu_test123",
          toolResult: "File contents here",
        },
        filePath,
      });

      expect(result.success).toBe(true);

      const lines = await readTestSession(filePath);
      const newLine = lines[2] as any;
      expect(newLine.type).toBe("user");
      expect(newLine.userType).toBe("internal");
      expect(newLine.message.content[0].type).toBe("tool_result");
      expect(newLine.message.content[0].tool_use_id).toBe("toolu_test123");
      expect(newLine.message.content[0].content).toBe("File contents here");
    });

    test("returns error when session not found", async () => {
      const result = await appendLine({
        sessionId: "non-existent-session",
        content: { type: "user", text: "Test" },
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Session file not found for: non-existent-session");
    });

    test("returns error when user message missing text", async () => {
      const filePath = await createTestSession();
      const result = await appendLine({
        sessionId: sampleSession.sessionId,
        content: { type: "user" },
        filePath,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("User message requires text");
    });

    test("returns error when tool call missing toolName", async () => {
      const filePath = await createTestSession();
      const result = await appendLine({
        sessionId: sampleSession.sessionId,
        content: { type: "assistant-tool" },
        filePath,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Tool call requires toolName");
    });

    test("returns error when tool result missing toolUseId", async () => {
      const filePath = await createTestSession();
      const result = await appendLine({
        sessionId: sampleSession.sessionId,
        content: { type: "tool-result", toolResult: "test" },
        filePath,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Tool result requires toolUseId");
    });
  });

  describe("appendMultipleLines", () => {
    test("appends multiple lines with proper threading", async () => {
      const filePath = await createTestSession();
      const result = await appendMultipleLines({
        sessionId: sampleSession.sessionId,
        contents: [
          { type: "user", text: "First message" },
          { type: "assistant-text", text: "First response" },
          { type: "user", text: "Second message" },
        ],
        filePath,
      });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(3);
      expect(result.totalLines).toBe(5);

      const lines = await readTestSession(filePath);
      expect(lines).toHaveLength(5);

      // Check threading
      const line3 = lines[2] as any;
      const line4 = lines[3] as any;
      const line5 = lines[4] as any;

      expect(line3.parentUuid).toBe("assistant-uuid-001");
      expect(line4.parentUuid).toBe(line3.uuid);
      expect(line5.parentUuid).toBe(line4.uuid);
    });

    test("links tool results to preceding tool calls", async () => {
      const filePath = await createTestSession();
      const result = await appendMultipleLines({
        sessionId: sampleSession.sessionId,
        contents: [
          { type: "assistant-tool", toolName: "Read", toolInput: { path: "/test" } },
          { type: "tool-result", toolResult: "File contents" },
        ],
        filePath,
      });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(2);

      const lines = await readTestSession(filePath);
      const toolCall = lines[2] as any;
      const toolResult = lines[3] as any;

      // The tool result should reference the tool call's ID
      const toolUseId = toolCall.message.content[0].id;
      expect(toolResult.message.content[0].tool_use_id).toBe(toolUseId);
    });

    test("returns error when no content provided", async () => {
      const filePath = await createTestSession();
      const result = await appendMultipleLines({
        sessionId: sampleSession.sessionId,
        contents: [],
        filePath,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("No content provided");
    });
  });

  describe("Convenience functions", () => {
    test("addUserMessage adds user message", async () => {
      const filePath = await createTestSession();
      const result = await addUserMessage(sampleSession.sessionId, "Hello from convenience!", { filePath });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(1);
    });

    test("addAssistantMessage adds assistant text", async () => {
      const filePath = await createTestSession();
      const result = await addAssistantMessage(sampleSession.sessionId, "Response from convenience!", { filePath });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(1);
    });

    test("addToolCall adds tool call", async () => {
      const filePath = await createTestSession();
      const result = await addToolCall(sampleSession.sessionId, "Bash", { command: "ls" }, { filePath });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(1);
    });

    test("addToolResult adds tool result", async () => {
      const filePath = await createTestSession();
      const result = await addToolResult(
        sampleSession.sessionId,
        "toolu_convenience",
        "Result content",
        { filePath }
      );

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(1);
    });

    test("addToolInteraction adds tool call and result", async () => {
      const filePath = await createTestSession();
      const result = await addToolInteraction(
        sampleSession.sessionId,
        "Read",
        { file_path: "/test.txt" },
        "File contents here",
        { filePath }
      );

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(2);

      const lines = await readTestSession(filePath);
      expect(lines).toHaveLength(4);
    });

    test("addExchange adds user and assistant messages", async () => {
      const filePath = await createTestSession();
      const result = await addExchange(
        sampleSession.sessionId,
        "What is TypeScript?",
        "TypeScript is a typed superset of JavaScript.",
        { filePath }
      );

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(2);

      const lines = await readTestSession(filePath);
      expect(lines).toHaveLength(4);
      expect((lines[2] as any).message.content[0].text).toBe("What is TypeScript?");
      expect((lines[3] as any).message.content[0].text).toBe(
        "TypeScript is a typed superset of JavaScript."
      );
    });
  });

  describe("addFromDSL", () => {
    test("adds lines from DSL string", async () => {
      const filePath = await createTestSession();
      const dsl = `
        user: "How do I read a file?"
        assistant: "You can use the Read tool."
        tool: Read {"file_path": "/example.txt"}
        result: "Example file contents"
      `;

      const result = await addFromDSL(sampleSession.sessionId, dsl, { filePath });

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(4);

      const lines = await readTestSession(filePath);
      expect(lines).toHaveLength(6);
    });

    test("returns error for empty DSL", async () => {
      const filePath = await createTestSession();
      const result = await addFromDSL(sampleSession.sessionId, "", { filePath });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("No valid content parsed from DSL");
    });

    test("returns error for invalid DSL", async () => {
      const filePath = await createTestSession();
      const result = await addFromDSL(sampleSession.sessionId, "random text here", { filePath });

      expect(result.success).toBe(false);
      expect(result.errors).toContain("No valid content parsed from DSL");
    });
  });

  describe("Line content validation", () => {
    test("generated lines have required fields", async () => {
      const filePath = await createTestSession();
      await addUserMessage(sampleSession.sessionId, "Test message", { filePath });

      const lines = await readTestSession(filePath);
      const newLine = lines[2] as any;

      // Check required fields
      expect(newLine.type).toBe("user");
      expect(newLine.sessionId).toBe(sampleSession.sessionId);
      expect(newLine.timestamp).toBeDefined();
      expect(newLine.uuid).toBeDefined();
      expect(newLine.parentUuid).toBe("assistant-uuid-001");
      expect(newLine.isSidechain).toBe(false);
      expect(newLine.userType).toBe("external");
      expect(newLine.cwd).toBeDefined();
      expect(newLine.version).toBeDefined();
      expect(newLine.message).toBeDefined();
      expect(newLine.message.role).toBe("user");
      expect(newLine.message.content).toBeInstanceOf(Array);
    });

    test("assistant lines have correct message structure", async () => {
      const filePath = await createTestSession();
      await addAssistantMessage(sampleSession.sessionId, "Test response", { filePath });

      const lines = await readTestSession(filePath);
      const newLine = lines[2] as any;

      expect(newLine.message.role).toBe("assistant");
      expect(newLine.message.model).toBeDefined();
      expect(newLine.message.id).toBeDefined();
      expect(newLine.message.type).toBe("message");
      expect(newLine.message.stop_reason).toBe("end_turn");
      expect(newLine.message.usage).toBeDefined();
    });

    test("tool call lines have tool_use content type", async () => {
      const filePath = await createTestSession();
      await addToolCall(sampleSession.sessionId, "Grep", { pattern: "test" }, { filePath });

      const lines = await readTestSession(filePath);
      const newLine = lines[2] as any;

      const toolUse = newLine.message.content[0];
      expect(toolUse.type).toBe("tool_use");
      expect(toolUse.id).toMatch(/^toolu_/);
      expect(toolUse.name).toBe("Grep");
      expect(toolUse.input).toEqual({ pattern: "test" });
      expect(newLine.message.stop_reason).toBe("tool_use");
    });

    test("tool result lines have tool_result content type", async () => {
      const filePath = await createTestSession();
      await addToolResult(sampleSession.sessionId, "toolu_xyz123", { matches: 5 }, { filePath });

      const lines = await readTestSession(filePath);
      const newLine = lines[2] as any;

      expect(newLine.userType).toBe("internal");
      const toolResult = newLine.message.content[0];
      expect(toolResult.type).toBe("tool_result");
      expect(toolResult.tool_use_id).toBe("toolu_xyz123");
      expect(toolResult.content).toBe('{"matches":5}');
    });
  });
});
