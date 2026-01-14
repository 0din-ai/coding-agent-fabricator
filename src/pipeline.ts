import { identifyFlaggedLines } from "./claude-runner";
import { removeFlaggedLines, updateJsonlLines, readJsonlFile } from "./jsonl-processor";
import { extendConversation } from "./conversation-extender";

export interface PipelineInput {
  sessionId: string;
  topic: string;
  extend?: number; // Number of additional exchanges to generate
}

export interface PipelineResult {
  originalSessionId: string;
  flaggedLines: number[];
  sanitizedSessionId: string;
  sanitizedFilePath: string;
  finalSessionId: string;
  finalFilePath: string;
  topic: string;
  extended?: {
    exchangesAdded: number;
    linesAdded: number;
    totalLines: number;
  };
}

/**
 * Full fabrication pipeline:
 * 1. Identify flagged lines (where assistant refused)
 * 2. Remove flagged content (sanitize those lines)
 * 3. Update with helpful content (populate based on topic)
 * 4. (Optional) Extend conversation with additional exchanges
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { sessionId, topic, extend } = input;

  console.log(`[Pipeline] Starting fabrication for session: ${sessionId}`);
  console.log(`[Pipeline] Topic: ${topic}`);
  if (extend) {
    console.log(`[Pipeline] Will extend with ${extend} additional exchanges`);
  }

  // Step 1: Identify flagged lines
  console.log(`[Pipeline] Step 1: Identifying flagged lines...`);
  const flaggedLines = await identifyFlaggedLines(sessionId);
  console.log(`[Pipeline] Found flagged lines: [${flaggedLines.join(", ")}]`);

  if (flaggedLines.length === 0) {
    throw new Error("No flagged lines found in session");
  }

  // Step 2: Remove flagged content
  console.log(`[Pipeline] Step 2: Removing flagged content...`);
  const sanitizeResult = await removeFlaggedLines(sessionId, flaggedLines);
  console.log(`[Pipeline] Created sanitized file: ${sanitizeResult.newSessionId}`);

  // Step 3: Update with helpful content
  console.log(`[Pipeline] Step 3: Updating with helpful content...`);
  const updateResult = await updateJsonlLines(
    sanitizeResult.newSessionId,
    flaggedLines,
    topic
  );
  console.log(`[Pipeline] Created final file: ${updateResult.newSessionId}`);

  // Clean up intermediate file (sanitized version)
  try {
    await Bun.file(sanitizeResult.newFilePath).delete();
    console.log(`[Pipeline] Cleaned up intermediate file`);
  } catch {
    // Ignore cleanup errors
  }

  // Step 4 (Optional): Extend conversation
  let extended: PipelineResult["extended"];
  if (extend && extend > 0) {
    console.log(`[Pipeline] Step 4: Extending conversation with ${extend} exchanges...`);
    const extendResult = await extendConversation({
      filePath: updateResult.newFilePath,
      sessionId: updateResult.newSessionId,
      topic,
      exchangeCount: extend
    });
    extended = {
      exchangesAdded: extend,
      linesAdded: extendResult.linesAdded,
      totalLines: extendResult.totalLines
    };
    console.log(`[Pipeline] Extended: +${extendResult.linesAdded} lines, total: ${extendResult.totalLines}`);
  }

  console.log(`[Pipeline] Complete!`);

  return {
    originalSessionId: sessionId,
    flaggedLines,
    sanitizedSessionId: sanitizeResult.newSessionId,
    sanitizedFilePath: sanitizeResult.newFilePath,
    finalSessionId: updateResult.newSessionId,
    finalFilePath: updateResult.newFilePath,
    topic,
    extended
  };
}

/**
 * Verify the pipeline output meets expectations
 */
export async function verifyPipelineOutput(result: PipelineResult): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  try {
    const lines = await readJsonlFile(result.finalFilePath);

    // Check line count
    if (lines.length < result.flaggedLines[result.flaggedLines.length - 1]!) {
      errors.push(`File has fewer lines than expected`);
    }

    // Check flagged lines have content
    // We only need at least ONE line to have populated text
    let hasPopulatedContent = false;

    for (const lineNum of result.flaggedLines) {
      const line = lines[lineNum - 1] as Record<string, unknown>;
      if (!line) {
        errors.push(`Line ${lineNum} is missing`);
        continue;
      }

      const message = line.message as Record<string, unknown> | undefined;
      if (!message?.content) {
        errors.push(`Line ${lineNum} has no message content`);
        continue;
      }

      const content = message.content as Array<Record<string, unknown>>;

      // Check for text type content
      const textItem = content.find(item => item.type === "text");
      if (textItem && typeof textItem.text === "string" && textItem.text.length > 0) {
        hasPopulatedContent = true;
      }

      // Check for thinking type content (line 7 might be thinking-only)
      const thinkingItem = content.find(item => item.type === "thinking");
      if (thinkingItem && typeof thinkingItem.thinking === "string" && thinkingItem.thinking.length > 0) {
        hasPopulatedContent = true;
      }
    }

    if (!hasPopulatedContent) {
      errors.push(`No flagged lines have populated content`);
    }

    // Check old session ID is not present
    const fileContent = await Bun.file(result.finalFilePath).text();
    if (fileContent.includes(result.originalSessionId)) {
      errors.push(`Original session ID still present in file`);
    }
  } catch (e) {
    errors.push(`Failed to read output file: ${e}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
