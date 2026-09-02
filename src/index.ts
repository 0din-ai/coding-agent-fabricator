/**
 * Fabricator - JSONL Conversation Fabrication Pipeline
 *
 * Processes Claude conversation JSONL files to:
 * 1. Identify lines where the assistant refused
 * 2. Remove the refusal content
 * 3. Replace with helpful content based on a topic
 *
 * Also supports bidirectional session conversion between:
 * - Claude Code (~/.claude/projects/)
 * - OpenAI Codex (~/.codex/sessions/)
 */

export { runPipeline, verifyPipelineOutput } from "./pipeline";
export type { PipelineInput, PipelineResult } from "./pipeline";

export { extendConversation } from "./conversation-extender";
export type { ExtendOptions, ExtendResult } from "./conversation-extender";

export { identifyFlaggedLines, runClaude, parseArrayOutput } from "./claude-runner";

export {
  removeFlaggedLines,
  updateJsonlLines,
  findJsonlFile,
  readJsonlFile,
  writeJsonlFile,
  generateUUID,
  sanitizeJsonlEntry,
  replaceSessionId,
  getJsonlLines,
} from "./jsonl-processor";

export type { ProcessorResult, UpdateResult } from "./jsonl-processor";

// Session Converter exports
export {
  parseClaudeSession,
  parseCodexFile,
  parseCodexSession,
  convertClaudeToCodex,
  convertCodexToClaude,
  convertClaudeFileToCodex,
  convertCodexFileToClaude,
  detectSessionFormat,
  validateClaudeSession,
  validateCodexSession,
  listClaudeSessions,
  listCodexSessions,
} from "./session-converter";

export type {
  ClaudeSession,
  CodexSession,
  ClaudeToCodexOptions,
  CodexToClaudeOptions,
  ConversionResult,
  SessionListEntry,
} from "./session-converter";

// Codex session seeder exports
export {
  cloneRealCodexSession,
  seedCodexSessionFromSkeleton,
} from "./codex-session-seeder";

export type {
  CloneRealCodexSessionResult,
  SeedCodexSessionOptions,
  SeedCodexSessionResult,
} from "./codex-session-seeder";

// Gemini Converter exports
export {
  parseGeminiSession,
  listGeminiSessions,
  convertClaudeToGemini,
  convertClaudeFileToGemini,
  convertGeminiToClaude,
  convertGeminiFileToClaude,
  convertGeminiToCodex,
  convertGeminiFileToCodex,
  convertCodexToGemini,
  convertCodexFileToGemini,
  isGeminiFormat,
} from "./gemini-converter";

export type {
  GeminiSession,
  GeminiMessage,
  GeminiUserMessage,
  GeminiAssistantMessage,
  GeminiThought,
  GeminiTokens,
  ClaudeToGeminiOptions,
  GeminiToClaudeOptions,
  GeminiToCodexOptions,
  GeminiConversionResult,
  GeminiSessionListEntry,
  GeminiToolCall,
} from "./gemini-converter";

// Session Line Appender exports
export {
  appendLine,
  appendMultipleLines,
  addUserMessage,
  addAssistantMessage,
  addToolCall,
  addToolResult,
  addToolInteraction,
  addExchange,
  parseDSL,
  addFromDSL,
} from "./session-line-appender";

