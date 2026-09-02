import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  convertClaudeToCodex,
  convertCodexToClaude,
  detectSessionFormat,
  parseClaudeSession,
  parseCodexSession,
} from "../src/session-converter";

const TEST_DIR = "/tmp/fabricator-current-session-schema-test";

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function currentCodexRecords() {
  const timestamp = "2026-09-02T12:00:00.000Z";
  return [
    {
      ordinal: 0,
      timestamp,
      type: "session_meta",
      payload: {
        id: "codex-current-schema",
        timestamp,
        cwd: "/tmp/current-schema",
        originator: "Codex Desktop",
        cli_version: "0.130.0",
        source: "vscode",
        model_provider: "openai",
        history_mode: "full",
        context_window: { mode: "tokens", limit: 258400 },
        dynamic_tools: [],
      },
    },
    {
      ordinal: 1,
      timestamp,
      type: "world_state",
      payload: { full: true, state: { files: [] } },
    },
    {
      ordinal: 2,
      timestamp,
      type: "inter_agent_communication_metadata",
      payload: { trigger_turn: true },
    },
    {
      ordinal: 3,
      timestamp,
      type: "compacted",
      payload: {
        message: "Continue from the compacted context.",
        replacement_history: [],
        window_number: 1,
        window_id: "window-1",
        first_window_id: "window-1",
        previous_window_id: "window-0",
      },
    },
    {
      ordinal: 4,
      timestamp,
      type: "response_item",
      payload: {
        id: "developer-1",
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "Follow project instructions." }],
      },
    },
    {
      ordinal: 5,
      timestamp,
      type: "turn_context",
      payload: {
        turn_id: "turn-1",
        cwd: "/tmp/current-schema",
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
        model: "gpt-5.6",
        effort: "xhigh",
        summary: "none",
        permission_profile: { type: "disabled" },
        workspace_roots: ["/tmp/current-schema"],
      },
    },
    {
      ordinal: 6,
      timestamp,
      type: "response_item",
      payload: {
        id: "user-1",
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Inspect the project." },
          {
            type: "input_image",
            image_url: "data:image/png;base64,AA==",
            detail: "auto",
          },
        ],
      },
    },
    {
      ordinal: 7,
      timestamp,
      type: "response_item",
      payload: {
        id: "tool-1",
        type: "custom_tool_call",
        status: "completed",
        call_id: "call_patch",
        name: "apply_patch",
        input: '{"patch":"*** Begin Patch"}',
      },
    },
    {
      ordinal: 8,
      timestamp,
      type: "response_item",
      payload: {
        id: "tool-output-1",
        type: "custom_tool_call_output",
        call_id: "call_patch",
        output: [
          { type: "input_text", text: "Patch applied." },
          {
            type: "input_image",
            image_url: "data:image/png;base64,AQ==",
            detail: "auto",
          },
        ],
      },
    },
    {
      ordinal: 9,
      timestamp,
      type: "response_item",
      payload: {
        id: "tool-search-1",
        type: "tool_search_call",
        call_id: "call_search",
        status: "completed",
        execution: "client",
        arguments: { query: "issue tracker" },
      },
    },
    {
      ordinal: 10,
      timestamp,
      type: "response_item",
      payload: {
        id: "tool-search-output-1",
        type: "tool_search_output",
        call_id: "call_search",
        status: "completed",
        execution: "client",
        tools: [{ name: "issues_search" }],
      },
    },
    {
      ordinal: 11,
      timestamp,
      type: "response_item",
      payload: {
        id: "agent-message-1",
        type: "agent_message",
        author: "worker",
        recipient: "root",
        content: [{ type: "input_text", text: "Worker result." }],
      },
    },
    {
      ordinal: 12,
      timestamp,
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "Finished.",
        phase: "final_answer",
      },
    },
  ];
}

