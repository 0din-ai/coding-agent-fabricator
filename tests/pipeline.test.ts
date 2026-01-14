import { expect, test, describe, afterAll } from "bun:test";
import { runPipeline, verifyPipelineOutput } from "../src/pipeline";
import { readJsonlFile } from "../src/jsonl-processor";
import { unlink } from "node:fs/promises";

// Track files to clean up
const filesToCleanup: string[] = [];

afterAll(async () => {
  for (const file of filesToCleanup) {
    try {
      await unlink(file);
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe("Full Pipeline", () => {
  const sessionId = "47c72fd8-df9c-4170-9bb2-a1d40a6efdfd";
  const topic = "helping users with TypeScript development";

  test("runs complete pipeline: identify → remove → update", async () => {
    const result = await runPipeline({ sessionId, topic });

    // Track for cleanup
    filesToCleanup.push(result.finalFilePath);

    // Verify result structure
    expect(result.originalSessionId).toBe(sessionId);
    expect(result.flaggedLines).toEqual([7, 8]);
    expect(result.topic).toBe(topic);

    // Final session ID should be different from original
    expect(result.finalSessionId).not.toBe(sessionId);
    expect(result.finalSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // Verify the output file
    const verification = await verifyPipelineOutput(result);
    expect(verification.valid).toBe(true);
    expect(verification.errors).toEqual([]);

    // Additional checks on file content
    const lines = await readJsonlFile(result.finalFilePath);
    expect(lines.length).toBe(8);

    // Check at least line 8 has populated text (line 7 is thinking type)
    const line8 = lines[7] as Record<string, unknown>;
    const message = line8.message as Record<string, unknown>;
    const content = message.content as Array<Record<string, unknown>>;
    const textItem = content.find(item => item.type === "text");

    // Line 8 should have text content populated by Claude
    expect(textItem).toBeDefined();
    expect(typeof textItem!.text).toBe("string");
    expect((textItem!.text as string).length).toBeGreaterThan(10);

    // Verify old session ID is not in file
    const fileContent = await Bun.file(result.finalFilePath).text();
    expect(fileContent).not.toContain(sessionId);
    expect(fileContent).toContain(result.finalSessionId);
  }, 600000); // 10min timeout for full pipeline
});
