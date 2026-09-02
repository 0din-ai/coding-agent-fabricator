import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { slugifyClaudeProjectPath } from "../src/session-routing";
import {
  parseClaudeSession,
  parseCodexSession,
  convertClaudeToCodex,
  convertCodexToClaude,
  validateClaudeSession,
  validateCodexSession,
  detectSessionFormat,
  listClaudeSessions,
  listCodexSessions,
  type ClaudeSession,
  type CodexSession,
  type ClaudeUserRecord,
  type ClaudeAssistantRecord,
} from "../src/session-converter";

const TEST_DIR = "/tmp/fabricator-session-converter-test";
const CLAUDE_TEST_DIR = join(TEST_DIR, "claude");
const CODEX_TEST_DIR = join(TEST_DIR, "codex");

// Sample Claude session data
const sampleClaudeSession: ClaudeSession = {
  sessionId: "test-session-123",
  projectPath: "/test/project",
  filePath: "",
  records: [],
  messages: [],
  fileSnapshots: [],
  metadata: {
    version: "2.0.76",
    cwd: "/test/project",
    gitBranch: "main",
    totalTokens: { input: 100, output: 50 },
  },
};

// Create sample Claude JSONL content
function createClaudeJsonl(sessionId: string): string {
  const userRecord: ClaudeUserRecord = {
    type: "user",
    sessionId,
    timestamp: new Date().toISOString(),
    uuid: "user-uuid-1",
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: "/test/project",
    version: "2.0.76",
    gitBranch: "main",
    message: {
      role: "user",
      content: [{ type: "text", text: "Hello, can you help me?" }],
    },
  };

  const assistantRecord: ClaudeAssistantRecord = {
    type: "assistant",
    sessionId,
    timestamp: new Date().toISOString(),
    uuid: "assistant-uuid-1",
    parentUuid: "user-uuid-1",
    isSidechain: false,
    userType: "external",
    cwd: "/test/project",
    version: "2.0.76",
    gitBranch: "main",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      id: "msg_123",
      type: "message",
      content: [
        { type: "thinking", thinking: "Let me think about this..." },
        { type: "text", text: "Of course! I'd be happy to help." },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };

  return [JSON.stringify(userRecord), JSON.stringify(assistantRecord)].join(
    "\n"
  );
}

// Create sample Codex JSONL content
function createCodexJsonl(sessionId: string): string {
  const timestamp = new Date().toISOString();

  const sessionMeta = {
    timestamp,
    type: "session_meta",
    payload: {
      id: sessionId,
      timestamp,
      cwd: "/test/project",
      originator: "codex_cli_rs",
      cli_version: "0.80.0",
      instructions: null,
      source: "cli",
      model_provider: "openai",
      git: { commit_hash: "abc123", branch: "main" },
    },
  };

  const turnContext = {
    timestamp,
    type: "turn_context",
    payload: {
      cwd: "/test/project",
      approval_policy: "never",
      sandbox_policy: { type: "danger-full-access" },
      model: "gpt-5.2-codex",
      effort: "high",
      summary: "auto",
      user_instructions: "",
      truncation_policy: { mode: "tokens", limit: 10000 },
    },
  };

  const userEvent = {
    timestamp,
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "Hello, can you help me?",
      images: [],
    },
  };

  const userResponse = {
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hello, can you help me?" }],
    },
  };

  const assistantResponse = {
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Of course! I'd be happy to help." }],
    },
  };

  const assistantEvent = {
    timestamp,
    type: "event_msg",
    payload: {
      type: "agent_message",
      message: "Of course! I'd be happy to help.",
    },
  };

  return [
    JSON.stringify(sessionMeta),
    JSON.stringify(turnContext),
    JSON.stringify(userEvent),
    JSON.stringify(userResponse),
    JSON.stringify(assistantResponse),
    JSON.stringify(assistantEvent),
  ].join("\n");
}

