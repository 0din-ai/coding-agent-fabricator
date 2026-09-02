import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  convertClaudeToGemini,
  convertCodexToGemini,
  convertGeminiToClaude,
  convertGeminiToCodex,
  parseGeminiSession,
  type GeminiSession,
} from "../src/gemini-converter";
import {
  detectSessionFormat,
  parseClaudeSession,
  parseCodexSession,
  type ClaudeAssistantRecord,
  type ClaudeSession,
  type ClaudeUserRecord,
} from "../src/session-converter";
import { generateGeminiProjectHash, slugifyClaudeProjectPath } from "../src/session-routing";

const TEST_DIR = "/tmp/fabricator-gemini-converter-test";
const GEMINI_PROJECT_KEY = "fabricator-gemini-routing-test";
const GEMINI_OUTPUT_DIR = join(TEST_DIR, "gemini", GEMINI_PROJECT_KEY, "chats");
const CLAUDE_OUTPUT_ROOT = join(TEST_DIR, "claude-root");
const CODEX_OUTPUT_ROOT = join(TEST_DIR, "codex-root");
const TARGET_CWD = "/workspace/example-project";
const HOME_DIR = process.env.HOME || Bun.env.HOME || "/tmp";
const HISTORY_DIR = join(HOME_DIR, ".gemini", "history", GEMINI_PROJECT_KEY);

function createClaudeSession(): ClaudeSession {
  const sessionId = crypto.randomUUID();
  const userUuid = crypto.randomUUID();
  const assistantUuid = crypto.randomUUID();
  const toolResultUuid = crypto.randomUUID();
  const assistantFollowupUuid = crypto.randomUUID();
  const timestamp = new Date("2026-03-07T12:00:00.000Z").toISOString();

  const userRecord: ClaudeUserRecord = {
    type: "user",
    sessionId,
    timestamp,
    uuid: userUuid,
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: "/original/source",
    version: "2.0.76",
    gitBranch: "main",
    message: {
      role: "user",
      content: [{ type: "text", text: "Inspect the README and summarize the tests." }],
    },
  };

  const assistantRecord: ClaudeAssistantRecord = {
    type: "assistant",
    sessionId,
    timestamp: new Date("2026-03-07T12:00:05.000Z").toISOString(),
    uuid: assistantUuid,
    parentUuid: userUuid,
    isSidechain: false,
    userType: "external",
    cwd: "/original/source",
    version: "2.0.76",
    gitBranch: "main",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      id: "msg_1",
      type: "message",
      content: [
        { type: "thinking", thinking: "I should inspect the repo and find the test files." },
        {
          type: "tool_use",
          id: "toolu_read_readme",
          name: "Read",
          input: { file_path: "README.md" },
        },
        { type: "text", text: "I will inspect the README first." },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };

  const toolResultRecord: ClaudeUserRecord = {
    type: "user",
    sessionId,
    timestamp: new Date("2026-03-07T12:00:06.000Z").toISOString(),
    uuid: toolResultUuid,
    parentUuid: assistantUuid,
    isSidechain: false,
    userType: "internal",
    cwd: "/original/source",
    version: "2.0.76",
    gitBranch: "main",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_read_readme",
          content: "README contents",
        },
      ],
    },
  };

  const assistantFollowup: ClaudeAssistantRecord = {
    type: "assistant",
    sessionId,
    timestamp: new Date("2026-03-07T12:00:07.000Z").toISOString(),
    uuid: assistantFollowupUuid,
    parentUuid: toolResultUuid,
    isSidechain: false,
    userType: "external",
    cwd: "/original/source",
    version: "2.0.76",
    gitBranch: "main",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      id: "msg_2",
      type: "message",
      content: [{ type: "text", text: "The README documents Bun commands and session conversion." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 25 },
    },
  };

  return {
    sessionId,
    projectPath: "/original/source",
    filePath: "",
    records: [userRecord, assistantRecord, toolResultRecord, assistantFollowup],
    messages: [userRecord, assistantRecord, toolResultRecord, assistantFollowup],
    summary: undefined,
    fileSnapshots: [],
    metadata: {
      version: "2.0.76",
      cwd: "/original/source",
      gitBranch: "main",
      totalTokens: {
        input: 140,
        output: 75,
      },
    },
  };
}

