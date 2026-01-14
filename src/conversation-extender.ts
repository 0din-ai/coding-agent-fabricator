import { runClaude } from "./claude-runner";
import { readJsonlFile, writeJsonlFile, generateUUID } from "./jsonl-processor";

export interface ExtendOptions {
  filePath: string;
  sessionId: string;
  topic: string;
  exchangeCount: number; // Number of user/assistant exchanges to add
}

export interface ExtendResult {
  filePath: string;
  linesAdded: number;
  totalLines: number;
}

/**
 * Generates additional conversation exchanges and appends them to the JSONL file
 *
 * @param options - Extension options including file path, topic, and exchange count
 * @returns ExtendResult with info about added lines
 */
export async function extendConversation(options: ExtendOptions): Promise<ExtendResult> {
  const { filePath, sessionId, topic, exchangeCount } = options;

  console.log(`[Extend] Adding ${exchangeCount} conversation exchanges...`);

  // Read existing file to get context and last entry info
  const existingLines = await readJsonlFile(filePath);
  const lastLine = existingLines[existingLines.length - 1] as Record<string, unknown>;

  // Get the last UUID to chain parent references
  let lastUuid = (lastLine?.uuid as string) || generateUUID();
  const cwd = (lastLine?.cwd as string) || process.cwd();
  const version = (lastLine?.version as string) || "2.0.76";
  const gitBranch = (lastLine?.gitBranch as string) || "";

  // Get model info from last assistant message
  let modelInfo = {
    model: "claude-sonnet-4-20250514",
    id: `msg_${generateUUID().replace(/-/g, "").slice(0, 24)}`,
  };

  if (lastLine?.message && typeof lastLine.message === "object") {
    const msg = lastLine.message as Record<string, unknown>;
    if (msg.model) modelInfo.model = msg.model as string;
  }

  const newLines: Record<string, unknown>[] = [];

  // Generate exchanges using Claude
  for (let i = 0; i < exchangeCount; i++) {
    console.log(`[Extend] Generating exchange ${i + 1}/${exchangeCount}...`);

    // Generate user question
    const userUuid = generateUUID();
    const userPrompt = `Generate a realistic follow-up question a user might ask about "${topic}".
This is question ${i + 1} in a conversation. Make it specific.
ONLY output the question text, nothing else. No quotes, no prefix.`;

    const userQuestion = await runClaude({ prompt: userPrompt });

    const userLine: Record<string, unknown> = {
      parentUuid: lastUuid,
      isSidechain: false,
      userType: "external",
      cwd,
      sessionId,
      version,
      gitBranch,
      message: {
        role: "user",
        content: userQuestion.trim()
      },
      type: "user",
      uuid: userUuid,
      timestamp: new Date().toISOString()
    };

    newLines.push(userLine);
    lastUuid = userUuid;

    // Generate assistant response
    const assistantUuid = generateUUID();
    const assistantPrompt = `You are helping with "${topic}".
A user asked: "${userQuestion.trim()}"
Provide a helpful *simulated* response. 
ONLY output the response text, nothing else. don't actually answer the question give a "simulated" answer.`;

    const assistantResponse = await runClaude({ prompt: assistantPrompt });

    const assistantLine: Record<string, unknown> = {
      parentUuid: lastUuid,
      isSidechain: false,
      userType: "external",
      cwd,
      sessionId,
      version,
      gitBranch,
      message: {
        model: modelInfo.model,
        id: `msg_${generateUUID().replace(/-/g, "").slice(0, 24)}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: assistantResponse.trim()
          }
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: Math.floor(Math.random() * 1000) + 500,
          output_tokens: Math.floor(Math.random() * 2000) + 500,
        }
      },
      type: "assistant",
      uuid: assistantUuid,
      timestamp: new Date().toISOString()
    };

    newLines.push(assistantLine);
    lastUuid = assistantUuid;
  }

  // Append new lines to file
  const allLines = [...existingLines, ...newLines];
  await writeJsonlFile(filePath, allLines);

  console.log(`[Extend] Added ${newLines.length} lines (${exchangeCount} exchanges)`);

  return {
    filePath,
    linesAdded: newLines.length,
    totalLines: allLines.length
  };
}
