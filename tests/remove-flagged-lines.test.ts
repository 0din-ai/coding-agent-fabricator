import { expect, test, describe, afterAll } from "bun:test";
import {
  removeFlaggedLines,
  readJsonlFile,
  generateUUID,
  sanitizeJsonlEntry,
  replaceSessionId,
  getJsonlLines
} from "../src/jsonl-processor";
import { unlink } from "node:fs/promises";

// Track files to clean up
const filesToCleanup: string[] = [];

afterAll(async () => {
  // Clean up created test files
  for (const file of filesToCleanup) {
    try {
      await unlink(file);
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe("Remove flagged JSONL lines", () => {
  const sessionId = "47c72fd8-df9c-4170-9bb2-a1d40a6efdfd";
  const linesToSanitize = [7, 8];

  test("creates new file with sanitized lines 7 and 8", async () => {
    const result = await removeFlaggedLines(sessionId, linesToSanitize);

    // Track for cleanup
    filesToCleanup.push(result.newFilePath);

    // Verify result structure
    expect(result.newSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result.newSessionId).not.toBe(sessionId);
    expect(result.linesModified).toEqual(linesToSanitize);

    // Read the new file
    const newLines = await readJsonlFile(result.newFilePath);
    expect(newLines.length).toBeGreaterThan(0);

    // Verify line 7 (thinking type) has empty thinking
    const line7 = newLines[6] as Record<string, unknown>;
    const message7 = line7.message as Record<string, unknown>;
    const content7 = message7.content as Array<Record<string, unknown>>;
    const thinkingItem = content7.find(item => item.type === "thinking");
    expect(thinkingItem?.thinking).toBe("");
    expect(thinkingItem?.signature).toBeDefined(); // Signature should be preserved

    // Verify line 8 (text type) has empty text
    const line8 = newLines[7] as Record<string, unknown>;
    const message8 = line8.message as Record<string, unknown>;
    const content8 = message8.content as Array<Record<string, unknown>>;
    const textItem = content8.find(item => item.type === "text");
    expect(textItem?.text).toBe("");

    // Verify session ID is replaced throughout
    const fileContent = await Bun.file(result.newFilePath).text();
    expect(fileContent).not.toContain(sessionId);
    expect(fileContent).toContain(result.newSessionId);
  }, 30000);
});

describe("generateUUID", () => {
  test("generates valid UUID v4 format", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("generates unique UUIDs", () => {
    const uuid1 = generateUUID();
    const uuid2 = generateUUID();
    expect(uuid1).not.toBe(uuid2);
  });
});

describe("sanitizeJsonlEntry", () => {
  test("removes thinking content but preserves signature", () => {
    const entry = {
      message: {
        content: [
          {
            type: "thinking",
            thinking: "secret thoughts",
            signature: "keep-this-signature"
          }
        ]
      }
    };

    const sanitized = sanitizeJsonlEntry(entry);
    const content = (sanitized.message as Record<string, unknown>).content as Array<Record<string, unknown>>;

    expect(content[0]!.thinking).toBe("");
    expect(content[0]!.signature).toBe("keep-this-signature");
  });

  test("removes text content", () => {
    const entry = {
      message: {
        content: [
          {
            type: "text",
            text: "sensitive text here"
          }
        ]
      }
    };

    const sanitized = sanitizeJsonlEntry(entry);
    const content = (sanitized.message as Record<string, unknown>).content as Array<Record<string, unknown>>;

    expect(content[0]!.text).toBe("");
  });

  test("handles mixed content types", () => {
    const entry = {
      message: {
        content: [
          { type: "thinking", thinking: "thoughts", signature: "sig" },
          { type: "text", text: "output" }
        ]
      }
    };

    const sanitized = sanitizeJsonlEntry(entry);
    const content = (sanitized.message as Record<string, unknown>).content as Array<Record<string, unknown>>;

    expect(content[0]!.thinking).toBe("");
    expect(content[0]!.signature).toBe("sig");
    expect(content[1]!.text).toBe("");
  });
});

describe("replaceSessionId", () => {
  test("replaces session ID in all fields", () => {
    const oldId = "old-session-id";
    const newId = "new-session-id";
    const entry = {
      sessionId: oldId,
      nested: {
        ref: `path/${oldId}/file`
      }
    };

    const replaced = replaceSessionId(entry, oldId, newId);

    expect(replaced.sessionId).toBe(newId);
    expect((replaced.nested as Record<string, unknown>).ref).toBe(`path/${newId}/file`);
  });
});