function createGeminiSession(): GeminiSession {
  return {
    sessionId: crypto.randomUUID(),
    projectHash: generateGeminiProjectHash("/original/gemini"),
    startTime: "2026-03-07T13:00:00.000Z",
    lastUpdated: "2026-03-07T13:00:10.000Z",
    messages: [
      {
        id: crypto.randomUUID(),
        timestamp: "2026-03-07T13:00:00.000Z",
        type: "user",
        content: "Review the README and tell me what the test command is.",
      },
      {
        id: crypto.randomUUID(),
        timestamp: "2026-03-07T13:00:03.000Z",
        type: "gemini",
        content: "I will inspect the README first.",
        thoughts: [
          {
            subject: "Inspecting repository docs",
            description: "I need to read the README and extract the Bun test command.",
            timestamp: "2026-03-07T13:00:02.000Z",
          },
        ],
        tokens: {
          input: 120,
          output: 40,
          cached: 0,
          thoughts: 10,
          tool: 100,
          total: 270,
        },
        model: "gemini-3-pro-preview",
        toolCalls: [
          {
            id: "read_file_1",
            name: "read_file",
            args: { file_path: "README.md" },
            status: "success",
            timestamp: "2026-03-07T13:00:03.000Z",
            resultDisplay: "README.md says bun test runs the suite.",
            result: [
              {
                functionResponse: {
                  id: "read_file_1",
                  name: "read_file",
                  response: {
                    output: "README.md says bun test runs the suite.",
                  },
                },
              },
            ],
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        timestamp: "2026-03-07T13:00:04.000Z",
        type: "user",
        content: "[Function Response: read_file]README.md says bun test runs the suite.",
      },
      {
        id: crypto.randomUUID(),
        timestamp: "2026-03-07T13:00:05.000Z",
        type: "gemini",
        content: "The test command is bun test.",
        thoughts: [],
        tokens: {
          input: 20,
          output: 10,
          cached: 0,
          thoughts: 0,
          tool: 0,
          total: 30,
        },
        model: "gemini-3-pro-preview",
      },
    ],
  };
}

function createCodexJsonl(sessionId: string): string {
  const timestamp = "2026-03-07T14:00:00.000Z";

  return [
    {
      timestamp,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp,
        cwd: "/original/codex",
        originator: "codex-cli",
        cli_version: "0.108.0-alpha.12",
        instructions: null,
        source: "cli",
        model_provider: "openai",
      },
    },
    {
      timestamp,
      type: "turn_context",
      payload: {
        cwd: "/original/codex",
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
        model: "gpt-5.4",
        collaboration_mode: { mode: "default" },
        effort: "high",
        summary: "auto",
        user_instructions: "",
        truncation_policy: { mode: "tokens", limit: 10000 },
      },
    },
    {
      timestamp,
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "Read README.md and tell me the test command.",
        images: [],
      },
    },
    {
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Read README.md and tell me the test command." }],
      },
    },
    {
      timestamp,
      type: "response_item",
      payload: {
        type: "function_call",
        name: "read_file",
        arguments: "{\"file_path\":\"README.md\"}",
        call_id: "call_readme",
      },
    },
    {
      timestamp,
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_readme",
        output: "README says bun test runs the suite.",
      },
    },
    {
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "The test command is bun test." }],
      },
    },
    {
      timestamp,
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "The test command is bun test.",
      },
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n");
}