export type {
  LineType,
  LineContent,
  AppendLineOptions,
  AppendMultipleLinesOptions,
  AppendResult,
  ConvenienceOptions,
} from "./session-line-appender";

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);

  function parseConversionArgs(commandArgs: string[]) {
    const positionals: string[] = [];
    let targetCwd = process.cwd();

    for (let i = 0; i < commandArgs.length; i++) {
      const arg = commandArgs[i]!;

      if (arg === "--cwd") {
        const value = commandArgs[i + 1];
        if (!value) {
          throw new Error("Missing value for --cwd");
        }
        targetCwd = value;
        i++;
        continue;
      }

      positionals.push(arg);
    }

    return {
      inputFile: positionals[0],
      outputDir: positionals[1],
      targetCwd,
    };
  }

  // Check for conversion commands first
  if (args[0] === "--to-gemini") {
    let parsedArgs;

    try {
      parsedArgs = parseConversionArgs(args.slice(1));
    } catch (error) {
      console.error(String(error));
      process.exit(1);
    }

    const { inputFile, outputDir, targetCwd } = parsedArgs;

    if (!inputFile) {
      console.log("Usage: bun run src/index.ts --to-gemini <input-file> [output-dir] [--cwd <dir>]");
      console.log("");
      console.log("Convert Claude Code or Codex session files to Gemini format.");
      console.log("");
      console.log("Examples:");
      console.log("  bun run src/index.ts --to-gemini ~/.claude/projects/-path/session.jsonl");
      console.log("  bun run src/index.ts --to-gemini ~/.codex/sessions/2026/03/04/rollout-xxx.jsonl");
      console.log("  bun run src/index.ts --to-gemini ~/.claude/projects/-path/session.jsonl --cwd $(pwd)");
      process.exit(1);
    }

    const { convertClaudeFileToGemini, convertCodexFileToGemini } = await import(
      "./gemini-converter"
    );
    const { detectSessionFormat } = await import("./session-converter");

    try {
      const format = await detectSessionFormat(inputFile);

      if (format === "unknown") {
        console.error("Error: Could not detect input session format");
        process.exit(1);
      }

      if (format === "gemini") {
        console.error("Error: Input file is already in Gemini format");
        process.exit(1);
      }

      const result =
        format === "codex"
          ? await convertCodexFileToGemini(inputFile, {
              outputDir,
              targetCwd,
            })
          : await convertClaudeFileToGemini(inputFile, {
              outputDir,
              targetCwd,
            });

      console.log(
        `Converting ${format === "codex" ? "Codex" : "Claude Code"} session to Gemini format...`
      );

      console.log("\n=== Conversion Result ===");
      console.log(`Success: ${result.success}`);
      console.log(`Output: ${result.outputPath}`);
      console.log(`Messages Converted: ${result.statistics.messagesConverted}`);
      console.log(`Tool Calls Converted: ${result.statistics.toolCallsConverted}`);
      console.log(`Thoughts Generated: ${result.statistics.thoughtsGenerated}`);

      if (result.warnings.length > 0) {
        console.log("\nWarnings:");
        result.warnings.forEach((w) => console.log(`  - ${w}`));
      }

      if (result.errors.length > 0) {
        console.log("\nErrors:");
        result.errors.forEach((e) => console.log(`  - ${e}`));
        process.exit(1);
      }

      console.log("\n✅ Gemini conversion completed successfully");
      process.exit(0);
    } catch (error) {
      console.error("Gemini conversion failed:", error);
      process.exit(1);
    }
  }

  if (args[0] === "--to-codex" || args[0] === "--to-claude") {
    const isToCodex = args[0] === "--to-codex";
    let parsedArgs;

    try {
      parsedArgs = parseConversionArgs(args.slice(1));
    } catch (error) {
      console.error(String(error));
      process.exit(1);
    }

    const { inputFile, outputDir, targetCwd } = parsedArgs;

    if (!inputFile) {
      console.log(`Usage: bun run src/index.ts ${args[0]} <input-file> [output-dir] [--cwd <dir>]`);
      console.log("");
      console.log("Convert session files between Claude Code, Gemini, and Codex formats.");
      console.log("");
      console.log("Examples:");
      console.log(`  bun run src/index.ts --to-codex ~/.claude/projects/-path/session.jsonl`);
      console.log(`  bun run src/index.ts --to-codex ~/.gemini/tmp/project/chats/session-xxx.json`);
      console.log(`  bun run src/index.ts --to-claude ~/.codex/sessions/2026/01/13/rollout-xxx.jsonl`);
      console.log(`  bun run src/index.ts --to-claude ~/.gemini/tmp/project/chats/session-xxx.json --cwd $(pwd)`);
      process.exit(1);
    }

    const {
      convertClaudeFileToCodex,
      convertCodexFileToClaude,
      detectSessionFormat,
    } = await import("./session-converter");
    const { convertGeminiFileToClaude, convertGeminiFileToCodex } = await import(
      "./gemini-converter"
    );

    try {
      const format = await detectSessionFormat(inputFile);

      if (format === "unknown") {
        console.error("Error: Could not detect input session format");
        process.exit(1);
      }

      if (isToCodex) {
        if (format === "codex") {
          console.error("Error: Input file is already in Codex format");
          process.exit(1);
        }

        const result =
          format === "gemini"
            ? await convertGeminiFileToCodex(inputFile, {
                outputDir,
                preserveMetadata: true,
                targetCwd,
              })
            : await convertClaudeFileToCodex(inputFile, {
                outputDir,
                preserveMetadata: true,
                targetCwd,
              });

        console.log(
          `Converting ${format === "gemini" ? "Gemini" : "Claude Code"} session to Codex format...`
        );

        console.log("\n=== Conversion Result ===");
        console.log(`Success: ${result.success}`);
        console.log(`Output: ${result.outputPath}`);
        console.log(`Records Converted: ${result.statistics.recordsConverted}`);
        console.log(`Messages Converted: ${result.statistics.messagesConverted}`);
        console.log(`Tool Calls Converted: ${result.statistics.toolCallsConverted}`);

        if (result.warnings.length > 0) {
          console.log("\nWarnings:");
          result.warnings.forEach((w) => console.log(`  - ${w}`));
        }

        if (result.errors.length > 0) {
          console.log("\nErrors:");
          result.errors.forEach((e) => console.log(`  - ${e}`));
          process.exit(1);
        }
      } else {
        if (format === "claude") {
          console.error("Error: Input file is already in Claude Code format");
          process.exit(1);
        }

        const result =
          format === "gemini"
            ? await convertGeminiFileToClaude(inputFile, {
                outputDir,
                generateUuids: true,
                targetCwd,
              })
            : await convertCodexFileToClaude(inputFile, {
                outputDir,
                generateUuids: true,
                reconstructThreading: true,
                projectPath: targetCwd,
                targetCwd,
              });

        console.log(
          `Converting ${format === "gemini" ? "Gemini" : "Codex"} session to Claude Code format...`
        );

        console.log("\n=== Conversion Result ===");
        console.log(`Success: ${result.success}`);
        console.log(`Output: ${result.outputPath}`);
        console.log(`Records Converted: ${result.statistics.recordsConverted}`);
        console.log(`Messages Converted: ${result.statistics.messagesConverted}`);
        console.log(`Tool Calls Converted: ${result.statistics.toolCallsConverted}`);

        if (result.warnings.length > 0) {
          console.log("\nWarnings:");
          result.warnings.forEach((w) => console.log(`  - ${w}`));
        }

        if (result.errors.length > 0) {
          console.log("\nErrors:");
          result.errors.forEach((e) => console.log(`  - ${e}`));
          process.exit(1);
        }
      }

      console.log("\n✅ Conversion completed successfully");
      process.exit(0);
    } catch (error) {
      console.error("Conversion failed:", error);
      process.exit(1);
    }
  }

  // Clone a Codex session file into a new session with a new ID.
  // This is intentionally a byte-for-byte copy except for replacing the
  // original session ID string with the new session ID string.
  if (args[0] === "--clone-codex") {
    const sessionIdOrFile = args[1];
    const outputDirArg = args[2];

    if (!sessionIdOrFile) {
      console.log("Usage: bun run src/index.ts --clone-codex <session-id|file> [output-dir]");
      console.log("");
      console.log("Duplicate a Codex session JSONL file with a new session ID.");
      console.log("");
      console.log("Examples:");
      console.log("  bun run src/index.ts --clone-codex 019c5206-...-587193d6f7be");
      console.log("  bun run src/index.ts --clone-codex ~/.codex/sessions/2026/02/12/rollout-...jsonl");
      process.exit(1);
    }

    const { cloneRealCodexSession } = await import("./codex-session-seeder");

    try {
      const result = await cloneRealCodexSession(sessionIdOrFile, outputDirArg);
      console.log("=== Clone Result ===");
      console.log(`Source: ${result.sourcePath}`);
      console.log(`Destination: ${result.destinationPath}`);
      console.log(`Old ID: ${result.oldSessionId}`);
      console.log(`New ID: ${result.newSessionId}`);
      console.log("");
      console.log("✅ Codex session cloned successfully");
      process.exit(0);
    } catch (error) {
      console.error("Clone failed:", error);
      process.exit(1);
    }
  }

  if (args[0] === "--clone-real-codex-session") {
    const sessionIdOrFile = args[1];
    const outputDir = args[2];

    if (!sessionIdOrFile) {
      console.log(
        "Usage: bun run src/index.ts --clone-real-codex-session <session-id|file> [output-dir]"
      );
      process.exit(1);
    }

    const { cloneRealCodexSession } = await import("./codex-session-seeder");

    try {
      const result = await cloneRealCodexSession(sessionIdOrFile, outputDir);
      console.log("=== Clone Result ===");
      console.log(`Source: ${result.sourcePath}`);
      console.log(`Destination: ${result.destinationPath}`);
      console.log(`Old ID: ${result.oldSessionId}`);
      console.log(`New ID: ${result.newSessionId}`);
      console.log("");
      console.log("✅ Real Codex session cloned successfully");
      process.exit(0);
    } catch (error) {
      console.error("Clone failed:", error);
      process.exit(1);
    }
  }

  if (args[0] === "--seed-codex") {
    const sessionIdOrFile = args[1];
    const promptFile = args[2];
    const outputDir = args[3];

    if (!sessionIdOrFile || !promptFile) {
      console.log("Usage: bun run src/index.ts --seed-codex <session-id|file> <prompt-file> [output-dir]");
      console.log("");
      console.log("Clone a real Codex session skeleton and replace only the task turn payload.");
      console.log("");
      console.log("Examples:");
      console.log("  bun run src/index.ts --seed-codex 019cc12e-... ./prompt.md");
      console.log("  bun run src/index.ts --seed-codex ~/.codex/sessions/...jsonl ./prompt.md ./seeded");
      process.exit(1);
    }

    const { seedCodexSessionFromSkeleton } = await import("./codex-session-seeder");

    try {
      const promptText = await Bun.file(promptFile).text();
      const result = await seedCodexSessionFromSkeleton({
        sessionIdOrFile,
        promptText,
        outputDir,
      });

      console.log("=== Seed Result ===");
      console.log(`Source: ${result.sourcePath}`);
      console.log(`Seeded: ${result.seededPath}`);
      console.log(`Old ID: ${result.oldSessionId}`);
      console.log(`New ID: ${result.newSessionId}`);
      console.log("");
      console.log("✅ Codex session seeded successfully");
      process.exit(0);
    } catch (error) {
      console.error("Seed failed:", error);
      process.exit(1);
    }
  }

  // Check for list sessions command
  if (args[0] === "--list-sessions") {
    const format = args[1] as "claude" | "codex" | "gemini" | undefined;

    const { listClaudeSessions, listCodexSessions } = await import(
      "./session-converter"
    );
    const { listGeminiSessions } = await import("./gemini-converter");

    try {
      if (!format || format === "claude") {
        console.log("=== Claude Code Sessions ===");
        const claudeSessions = await listClaudeSessions();
        if (claudeSessions.length === 0) {
          console.log("  No sessions found");
        } else {
          claudeSessions.slice(0, 10).forEach((s) => {
            console.log(`  ${s.sessionId}`);
            console.log(`    Path: ${s.path}`);
            console.log(`    Project: ${s.project}`);
            console.log(`    Modified: ${s.timestamp}`);
            console.log("");
          });
          if (claudeSessions.length > 10) {
            console.log(`  ... and ${claudeSessions.length - 10} more`);
          }
        }
      }

      if (!format || format === "codex") {
        console.log("\n=== Codex Sessions ===");
        const codexSessions = await listCodexSessions();
        if (codexSessions.length === 0) {
          console.log("  No sessions found");
        } else {
          codexSessions.slice(0, 10).forEach((s) => {
            console.log(`  ${s.sessionId}`);
            console.log(`    Path: ${s.path}`);
            console.log(`    Modified: ${s.timestamp}`);
            console.log("");
          });
          if (codexSessions.length > 10) {
            console.log(`  ... and ${codexSessions.length - 10} more`);
          }
        }
      }

      if (!format || format === "gemini") {
        console.log("\n=== Gemini Sessions ===");
        const geminiSessions = await listGeminiSessions();
        if (geminiSessions.length === 0) {
          console.log("  No sessions found");
        } else {
          geminiSessions.slice(0, 10).forEach((s) => {
            console.log(`  ${s.sessionId}`);
            console.log(`    Path: ${s.path}`);
            console.log(`    Project Hash: ${s.projectHash.substring(0, 16)}...`);
            console.log(`    Messages: ${s.messageCount}`);
            console.log(`    Modified: ${s.timestamp}`);
            console.log("");
          });
          if (geminiSessions.length > 10) {
            console.log(`  ... and ${geminiSessions.length - 10} more`);
          }
        }
      }

      process.exit(0);
    } catch (error) {
      console.error("Failed to list sessions:", error);
      process.exit(1);
    }
  }

  // Check for line appending commands
  if (args[0] === "--add-user" || args[0] === "--add-assistant" ||
      args[0] === "--add-tool" || args[0] === "--add-result" ||
      args[0] === "--add-exchange" || args[0] === "--add-dsl") {

    const command = args[0];
    const sessionId = args[1];

    if (!sessionId) {
      console.log(`Usage: bun run src/index.ts ${command} <session-id> ...`);
      console.log("");
      console.log("Line Appending Commands:");
      console.log('  --add-user <session-id> "<text>"');
      console.log('  --add-assistant <session-id> "<text>"');
      console.log('  --add-tool <session-id> <tool-name> [\'{"input": "json"}\']');
      console.log('  --add-result <session-id> <tool-use-id> "<result>"');
      console.log('  --add-exchange <session-id> "<user-msg>" "<assistant-msg>"');
      console.log('  --add-dsl <session-id> "<dsl-string>"');
      console.log("");
      console.log("Examples:");
      console.log('  bun run src/index.ts --add-user abc123 "Hello, how are you?"');
      console.log('  bun run src/index.ts --add-assistant abc123 "I am doing well!"');
      console.log('  bun run src/index.ts --add-tool abc123 Read \'{"file_path": "/tmp/test.txt"}\'');
      console.log('  bun run src/index.ts --add-result abc123 toolu_abc "File contents here"');
      console.log('  bun run src/index.ts --add-exchange abc123 "Question?" "Answer!"');
      process.exit(1);
    }

    const {
      addUserMessage,
      addAssistantMessage,
      addToolCall,
      addToolResult,
      addExchange,
      addFromDSL,
    } = await import("./session-line-appender");

    try {
      let result;

      switch (command) {
        case "--add-user": {
          const text = args[2];
          if (!text) {
            console.error("Error: --add-user requires text argument");
            process.exit(1);
          }
          console.log(`Adding user message to session ${sessionId}...`);
          result = await addUserMessage(sessionId, text);
          break;
        }

        case "--add-assistant": {
          const text = args[2];
          if (!text) {
            console.error("Error: --add-assistant requires text argument");
            process.exit(1);
          }
          console.log(`Adding assistant message to session ${sessionId}...`);
          result = await addAssistantMessage(sessionId, text);
          break;
        }

        case "--add-tool": {
          const toolName = args[2];
          if (!toolName) {
            console.error("Error: --add-tool requires tool name argument");
            process.exit(1);
          }
          let toolInput: Record<string, unknown> = {};
          if (args[3]) {
            try {
              toolInput = JSON.parse(args[3]);
            } catch {
              console.error("Error: Invalid JSON for tool input");
              process.exit(1);
            }
          }
          console.log(`Adding tool call '${toolName}' to session ${sessionId}...`);
          result = await addToolCall(sessionId, toolName, toolInput);
          break;
        }

        case "--add-result": {
          const toolUseId = args[2];
          const resultContent = args[3];
          if (!toolUseId || !resultContent) {
            console.error("Error: --add-result requires tool-use-id and result arguments");
            process.exit(1);
          }
          console.log(`Adding tool result for '${toolUseId}' to session ${sessionId}...`);
          result = await addToolResult(sessionId, toolUseId, resultContent);
          break;
        }

        case "--add-exchange": {
          const userMsg = args[2];
          const assistantMsg = args[3];
          if (!userMsg || !assistantMsg) {
            console.error("Error: --add-exchange requires user message and assistant message arguments");
            process.exit(1);
          }
          console.log(`Adding exchange to session ${sessionId}...`);
          result = await addExchange(sessionId, userMsg, assistantMsg);
          break;
        }

        case "--add-dsl": {
          const dsl = args[2];
          if (!dsl) {
            console.error("Error: --add-dsl requires DSL string argument");
            process.exit(1);
          }
          console.log(`Adding lines from DSL to session ${sessionId}...`);
          result = await addFromDSL(sessionId, dsl);
          break;
        }
      }

      if (result) {
        console.log("\n=== Append Result ===");
        console.log(`Success: ${result.success}`);
        console.log(`Session: ${result.sessionId}`);
        console.log(`File: ${result.filePath}`);
        console.log(`Lines Added: ${result.linesAdded}`);
        console.log(`Total Lines: ${result.totalLines}`);
        console.log(`Last Line UUID: ${result.lastLineUuid}`);

        if (result.errors.length > 0) {
          console.log("\nErrors:");
          result.errors.forEach((e: string) => console.log(`  - ${e}`));
          process.exit(1);
        }

        console.log("\n✅ Lines appended successfully");
      }

      process.exit(0);
    } catch (error) {
      console.error("Failed to append line:", error);
      process.exit(1);
    }
  }

  // Parse flags for pipeline mode
  let extend: number | undefined;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--extend" || arg === "-e") {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        extend = parseInt(nextArg, 10);
        if (isNaN(extend) || extend < 1) {
          console.error("Error: --extend requires a positive number");
          process.exit(1);
        }
        i++; // Skip the number
      } else {
        console.error("Error: --extend requires a number (e.g., --extend 3)");
        process.exit(1);
      }
    } else if (arg.startsWith("--extend=") || arg.startsWith("-e=")) {
      const value = arg.split("=")[1];
      extend = parseInt(value!, 10);
      if (isNaN(extend) || extend < 1) {
        console.error("Error: --extend requires a positive number");
        process.exit(1);
      }
    } else {
      filteredArgs.push(arg);
    }
  }

  if (filteredArgs.length < 2) {
    console.log("Fabricator - JSONL Conversation Processing Tool");
    console.log("");
    console.log("Usage:");
    console.log("  bun run src/index.ts <session-id> <topic> [options]");
    console.log("  bun run src/index.ts --to-codex <input-file> [output-dir] [--cwd <dir>]");
    console.log("  bun run src/index.ts --to-claude <input-file> [output-dir] [--cwd <dir>]");
    console.log("  bun run src/index.ts --to-gemini <input-file> [output-dir] [--cwd <dir>]");
    console.log("  bun run src/index.ts --clone-codex <session-id|file> [output-dir]");
    console.log("  bun run src/index.ts --clone-real-codex-session <session-id|file> [output-dir]");
    console.log("  bun run src/index.ts --seed-codex <session-id|file> <prompt-file> [output-dir]");
    console.log("  bun run src/index.ts --list-sessions [claude|codex|gemini]");
    console.log("  bun run src/index.ts --add-<type> <session-id> <args...>");
    console.log("");
    console.log("Pipeline Options:");
    console.log("  --extend, -e <count>  Add additional conversation exchanges");
    console.log("");
    console.log("Conversion Commands:");
    console.log("  --to-codex            Convert Claude Code or Gemini session to Codex format");
    console.log("  --to-claude           Convert Codex or Gemini session to Claude Code format");
    console.log("  --to-gemini           Convert Claude Code or Codex session to Gemini format");
    console.log("  --clone-codex         Duplicate a Codex session with a new ID");
    console.log("  --clone-real-codex-session Clone a real Codex session skeleton");
    console.log("  --seed-codex          Clone a real Codex session skeleton and replace the task turn");
    console.log("  --list-sessions       List available sessions (claude|codex|gemini)");
    console.log("");
    console.log("Line Appending Commands:");
    console.log("  --add-user            Add a user message to a session");
    console.log("  --add-assistant       Add an assistant text message to a session");
    console.log("  --add-tool            Add an assistant tool call to a session");
    console.log("  --add-result          Add a tool result to a session");
    console.log("  --add-exchange        Add a user+assistant exchange to a session");
    console.log("  --add-dsl             Add multiple lines using DSL syntax");
    console.log("");
    console.log("Examples:");
    console.log('  bun run src/index.ts abc123 "helping with TypeScript"');
    console.log('  bun run src/index.ts abc123 "helping with TypeScript" --extend 5');
    console.log("  bun run src/index.ts --to-codex ~/.claude/projects/session.jsonl --cwd $(pwd)");
    console.log("  bun run src/index.ts --to-codex ~/.gemini/tmp/project/chats/session.json --cwd $(pwd)");
    console.log("  bun run src/index.ts --to-claude ~/.codex/sessions/rollout.jsonl --cwd $(pwd)");
    console.log("  bun run src/index.ts --to-gemini ~/.codex/sessions/rollout.jsonl --cwd $(pwd)");
    console.log('  bun run src/index.ts --add-user abc123 "Hello, Claude!"');
    console.log('  bun run src/index.ts --add-tool abc123 Read \'{"file_path": "/tmp/test.txt"}\'');
    process.exit(1);
  }

  const [sessionId, ...topicParts] = filteredArgs;
  const topic = topicParts.join(" ");

  const { runPipeline, verifyPipelineOutput } = await import("./pipeline");

  try {
    const result = await runPipeline({ sessionId: sessionId!, topic, extend });

    console.log("\n=== Pipeline Result ===");
    console.log(`Original Session: ${result.originalSessionId}`);
    console.log(`Flagged Lines: [${result.flaggedLines.join(", ")}]`);
    console.log(`Final Session: ${result.finalSessionId}`);
    console.log(`Final File: ${result.finalFilePath}`);

    if (result.extended) {
      console.log(`\n=== Extended Conversation ===`);
      console.log(`Exchanges Added: ${result.extended.exchangesAdded}`);
      console.log(`Lines Added: ${result.extended.linesAdded}`);
      console.log(`Total Lines: ${result.extended.totalLines}`);
    }

    const verification = await verifyPipelineOutput(result);
    if (verification.valid) {
      console.log("\n✅ Output verified successfully");
    } else {
      console.log("\n⚠️ Verification issues:");
      verification.errors.forEach((err) => console.log(`  - ${err}`));
    }
  } catch (error) {
    console.error("Pipeline failed:", error);
    process.exit(1);
  }
}