describe("Session Converter", () => {
  beforeAll(async () => {
    await mkdir(CLAUDE_TEST_DIR, { recursive: true });
    await mkdir(CODEX_TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Claude Parser", () => {
    test("parseClaudeSession parses valid JSONL", async () => {
      const sessionId = "claude-test-session";
      const filePath = join(CLAUDE_TEST_DIR, `${sessionId}.jsonl`);

      await Bun.write(filePath, createClaudeJsonl(sessionId));

      const session = await parseClaudeSession(filePath);

      expect(session.sessionId).toBe(sessionId);
      expect(session.messages.length).toBe(2);
      expect(session.messages[0]!.type).toBe("user");
      expect(session.messages[1]!.type).toBe("assistant");
    });

    test("parseClaudeSession extracts metadata", async () => {
      const sessionId = "claude-meta-test";
      const filePath = join(CLAUDE_TEST_DIR, `${sessionId}.jsonl`);

      await Bun.write(filePath, createClaudeJsonl(sessionId));

      const session = await parseClaudeSession(filePath);

      expect(session.metadata.version).toBe("2.0.76");
      expect(session.metadata.gitBranch).toBe("main");
      expect(session.metadata.totalTokens.input).toBe(100);
      expect(session.metadata.totalTokens.output).toBe(50);
    });

    test("parseClaudeSession handles empty file", async () => {
      const filePath = join(CLAUDE_TEST_DIR, "empty.jsonl");
      await Bun.write(filePath, "");

      const session = await parseClaudeSession(filePath);

      expect(session.messages.length).toBe(0);
      expect(session.sessionId).toBe("empty"); // Falls back to filename
    });
  });

  describe("Claude Session Listing", () => {
    test("uses the stored cwd instead of decoding the project directory slug", async () => {
      const originalHome = process.env.HOME;
      const testHome = join(TEST_DIR, "listing-home");
      const storedCwd = "/workspace/my_project/release.v1";
      const projectDir = join(
        testHome,
        ".claude",
        "projects",
        slugifyClaudeProjectPath(storedCwd)
      );
      const sessionId = "stored-cwd-session";
      const content = createClaudeJsonl(sessionId).replaceAll(
        "/test/project",
        storedCwd
      );

      await mkdir(projectDir, { recursive: true });
      await Bun.write(join(projectDir, `${sessionId}.jsonl`), content);
      process.env.HOME = testHome;

      try {
        const sessions = await listClaudeSessions("my_project/release.v1");
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.project).toBe(storedCwd);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
      }
    });
  });

  describe("Codex Parser", () => {
    test("parseCodexSession parses valid JSONL", async () => {
      const sessionId = "codex-test-session";
      const filePath = join(CODEX_TEST_DIR, `rollout-${sessionId}.jsonl`);

      await Bun.write(filePath, createCodexJsonl(sessionId));

      const session = await parseCodexSession(filePath);

      expect(session.id).toBe(sessionId);
      expect(session.turns.length).toBe(1);
      expect(session.turns[0]!.userMessage).toBe("Hello, can you help me?");
      expect(session.turns[0]!.assistantMessage).toBe(
        "Of course! I'd be happy to help."
      );
    });

    test("parseCodexSession extracts metadata", async () => {
      const sessionId = "codex-meta-test";
      const filePath = join(CODEX_TEST_DIR, `rollout-${sessionId}.jsonl`);

      await Bun.write(filePath, createCodexJsonl(sessionId));

      const session = await parseCodexSession(filePath);

      expect(session.metadata.cwd).toBe("/test/project");
      expect(session.metadata.cli_version).toBe("0.80.0");
      expect(session.metadata.git?.branch).toBe("main");
    });

    test("parseCodexSession counts record types", async () => {
      const sessionId = "codex-count-test";
      const filePath = join(CODEX_TEST_DIR, `rollout-${sessionId}.jsonl`);

      await Bun.write(filePath, createCodexJsonl(sessionId));

      const session = await parseCodexSession(filePath);

      expect(session.totalRecords.session_meta).toBe(1);
      expect(session.totalRecords.turn_context).toBe(1);
      expect(session.totalRecords.event_msg).toBe(2);
      expect(session.totalRecords.response_item).toBe(2);
    });
  });

  describe("Claude to Codex Conversion", () => {
    test("convertClaudeToCodex converts valid session", async () => {
      const sessionId = "convert-claude-test";
      const filePath = join(CLAUDE_TEST_DIR, `${sessionId}.jsonl`);

      await Bun.write(filePath, createClaudeJsonl(sessionId));

      const claudeSession = await parseClaudeSession(filePath);
      const result = await convertClaudeToCodex(claudeSession, {
        outputDir: CODEX_TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.statistics.messagesConverted).toBe(2);
      expect(result.outputPath).toContain(".jsonl");

      // Verify the output file exists and is valid
      const outputExists = await Bun.file(result.outputPath).exists();
      expect(outputExists).toBe(true);
    });

    test("convertClaudeToCodex preserves metadata", async () => {
      const sessionId = "convert-meta-test";
      const filePath = join(CLAUDE_TEST_DIR, `${sessionId}.jsonl`);

      await Bun.write(filePath, createClaudeJsonl(sessionId));

      const claudeSession = await parseClaudeSession(filePath);
      const result = await convertClaudeToCodex(claudeSession, {
        outputDir: CODEX_TEST_DIR,
        preserveMetadata: true,
      });

      expect(result.success).toBe(true);
      expect(result.statistics.metadataPreserved).toBe(true);
    });

    test("convertClaudeToCodex handles thinking blocks with warning", async () => {
      const sessionId = "convert-thinking-test";
      const filePath = join(CLAUDE_TEST_DIR, `${sessionId}.jsonl`);

      await Bun.write(filePath, createClaudeJsonl(sessionId));

      const claudeSession = await parseClaudeSession(filePath);
      const result = await convertClaudeToCodex(claudeSession, {
        outputDir: CODEX_TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((warning) =>
          warning.includes("Thinking content stored as summary")
        )
      ).toBe(true);
    });
  });

  describe("Codex to Claude Conversion", () => {
    test("convertCodexToClaude converts valid session", async () => {
      const sessionId = "convert-codex-test";
      const filePath = join(CODEX_TEST_DIR, `rollout-${sessionId}.jsonl`);

      await Bun.write(filePath, createCodexJsonl(sessionId));

      const codexSession = await parseCodexSession(filePath);
      const result = await convertCodexToClaude(codexSession, {
        outputDir: CLAUDE_TEST_DIR,
        projectPath: "/test/project",
      });

      expect(result.success).toBe(true);
      expect(result.statistics.messagesConverted).toBe(2);
      expect(result.outputPath).toContain(".jsonl");

      // Verify the output file exists
      const outputExists = await Bun.file(result.outputPath).exists();
      expect(outputExists).toBe(true);
    });

    test("convertCodexToClaude reconstructs threading", async () => {
      const sessionId = "convert-thread-test";
      const filePath = join(CODEX_TEST_DIR, `rollout-${sessionId}.jsonl`);

      await Bun.write(filePath, createCodexJsonl(sessionId));

      const codexSession = await parseCodexSession(filePath);
      const result = await convertCodexToClaude(codexSession, {
        outputDir: CLAUDE_TEST_DIR,
        reconstructThreading: true,
      });

      expect(result.success).toBe(true);

      // Verify threading in output
      const outputSession = await parseClaudeSession(result.outputPath);
      const userMsg = outputSession.messages[0]!;
      const assistantMsg = outputSession.messages[1]!;

      expect(userMsg.parentUuid).toBeNull();
      expect(assistantMsg.parentUuid).toBe(userMsg.uuid);
    });

    test("convertCodexToClaude generates UUIDs", async () => {
      const sessionId = "convert-uuid-test";
      const filePath = join(CODEX_TEST_DIR, `rollout-${sessionId}.jsonl`);

      await Bun.write(filePath, createCodexJsonl(sessionId));

      const codexSession = await parseCodexSession(filePath);
      const result = await convertCodexToClaude(codexSession, {
        outputDir: CLAUDE_TEST_DIR,
        generateUuids: true,
      });

      expect(result.success).toBe(true);

      // Verify UUIDs are generated
      const outputSession = await parseClaudeSession(result.outputPath);
      expect(outputSession.sessionId).not.toBe(sessionId);
      expect(outputSession.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  describe("Validation", () => {
    test("validateClaudeSession identifies missing sessionId", () => {
      const session: ClaudeSession = {
        ...sampleClaudeSession,
        sessionId: "",
      };

      const issues = validateClaudeSession(session);

      expect(issues).toContain("Missing sessionId");
    });

    test("validateClaudeSession identifies empty messages", () => {
      const session: ClaudeSession = {
        ...sampleClaudeSession,
        messages: [],
      };

      const issues = validateClaudeSession(session);

      expect(issues).toContain("No messages in session");
    });

    test("validateCodexSession identifies missing turns", () => {
      const session: CodexSession = {
        id: "test-session",
        filePath: "/test/path",
        metadata: {
          id: "test-session",
          timestamp: new Date().toISOString(),
          cwd: "/test",
          originator: "test",
          cli_version: "0.80.0",
          instructions: null,
          source: "test",
          model_provider: "openai",
        },
        records: [],
        turns: [],
        totalRecords: {
          session_meta: 1,
          response_item: 0,
          event_msg: 0,
          turn_context: 0,
        },
      };

      const issues = validateCodexSession(session);

      expect(issues).toContain("No conversation turns found");
    });
  });

  describe("Format Detection", () => {
    test("detectSessionFormat identifies Claude files", async () => {
      const sessionId = "detect-claude-test";
      const filePath = join(CLAUDE_TEST_DIR, `${sessionId}.jsonl`);

      await Bun.write(filePath, createClaudeJsonl(sessionId));

      const format = await detectSessionFormat(filePath);

      expect(format).toBe("claude");
    });

    test("detectSessionFormat identifies Codex files", async () => {
      const sessionId = "detect-codex-test";
      const filePath = join(CODEX_TEST_DIR, `rollout-${sessionId}.jsonl`);

      await Bun.write(filePath, createCodexJsonl(sessionId));

      const format = await detectSessionFormat(filePath);

      expect(format).toBe("codex");
    });

    test("detectSessionFormat returns unknown for invalid files", async () => {
      const filePath = join(TEST_DIR, "invalid.jsonl");
      await Bun.write(filePath, '{"random": "data"}');

      const format = await detectSessionFormat(filePath);

      expect(format).toBe("unknown");
    });

    test("detectSessionFormat handles non-existent files", async () => {
      const format = await detectSessionFormat("/non/existent/file.jsonl");

      expect(format).toBe("unknown");
    });
  });

  describe("Round-trip Conversion", () => {
    test("Claude -> Codex -> Claude preserves core content", async () => {
      const sessionId = "roundtrip-test";
      const filePath = join(CLAUDE_TEST_DIR, `${sessionId}.jsonl`);

      await Bun.write(filePath, createClaudeJsonl(sessionId));

      // Claude -> Codex
      const claudeSession = await parseClaudeSession(filePath);
      const codexResult = await convertClaudeToCodex(claudeSession, {
        outputDir: CODEX_TEST_DIR,
      });

      expect(codexResult.success).toBe(true);

      // Codex -> Claude
      const codexSession = await parseCodexSession(codexResult.outputPath);
      const claudeResult = await convertCodexToClaude(codexSession, {
        outputDir: CLAUDE_TEST_DIR,
      });

      expect(claudeResult.success).toBe(true);

      // Verify content preservation
      const finalSession = await parseClaudeSession(claudeResult.outputPath);

      expect(finalSession.messages.length).toBeGreaterThan(0);

      // Check that user message content is preserved
      const userMsg = finalSession.messages[0];
      expect(userMsg?.type).toBe("user");
      const content = (userMsg as ClaudeUserRecord).message.content;
      const userContent = Array.isArray(content)
        ? content.find((block) => block.type === "text")
        : undefined;
      expect(userContent?.text).toContain("Hello, can you help me?");
    });
  });
});