describe("Gemini Converter", () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await rm(HISTORY_DIR, { recursive: true, force: true });
  });

  test("convertClaudeToGemini routes to the target cwd and writes project root metadata", async () => {
    const claudeSession = createClaudeSession();

    const result = await convertClaudeToGemini(claudeSession, {
      outputDir: GEMINI_OUTPUT_DIR,
      targetCwd: TARGET_CWD,
    });

    expect(result.success).toBe(true);
    expect(result.session.projectHash).toBe(generateGeminiProjectHash(TARGET_CWD));
    expect(result.outputPath.startsWith(GEMINI_OUTPUT_DIR)).toBe(true);

    const projectRoot = await Bun.file(join(TEST_DIR, "gemini", GEMINI_PROJECT_KEY, ".project_root")).text();
    expect(projectRoot.trim()).toBe(TARGET_CWD);

    const parsed = await parseGeminiSession(result.outputPath);
    const assistant = parsed.messages.find((message) => message.type === "gemini");
    expect(assistant?.type).toBe("gemini");
    if (assistant?.type === "gemini") {
      expect(assistant.toolCalls?.length).toBe(1);
    }
  });

  test("convertClaudeToGemini rejects a project hash that conflicts with target cwd", async () => {
    const claudeSession = createClaudeSession();

    await expect(
      convertClaudeToGemini(claudeSession, {
        outputDir: GEMINI_OUTPUT_DIR,
        targetCwd: TARGET_CWD,
        projectHash: "not-the-target-cwd-hash",
      })
    ).rejects.toThrow("projectHash must match the SHA-256 hash of targetCwd");
  });

  test("detectSessionFormat identifies Gemini chat files", async () => {
    const claudeSession = createClaudeSession();
    const result = await convertClaudeToGemini(claudeSession, {
      outputDir: GEMINI_OUTPUT_DIR,
      targetCwd: TARGET_CWD,
    });

    const format = await detectSessionFormat(result.outputPath);
    expect(format).toBe("gemini");
  });

  test("convertGeminiToClaude writes into the cwd-specific Claude project bucket", async () => {
    const geminiSession = createGeminiSession();

    const result = await convertGeminiToClaude(geminiSession, {
      outputDir: CLAUDE_OUTPUT_ROOT,
      targetCwd: TARGET_CWD,
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toContain(
      join(CLAUDE_OUTPUT_ROOT, slugifyClaudeProjectPath(TARGET_CWD))
    );

    const parsed = await parseClaudeSession(result.outputPath);
    expect(parsed.metadata.cwd).toBe(TARGET_CWD);

    const internalToolResult = parsed.messages.find(
      (message) =>
        message.type === "user" &&
        message.userType === "internal" &&
        Array.isArray(message.message.content) &&
        message.message.content.some((block) => block.type === "tool_result")
    );

    expect(Boolean(internalToolResult)).toBe(true);
  });

  test("convertGeminiToCodex preserves the target cwd in Codex metadata", async () => {
    const geminiSession = createGeminiSession();

    const result = await convertGeminiToCodex(geminiSession, {
      outputDir: CODEX_OUTPUT_ROOT,
      targetCwd: TARGET_CWD,
    });

    expect(result.success).toBe(true);

    const parsed = await parseCodexSession(result.outputPath);
    expect(parsed.metadata.cwd).toBe(TARGET_CWD);
    expect(parsed.turns[0]?.context.cwd).toBe(TARGET_CWD);
    expect(parsed.turns[0]?.toolCalls.length).toBe(1);
  });

  test("convertCodexToGemini uses the target cwd project hash", async () => {
    const codexFile = join(TEST_DIR, "codex-source.jsonl");
    await Bun.write(codexFile, createCodexJsonl("codex-test-session"));

    const codexSession = await parseCodexSession(codexFile);
    const result = await convertCodexToGemini(codexSession, {
      outputDir: GEMINI_OUTPUT_DIR,
      targetCwd: TARGET_CWD,
    });

    expect(result.success).toBe(true);
    expect(result.session.projectHash).toBe(generateGeminiProjectHash(TARGET_CWD));
  });
});
