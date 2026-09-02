import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cloneRealCodexSession,
  seedCodexSessionFromSkeleton,
} from "../src/codex-session-seeder";
import { parseCodexFile, parseCodexSession } from "../src/session-converter";

const TEST_DIR = "/tmp/fabricator-codex-seeder-test";
const SESSIONS_DIR = join(TEST_DIR, ".codex", "sessions", "2026", "03", "05");

function createRichCodexJsonl(sessionId: string): string {
  const timestamp = new Date().toISOString();

  return [
    JSON.stringify({
      timestamp,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp,
        cwd: "/test/project",
        originator: "Codex Desktop",
        cli_version: "0.108.0-alpha.12",
        instructions: null,
        source: "vscode",
        model_provider: "openai",
        base_instructions: {
          text: "Base instructions",
        },
        git: {
          commit_hash: "abc123",
          branch: "main",
          repository_url: "https://example.com/repo.git",
        },
      },
    }),
    JSON.stringify({
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "Developer instructions" }],
      },
    }),
    JSON.stringify({
      timestamp,
      type: "turn_context",
      payload: {
        turn_id: "turn-1",
        cwd: "/test/project",
        current_date: "2026-03-05",
        timezone: "UTC",
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
        model: "gpt-5.4",
        personality: "pragmatic",
        collaboration_mode: { mode: "default" },
        realtime_active: false,
        effort: "xhigh",
        summary: "none",
        user_instructions: "Merged AGENTS instructions",
        developer_instructions: "Developer context",
        truncation_policy: { mode: "tokens", limit: 10000 },
      },
    }),
    JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "Original user request",
        images: [],
      },
    }),
    JSON.stringify({
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Original user request" }],
      },
    }),
    JSON.stringify({
      timestamp,
      type: "response_item",
      payload: {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: "codex docs",
        },
      },
    }),
    JSON.stringify({
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Original assistant reply" }],
      },
    }),
  ].join("\n");
}

describe("Codex session seeder", () => {
  beforeAll(async () => {
    await mkdir(SESSIONS_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("parseCodexSession handles richer current Codex fields", async () => {
    const sessionId = "00000000-0000-7000-8000-000000000001";
    const filePath = join(
      SESSIONS_DIR,
      `rollout-2026-03-05T21-26-20-${sessionId}.jsonl`
    );

    await Bun.write(filePath, createRichCodexJsonl(sessionId));

    const session = await parseCodexSession(filePath);

    const baseInstructions = session.metadata.base_instructions;
    expect(
      typeof baseInstructions === "string"
        ? baseInstructions
        : baseInstructions?.text
    ).toBe("Base instructions");
    expect(session.turns.length).toBe(1);
    expect(session.turns[0]?.userMessage).toBe("Original user request");
    expect(session.turns[0]?.assistantMessage).toBe("Original assistant reply");
  });

  test("cloneRealCodexSession preserves structure and changes session id", async () => {
    const sessionId = "00000000-0000-7000-8000-000000000001";
    const filePath = join(
      SESSIONS_DIR,
      `rollout-2026-03-05T21-26-20-${sessionId}.jsonl`
    );

    await Bun.write(filePath, createRichCodexJsonl(sessionId));

    const result = await cloneRealCodexSession(filePath, TEST_DIR);
    const clonedText = await Bun.file(result.destinationPath).text();

    expect(result.newSessionId).not.toBe(result.oldSessionId);
    expect(clonedText.includes(result.oldSessionId)).toBe(false);
    expect(clonedText.includes(result.newSessionId)).toBe(true);
  });

  test("seedCodexSessionFromSkeleton preserves frame and replaces only task turn", async () => {
    const sessionId = "00000000-0000-7000-8000-000000000001";
    const filePath = join(
      SESSIONS_DIR,
      `rollout-2026-03-05T21-26-20-${sessionId}.jsonl`
    );

    await Bun.write(filePath, createRichCodexJsonl(sessionId));

    const result = await seedCodexSessionFromSkeleton({
      sessionIdOrFile: filePath,
      promptText: "Create PRD-27 that consolidates PRDs 22-25.",
      outputDir: TEST_DIR,
      userInstructions: "Seeded user instructions",
      currentDate: "2026-03-06",
      timezone: "UTC",
      cwd: "/workspace/example-project",
    });

    const records = await parseCodexFile(result.seededPath);

    expect(records.filter((r) => r.type === "session_meta")).toHaveLength(1);
    expect(
      records.filter(
        (r) =>
          r.type === "response_item" &&
          r.payload.type === "message" &&
          r.payload.role === "developer"
      )
    ).toHaveLength(1);
    expect(records.filter((r) => r.type === "turn_context")).toHaveLength(1);
    expect(
      records.filter(
        (r) =>
          r.type === "response_item" &&
          r.payload.type === "message" &&
          r.payload.role === "assistant"
      )
    ).toHaveLength(0);
    expect(
      records.filter(
        (r) => r.type === "response_item" && r.payload.type === "web_search_call"
      )
    ).toHaveLength(0);

    const turnContext = records.find((r) => r.type === "turn_context");
    if (!turnContext || turnContext.type !== "turn_context") {
      throw new Error("Expected turn_context record");
    }

    expect(turnContext.payload.user_instructions).toBe("Seeded user instructions");
    expect(turnContext.payload.current_date).toBe("2026-03-06");
    expect(turnContext.payload.timezone).toBe("UTC");
    expect(turnContext.payload.cwd).toBe(
      "/workspace/example-project"
    );

    const userMessageRecord = records.find(
      (r) =>
        r.type === "response_item" &&
        r.payload.type === "message" &&
        r.payload.role === "user"
    );
    if (
      !userMessageRecord ||
      userMessageRecord.type !== "response_item" ||
      userMessageRecord.payload.type !== "message"
    ) {
      throw new Error("Expected seeded user response_item");
    }

    const firstContent = userMessageRecord.payload.content[0];
    expect(firstContent?.type === "input_text" ? firstContent.text : undefined).toBe(
      "Create PRD-27 that consolidates PRDs 22-25."
    );
  });
});
