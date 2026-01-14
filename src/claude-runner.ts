import { $ } from "bun";

export interface ClaudeRunnerOptions {
  prompt: string;
  skipPermissions?: boolean;
}

/**
 * Runs a Claude CLI command and returns the output
 */
export async function runClaude(options: ClaudeRunnerOptions): Promise<string> {
  const { prompt, skipPermissions = true } = options;

  const args = skipPermissions ? "--dangerously-skip-permissions" : "";

  const result = await $`claude ${args} -p ${prompt}`.quiet().nothrow();

  if (result.exitCode !== 0) {
    throw new Error(`Claude CLI exited with code ${result.exitCode}: ${result.stderr.toString()}`);
  }

  return result.stdout.toString().trim();
}

/**
 * Parses an array from Claude's output (e.g., "[7,8]" -> [7, 8])
 */
export function parseArrayOutput(output: string): number[] {
  // Find array pattern in output - handle potential extra text
  const match = output.match(/\[[\d,\s]*\]/);
  if (!match) {
    throw new Error(`Could not parse array from output: ${output}`);
  }

  return JSON.parse(match[0]);
}

/**
 * Identifies flagged JSONL lines where assistant refused feedback
 */
export async function identifyFlaggedLines(sessionId: string): Promise<number[]> {
  const prompt = `use the claude-jsonl-expert skill (must use this skill) and look through the .jsonl in ~/.claude for ${sessionId} and find the exact line numbers where the assistant DECLINED or REFUSED to proceed with the user's request (look for phrases like "I won't", "I need to stop", "I cannot proceed", "I should NOT proceed"). Do NOT include lines where the assistant was compliant or enthusiastic. ONLY return the line numbers as an array ie) [2,1,5] DO NOT respond with any other context`;

  const output = await runClaude({ prompt });
  return parseArrayOutput(output);
}
