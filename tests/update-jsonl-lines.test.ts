import { expect, test, describe, afterAll } from "bun:test";
import {
  updateJsonlLines,
  readJsonlFile,
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

describe("Update JSONL lines", () => {
  const sessionId = "47c72fd8-df9c-4170-9bb2-a1d40a6efdfd";
  const linesToUpdate = [7, 8];
  const topic = "helping users with TypeScript development";

  test("creates new file with updated text fields in lines 7 and 8", async () => {
    const result = await updateJsonlLines(sessionId, linesToUpdate, topic);

    // Track for cleanup
    filesToCleanup.push(result.newFilePath);

    // Verify result structure
    expect(result.newSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result.newSessionId).not.toBe(sessionId);
    expect(result.linesModified).toEqual(linesToUpdate);
    expect(result.topic).toBe(topic);

    // Read the new file
    const newLines = await readJsonlFile(result.newFilePath);

    // Should have same number of lines as original (8 lines)
    expect(newLines.length).toBe(8);

    // Verify lines 1-6 are preserved (check type field exists)
    const expectedTypes = ["summary", "user", "assistant", "summary", "file-history-snapshot", "user"];
    for (let i = 0; i < 6; i++) {
      const line = newLines[i] as Record<string, unknown>;
      expect(line.type).toBe(expectedTypes[i]);
    }

    // Verify line 7 is assistant type
    const line7 = newLines[6] as Record<string, unknown>;
    expect(line7.type).toBe("assistant");

    // Verify line 8 has non-empty text
    const line8 = newLines[7] as Record<string, unknown>;
    expect(line8.type).toBe("assistant");
    const message8 = line8.message as Record<string, unknown>;
    const content8 = message8.content as Array<Record<string, unknown>>;
    const textItem = content8.find(item => item.type === "text");

    // The text field should be populated (not empty)
    expect(textItem).toBeDefined();
    expect(typeof textItem!.text).toBe("string");
    expect((textItem!.text as string).length).toBeGreaterThan(0);

    // Verify old session ID is replaced
    const fileContent = await Bun.file(result.newFilePath).text();
    expect(fileContent).not.toContain(sessionId);
  }, 300000); // 5min timeout for Claude CLI
});
