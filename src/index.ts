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

// Gemini Converter exports
export {
  parseGeminiSession,
  listGeminiSessions,
  convertClaudeToGemini,
  convertClaudeFileToGemini,
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
  GeminiConversionResult,
  GeminiSessionListEntry,
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

  // Check for conversion commands first
  if (args[0] === "--to-gemini") {
    const inputFile = args[1];

    if (!inputFile) {
      console.log("Usage: bun run src/index.ts --to-gemini <input-file> [output-dir]");
      console.log("");
      console.log("Convert Claude Code or Codex session files to Gemini format.");
      console.log("");
      console.log("Examples:");
      console.log("  bun run src/index.ts --to-gemini ~/.claude/projects/-path/session.jsonl");
      console.log("  bun run src/index.ts --to-gemini ~/.claude/projects/-path/session.jsonl ~/.gemini/tmp/hash/chats/");
      process.exit(1);
    }

    const outputDir = args[2];

    const { convertClaudeFileToGemini } = await import("./gemini-converter");
    const { detectSessionFormat } = await import("./session-converter");

    try {
      const format = await detectSessionFormat(inputFile);

      if (format === "codex") {
        console.error("Error: Direct Codex → Gemini conversion not yet supported. Convert to Claude first.");
        process.exit(1);
      }

      console.log("Converting Claude Code session to Gemini format...");
      const result = await convertClaudeFileToGemini(inputFile, {
        outputDir,
      });

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
    const inputFile = args[1];

    if (!inputFile) {
      console.log(`Usage: bun run src/index.ts ${args[0]} <input-file> [output-dir]`);
      console.log("");
      console.log("Convert session files between Claude Code and Codex formats.");
      console.log("");
      console.log("Examples:");
      console.log(`  bun run src/index.ts --to-codex ~/.claude/projects/-path/session.jsonl`);
      console.log(`  bun run src/index.ts --to-claude ~/.codex/sessions/2026/01/13/rollout-xxx.jsonl`);
      process.exit(1);
    }

    const outputDir = args[2];

    const {
      convertClaudeFileToCodex,
      convertCodexFileToClaude,
      detectSessionFormat,
    } = await import("./session-converter");

    try {
      // Auto-detect format if needed
      const format = await detectSessionFormat(inputFile);

      if (isToCodex) {
        if (format === "codex") {
          console.error("Error: Input file is already in Codex format");
          process.exit(1);
        }

        console.log("Converting Claude Code session to Codex format...");
        const result = await convertClaudeFileToCodex(inputFile, {
          outputDir,
          preserveMetadata: true,
        });

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

        console.log("Converting Codex session to Claude Code format...");
        const result = await convertCodexFileToClaude(inputFile, {
          outputDir,
          generateUuids: true,
          reconstructThreading: true,
        });

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

    const { mkdir } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const { basename, dirname, join } = await import("node:path");

    const homeDir = process.env.HOME || Bun.env.HOME;
    if (!homeDir) {
      console.error("Error: HOME is not set");
      process.exit(1);
    }

    // Resolve source file path.
    let srcFilePath: string;
    if (sessionIdOrFile.includes("/") || sessionIdOrFile.endsWith(".jsonl")) {
      srcFilePath = sessionIdOrFile;
    } else {
      const sessionId = sessionIdOrFile;
      const sessionsRoot = join(homeDir, ".codex", "sessions");

      const matches: string[] = [];
      const glob1 = new Bun.Glob(`${sessionsRoot}/**/rollout-*-${sessionId}.jsonl`);
      for await (const file of glob1.scan({ absolute: true })) {
        matches.push(file);
      }

      if (matches.length === 0) {
        const glob2 = new Bun.Glob(`${sessionsRoot}/**/*${sessionId}*.jsonl`);
        for await (const file of glob2.scan({ absolute: true })) {
          matches.push(file);
        }
      }

      if (matches.length === 0) {
        console.error(`Error: Could not find Codex session file for: ${sessionId}`);
        process.exit(1);
      }

      // If multiple matches exist, pick the newest by mtime.
      let bestPath = matches[0]!;
      let bestMtime = 0;
      for (const p of matches) {
        try {
          const st = await Bun.file(p).stat();
          const mtime = st?.mtime ? st.mtime.getTime() : 0;
          if (mtime >= bestMtime) {
            bestMtime = mtime;
            bestPath = p;
          }
        } catch {
          // ignore
        }
      }

      srcFilePath = bestPath;
    }

    if (!existsSync(srcFilePath)) {
      console.error(`Error: Source file does not exist: ${srcFilePath}`);
      process.exit(1);
    }

    const srcText = await Bun.file(srcFilePath).text();
    const firstNonEmptyLine = srcText
      .split("\n")
      .find((l) => l.trim().length > 0);

    if (!firstNonEmptyLine) {
      console.error("Error: Source file is empty");
      process.exit(1);
    }

    // Determine the actual old session ID from session_meta.
    let oldSessionId = sessionIdOrFile;
    try {
      const meta = JSON.parse(firstNonEmptyLine) as Record<string, unknown>;
      const payload = meta.payload as Record<string, unknown> | undefined;
      const id = payload?.id;
      if (meta.type === "session_meta" && typeof id === "string" && id.length > 0) {
        oldSessionId = id;
      }
    } catch {
      // ignore; we'll fall back to the argument
    }

    if (typeof oldSessionId !== "string" || oldSessionId.length === 0) {
      console.error("Error: Could not determine old session ID");
      process.exit(1);
    }

    const srcDir = dirname(srcFilePath);
    const srcBase = basename(srcFilePath);

    const outputDir = outputDirArg || srcDir;
    await mkdir(outputDir, { recursive: true });

    // Generate a new ID and an unused destination path.
    let newSessionId = "";
    let destFilePath = "";
    for (let attempt = 0; attempt < 25; attempt++) {
      const candidateId = crypto.randomUUID();

      // Prefer keeping the same filename shape if it contains the old ID.
      const candidateBase = srcBase.includes(oldSessionId)
        ? srcBase.replaceAll(oldSessionId, candidateId)
        : `rollout-${new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "")}-${candidateId}.jsonl`;

      const candidatePath = join(outputDir, candidateBase);

      if (!existsSync(candidatePath)) {
        newSessionId = candidateId;
        destFilePath = candidatePath;
        break;
      }
    }

    if (!destFilePath) {
      console.error("Error: Failed to generate a unique destination file path");
      process.exit(1);
    }

    const destText = srcText.replaceAll(oldSessionId, newSessionId);
    await Bun.write(destFilePath, destText);

    // Strict JSONL validation (fail fast if any line is malformed).
    const lines = destText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      try {
        JSON.parse(line);
      } catch (e) {
        console.error(`Error: Malformed JSON on line ${i + 1}`);
        console.error(String(e));
        process.exit(1);
      }
    }

    // Verify session_meta payload.id == newSessionId.
    try {
      const meta = JSON.parse(firstNonEmptyLine) as Record<string, unknown>;
      void meta; // original meta unused (kept for clarity)
      const destFirst = destText.split("\n").find((l) => l.trim().length > 0)!;
      const destMeta = JSON.parse(destFirst) as Record<string, unknown>;
      const payload = destMeta.payload as Record<string, unknown> | undefined;
      if (destMeta.type !== "session_meta" || payload?.id !== newSessionId) {
        console.error("Error: session_meta payload.id was not updated in the cloned file");
        process.exit(1);
      }
    } catch {
      console.error("Error: Failed to validate cloned session_meta");
      process.exit(1);
    }

    if (destText.includes(oldSessionId)) {
      console.error("Error: Old session ID still present in cloned file");
      process.exit(1);
    }

    console.log("=== Clone Result ===");
    console.log(`Source: ${srcFilePath}`);
    console.log(`Destination: ${destFilePath}`);
    console.log(`Old ID: ${oldSessionId}`);
    console.log(`New ID: ${newSessionId}`);
    console.log("");
    console.log("✅ Codex session cloned successfully");
    process.exit(0);
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
    console.log("  bun run src/index.ts --to-codex <input-file> [output-dir]");
    console.log("  bun run src/index.ts --to-claude <input-file> [output-dir]");
    console.log("  bun run src/index.ts --clone-codex <session-id|file> [output-dir]");
    console.log("  bun run src/index.ts --list-sessions [claude|codex]");
    console.log("  bun run src/index.ts --add-<type> <session-id> <args...>");
    console.log("");
    console.log("Pipeline Options:");
    console.log("  --extend, -e <count>  Add additional conversation exchanges");
    console.log("");
    console.log("Conversion Commands:");
    console.log("  --to-codex            Convert Claude Code session to Codex format");
    console.log("  --to-claude           Convert Codex session to Claude Code format");
    console.log("  --to-gemini           Convert Claude Code session to Gemini format");
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
    console.log("  bun run src/index.ts --to-codex ~/.claude/projects/session.jsonl");
    console.log("  bun run src/index.ts --to-claude ~/.codex/sessions/rollout.jsonl");
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