describe("current session schema coverage", () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("parses current Codex custom tools, images, agent messages, and metadata records", async () => {
    const filePath = join(TEST_DIR, "current-codex.jsonl");
    await Bun.write(filePath, jsonl(currentCodexRecords()));

    const session = await parseCodexSession(filePath);
    expect(session.recordCounts?.world_state).toBe(1);
    expect(session.recordCounts?.compacted).toBe(1);
    expect(session.recordCounts?.inter_agent_communication_metadata).toBe(1);
    expect(session.compactions?.[0]?.message).toBe(
      "Continue from the compacted context."
    );
    expect(session.responseItemCounts?.custom_tool_call).toBe(1);
    expect(session.responseItemCounts?.custom_tool_call_output).toBe(1);
    expect(session.eventCounts?.agent_message).toBe(1);
    expect(session.developerMessages?.[0]?.text).toBe(
      "Follow project instructions."
    );
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.userMessage).toBe("Inspect the project.");
    expect(session.turns[0]?.userImages).toEqual([
      "data:image/png;base64,AA==",
    ]);
    expect(session.turns[0]?.toolCalls).toHaveLength(2);
    expect(session.turns[0]?.toolCalls[0]).toMatchObject({
      kind: "custom",
      name: "apply_patch",
      callId: "call_patch",
    });
    expect(session.turns[0]?.toolCalls[0]?.output).toContain("Patch applied.");
    expect(session.turns[0]?.toolCalls[1]).toMatchObject({
      kind: "tool_search",
      callId: "call_search",
    });
    expect(session.turns[0]?.agentMessages).toEqual([
      { author: "worker", recipient: "root", text: "Worker result." },
    ]);

    const converted = await convertCodexToClaude(session, {
      outputDir: join(TEST_DIR, "claude"),
      targetCwd: "/tmp/current-schema",
    });
    const claude = await parseClaudeSession(converted.outputPath);
    const systemRecords = claude.records.filter((record) => record.type === "system");
    expect(systemRecords).toHaveLength(2);
    expect(systemRecords.some((record) => record.content.includes("developer message"))).toBe(true);
    expect(systemRecords.some((record) => record.content.includes("compaction"))).toBe(true);
    const timestamps = claude.records
      .map((record) => ("timestamp" in record ? record.timestamp : undefined))
      .filter((value): value is string => typeof value === "string")
      .map((value) => new Date(value).getTime());
    expect(timestamps.every((value, index) => index === 0 || value > timestamps[index - 1]!)).toBe(true);
    const user = claude.messages.find((message) => message.type === "user");
    expect(Array.isArray(user?.message.content)).toBe(true);
    expect(
      Array.isArray(user?.message.content) &&
        user.message.content.some((block) => block.type === "image")
    ).toBe(true);
    expect(
      claude.messages.some(
        (message) =>
          message.type === "assistant" &&
          Array.isArray(message.message.content) &&
          message.message.content.some(
            (block) => block.type === "text" && block.text.includes("Worker result.")
          )
      )
    ).toBe(true);
  });

  test("parses legacy top-level Codex response items", async () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const filePath = join(TEST_DIR, "legacy-codex.jsonl");
    await Bun.write(
      filePath,
      jsonl([
        {
          timestamp,
          type: "session_meta",
          payload: {
            id: "legacy-codex",
            timestamp,
            cwd: "/tmp/legacy",
            originator: "codex_cli_rs",
            cli_version: "0.1.0",
            source: "cli",
            model_provider: "openai",
          },
        },
        {
          timestamp,
          type: "turn_context",
          payload: {
            cwd: "/tmp/legacy",
            approval_policy: "never",
            sandbox_policy: { type: "danger-full-access" },
            model: "gpt-5",
            effort: "high",
            summary: "auto",
          },
        },
        {
          timestamp,
          type: "event_msg",
          payload: { type: "user_message", message: "Run the check.", images: [] },
        },
        {
          timestamp,
          type: "function_call",
          name: "shell_command",
          arguments: '{"command":"bun test"}',
          call_id: "call_legacy",
        },
        {
          timestamp,
          type: "function_call_output",
          call_id: "call_legacy",
          output: "Tests passed.",
        },
        {
          timestamp,
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        },
      ])
    );

    const session = await parseCodexSession(filePath);
    expect(session.turns[0]?.toolCalls[0]).toMatchObject({
      name: "shell_command",
      callId: "call_legacy",
      output: "Tests passed.",
    });
    expect(session.turns[0]?.assistantMessage).toBe("Done.");
  });

  test("uses item_completed events when response items are absent", async () => {
    const timestamp = "2026-09-02T12:30:00.000Z";
    const filePath = join(TEST_DIR, "event-only-codex.jsonl");
    await Bun.write(
      filePath,
      jsonl([
        {
          timestamp,
          type: "session_meta",
          payload: {
            id: "event-only-codex",
            timestamp,
            cwd: "/tmp/event-only",
            originator: "Codex Desktop",
            cli_version: "0.130.0",
            source: "vscode",
            model_provider: "openai",
          },
        },
        {
          timestamp,
          type: "turn_context",
          payload: { cwd: "/tmp/event-only", model: "gpt-5.6" },
        },
        {
          timestamp,
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: { id: "user-item", type: "UserMessage", content: "Run tests." },
          },
        },
        {
          timestamp,
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: {
              id: "command-item",
              type: "CommandExecution",
              command: ["bun", "test"],
              cwd: "/tmp/event-only",
              status: "completed",
              formatted_output: "Tests passed.",
            },
          },
        },
        {
          timestamp,
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: { id: "assistant-item", type: "AgentMessage", content: "Done." },
          },
        },
      ])
    );

    const session = await parseCodexSession(filePath);
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.userMessage).toBe("Run tests.");
    expect(session.turns[0]?.assistantMessage).toBe("Done.");
    expect(session.turns[0]?.toolCalls[0]).toMatchObject({
      kind: "custom",
      name: "exec_command",
      output: "Tests passed.",
    });
  });

  test("does not duplicate response tools mirrored by item_completed events", async () => {
    const timestamp = "2026-09-02T12:45:00.000Z";
    const filePath = join(TEST_DIR, "mirrored-tool-codex.jsonl");
    await Bun.write(
      filePath,
      jsonl([
        {
          timestamp,
          type: "session_meta",
          payload: {
            id: "mirrored-tool-codex",
            timestamp,
            cwd: "/tmp/mirrored-tool",
            originator: "Codex Desktop",
            cli_version: "0.130.0",
            source: "vscode",
            model_provider: "openai",
          },
        },
        {
          timestamp,
          type: "turn_context",
          payload: { cwd: "/tmp/mirrored-tool", model: "gpt-5.6" },
        },
        {
          timestamp,
          type: "response_item",
          payload: {
            id: "user-response-id",
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Run the command." }],
          },
        },
        {
          timestamp,
          type: "response_item",
          payload: {
            id: "custom-response-id",
            type: "custom_tool_call",
            call_id: "call_exec",
            name: "exec",
            input: '{"cmd":"bun test"}',
          },
        },
        {
          timestamp,
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: {
              id: "different-command-event-id",
              type: "CommandExecution",
              command: ["bun", "test"],
              status: "completed",
              formatted_output: "Tests passed.",
            },
          },
        },
        {
          timestamp,
          type: "response_item",
          payload: {
            id: "output-response-id",
            type: "custom_tool_call_output",
            call_id: "call_exec",
            output: "Tests passed.",
          },
        },
      ])
    );

    const session = await parseCodexSession(filePath);
    expect(session.turns[0]?.toolCalls).toHaveLength(1);
    expect(session.turns[0]?.toolCalls[0]).toMatchObject({
      callId: "call_exec",
      name: "exec",
      output: "Tests passed.",
    });
  });

  test("translates current Claude string content, fallback blocks, array results, and trailing users", async () => {
    const timestamp = "2026-09-02T13:00:00.000Z";
    const sessionId = "claude-current-schema";
    const filePath = join(TEST_DIR, "current-claude.jsonl");
    await Bun.write(
      filePath,
      jsonl([
        {
          type: "attachment",
          sessionId,
          timestamp,
          attachment: { type: "session_context", context: {} },
        },
        { type: "mode", sessionId, mode: "default" },
        {
          type: "user",
          sessionId,
          timestamp,
          uuid: "user-1",
          parentUuid: null,
          isSidechain: false,
          userType: "external",
          cwd: "/tmp/current-claude",
          version: "2.1.170",
          gitBranch: "main",
          message: { role: "user", content: "Inspect the project." },
        },
        {
          type: "assistant",
          sessionId,
          timestamp,
          uuid: "assistant-1",
          parentUuid: "user-1",
          isSidechain: false,
          userType: "external",
          cwd: "/tmp/current-claude",
          version: "2.1.170",
          gitBranch: "main",
          message: {
            role: "assistant",
            model: "claude-fable-5",
            id: "msg-1",
            type: "message",
            content: [
              { type: "fallback", from: "model-a", to: "model-b" },
              {
                type: "tool_use",
                id: "toolu_read",
                name: "Read",
                input: { file_path: "README.md" },
                caller: { type: "direct" },
              },
            ],
            stop_reason: "tool_use",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        },
        {
          type: "user",
          sessionId,
          timestamp,
          uuid: "tool-result-1",
          parentUuid: "assistant-1",
          isSidechain: false,
          userType: "internal",
          cwd: "/tmp/current-claude",
          version: "2.1.170",
          gitBranch: "main",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_read",
                content: [
                  { type: "text", text: "README contents" },
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: "AA==",
                    },
                  },
                ],
              },
            ],
          },
        },
        {
          type: "assistant",
          sessionId,
          timestamp,
          uuid: "assistant-2",
          parentUuid: "tool-result-1",
          isSidechain: false,
          userType: "external",
          cwd: "/tmp/current-claude",
          version: "2.1.170",
          gitBranch: "main",
          message: {
            role: "assistant",
            model: "claude-fable-5",
            id: "msg-2",
            type: "message",
            content: [{ type: "text", text: "Finished." }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 4, output_tokens: 2 },
          },
        },
        {
          type: "user",
          sessionId,
          timestamp,
          uuid: "user-2",
          parentUuid: "assistant-2",
          isSidechain: false,
          userType: "external",
          cwd: "/tmp/current-claude",
          version: "2.1.170",
          gitBranch: "main",
          message: { role: "user", content: "One more thing." },
        },
      ])
    );

    const claude = await parseClaudeSession(filePath);
    expect(claude.recordCounts?.attachment).toBe(1);
    expect(claude.recordCounts?.mode).toBe(1);

    const result = await convertClaudeToCodex(claude, {
      outputDir: join(TEST_DIR, "codex"),
    });
    const codex = await parseCodexSession(result.outputPath);
    expect(codex.turns).toHaveLength(2);
    expect(codex.turns[0]?.userMessage).toBe("Inspect the project.");
    expect(codex.turns[0]?.assistantMessage).toContain(
      "Model fallback: model-a -> model-b"
    );
    expect(codex.turns[0]?.assistantMessage).toContain("Finished.");
    expect(codex.turns[0]?.toolCalls[0]?.output).toContain("README contents");
    expect(codex.turns[1]?.userMessage).toBe("One more thing.");
    expect(
      result.warnings.some((warning) => warning.includes("attachment=1"))
    ).toBe(true);
  });

  test("detects Claude JSONL when metadata records precede the first message", async () => {
    const filePath = join(TEST_DIR, "metadata-first-claude.jsonl");
    await Bun.write(
      filePath,
      jsonl([
        {
          type: "attachment",
          sessionId: "metadata-first",
          timestamp: "2026-09-02T00:00:00.000Z",
          attachment: { type: "date", date: "2026-09-02" },
        },
        {
          type: "user",
          sessionId: "metadata-first",
          timestamp: "2026-09-02T00:00:01.000Z",
          uuid: "user-1",
          parentUuid: null,
          message: { role: "user", content: "Hello" },
        },
      ])
    );

    expect(await detectSessionFormat(filePath)).toBe("claude");
  });
});
