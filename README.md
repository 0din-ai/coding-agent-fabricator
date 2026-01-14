# Fabricator

A comprehensive JSONL conversation processing toolkit for Claude Code sessions. Built with Bun and TypeScript.

## Features

- **Conversation Pipeline**: Process Claude JSONL files to identify, remove, and replace content
- **Session Conversion**: Bidirectional conversion between Claude Code and OpenAI Codex formats
- **Codex Session Cloning**: Duplicate a Codex session file with a new session ID
- **Line Appending**: Programmatically add new conversation lines to existing sessions
- **Conversation Extension**: Automatically extend conversations with additional exchanges

## Installation

```bash
# Clone the repository
git clone https://github.com/0din-ai/coding-agent-fabricator
cd coding-agent-fabricator

# Install dependencies
bun install
```

## Quick Start

```bash
# Run the pipeline
bun run src/index.ts <session-id> "<topic>"

# Convert sessions
bun run src/index.ts --to-codex <claude-session-file>
bun run src/index.ts --to-claude <codex-session-file>

# Clone a Codex session (duplicate with new ID)
bun run src/index.ts --clone-codex <session-id|codex-session-file> [output-dir]

# Add lines to a session
bun run src/index.ts --add-user <session-id> "Hello!"

# List available sessions
bun run src/index.ts --list-sessions
```

---

## 1. Conversation Pipeline

The core pipeline processes Claude conversation JSONL files to:
1. Identify lines where the assistant refused to help
2. Remove the flagged refusal content
3. Replace with helpful content based on a specified topic

### Basic Usage

```bash
bun run src/index.ts <session-id> "<topic>"
```

### Examples

```bash
# Process a session about TypeScript
bun run src/index.ts abc123def "helping with TypeScript development"

# Process a session about Python data analysis
bun run src/index.ts my-session-456 "assisting with Python data analysis"

# Process with conversation extension (adds 5 more exchanges)
bun run src/index.ts abc123def "helping with TypeScript" --extend 5
```

### Pipeline Output

```
=== Pipeline Result ===
Original Session: abc123def
Flagged Lines: [3, 7, 12]
Final Session: new-session-uuid
Final File: /path/to/new/session.jsonl

=== Extended Conversation ===
Exchanges Added: 5
Lines Added: 10
Total Lines: 25

✅ Output verified successfully
```

### Programmatic Usage

```typescript
import { runPipeline, verifyPipelineOutput } from "fabricator";

const result = await runPipeline({
  sessionId: "abc123def",
  topic: "helping with TypeScript development",
  extend: 3, // Optional: add 3 more exchanges
});

console.log(`Processed session: ${result.finalSessionId}`);
console.log(`Flagged lines removed: ${result.flaggedLines.length}`);

// Verify the output
const verification = await verifyPipelineOutput(result);
if (verification.valid) {
  console.log("Output verified successfully");
}
```

---

## 2. Session Conversion

Convert session files between Claude Code (`~/.claude/projects/`) and OpenAI Codex (`~/.codex/sessions/`) formats.

### Convert Claude to Codex

```bash
bun run src/index.ts --to-codex <input-file> [output-dir]
```

#### Examples

```bash
# Convert a Claude session to Codex format
bun run src/index.ts --to-codex ~/.claude/projects/-Users-me-myproject/abc123.jsonl

# Specify output directory
bun run src/index.ts --to-codex ~/.claude/projects/-path/session.jsonl ./converted/
```

### Convert Codex to Claude

```bash
bun run src/index.ts --to-claude <input-file> [output-dir]
```

#### Examples

```bash
# Convert a Codex session to Claude format
bun run src/index.ts --to-claude ~/.codex/sessions/2025/01/13/rollout-abc.jsonl

# Specify output directory
bun run src/index.ts --to-claude ~/.codex/sessions/2025/01/13/rollout-abc.jsonl ./converted/
```

### List Available Sessions

```bash
# List all sessions (both formats)
bun run src/index.ts --list-sessions

# List only Claude sessions
bun run src/index.ts --list-sessions claude

# List only Codex sessions
bun run src/index.ts --list-sessions codex
```

### Clone a Codex Session (New Session ID)

Duplicate a Codex session JSONL file while replacing the session ID everywhere in the output.

```bash
bun run src/index.ts --clone-codex <session-id|codex-session-file> [output-dir]

# By session id (auto-finds the matching file under ~/.codex/sessions/)
bun run src/index.ts --clone-codex 019c5206-501a-7b91-870e-587193d6f7be

# By explicit file path
bun run src/index.ts --clone-codex ~/.codex/sessions/2026/02/12/rollout-2026-02-12T07-24-31-019c5206-501a-7b91-870e-587193d6f7be.jsonl

# Optional output directory (defaults to the source file directory)
bun run src/index.ts --clone-codex 019c5206-501a-7b91-870e-587193d6f7be ~/.codex/sessions/2026/02/14/
```

### Conversion Output

```
Converting Claude Code session to Codex format...

=== Conversion Result ===
Success: true
Output: /path/to/output/rollout-1705123456-abc123.jsonl
Records Converted: 45
Messages Converted: 23
Tool Calls Converted: 12

✅ Conversion completed successfully
```

### Programmatic Usage

```typescript
import {
  parseClaudeSession,
  parseCodexSession,
  convertClaudeToCodex,
  convertCodexToClaude,
  convertClaudeFileToCodex,
  convertCodexFileToClaude,
  detectSessionFormat,
  listClaudeSessions,
  listCodexSessions,
} from "fabricator";

// Detect session format automatically
const format = await detectSessionFormat("/path/to/session.jsonl");
console.log(`Detected format: ${format}`); // "claude" or "codex"

// List available sessions
const claudeSessions = await listClaudeSessions();
const codexSessions = await listCodexSessions();

// Parse sessions
const claudeSession = await parseClaudeSession("/path/to/claude/session.jsonl");
const codexSession = await parseCodexSession("/path/to/codex/session.jsonl");

// Convert in memory
const codexOutput = convertClaudeToCodex(claudeSession, {
  preserveMetadata: true,
  model: "gpt-5.2-codex",
});

const claudeOutput = convertCodexToClaude(codexSession, {
  generateUuids: true,
  reconstructThreading: true,
});

// Convert files directly
const result1 = await convertClaudeFileToCodex("/path/to/claude/session.jsonl", {
  outputDir: "./output",
  preserveMetadata: true,
});

const result2 = await convertCodexFileToClaude("/path/to/codex/session.jsonl", {
  outputDir: "./output",
  generateUuids: true,
  reconstructThreading: true,
});
```

### Format Mapping Reference

| Claude Code Type | Codex Equivalent |
|-----------------|------------------|
| `user` | `response_item` (message, role: user) + `event_msg` (user_message) |
| `assistant` | `response_item` (message, role: assistant) + `event_msg` (agent_message) |
| `tool_use` | `response_item` (function_call) |
| `tool_result` | `response_item` (function_call_output) |
| `thinking` | `response_item` (reasoning) - *encrypted in Codex* |
| `summary` | *No direct equivalent* |

---

## 3. Session Line Appender

Add new conversation lines to existing Claude Code sessions. Supports user messages, assistant responses, tool calls, and tool results.

### CLI Commands

#### Add User Message

```bash
bun run src/index.ts --add-user <session-id> "<text>"
```

**Examples:**

```bash
bun run src/index.ts --add-user abc123 "Hello, Claude!"
bun run src/index.ts --add-user abc123 "Can you help me with a TypeScript question?"
bun run src/index.ts --add-user abc123 "What is the best way to handle async errors?"
```

#### Add Assistant Message

```bash
bun run src/index.ts --add-assistant <session-id> "<text>"
```

**Examples:**

```bash
bun run src/index.ts --add-assistant abc123 "Of course! I'd be happy to help."
bun run src/index.ts --add-assistant abc123 "TypeScript provides several ways to handle async errors..."
```

#### Add Tool Call

```bash
bun run src/index.ts --add-tool <session-id> <tool-name> ['{"input": "json"}']
```

**Examples:**

```bash
# Add a Read tool call
bun run src/index.ts --add-tool abc123 Read '{"file_path": "/tmp/test.txt"}'

# Add a Bash tool call
bun run src/index.ts --add-tool abc123 Bash '{"command": "ls -la"}'

# Add a Grep tool call
bun run src/index.ts --add-tool abc123 Grep '{"pattern": "TODO", "path": "./src"}'

# Add a Write tool call
bun run src/index.ts --add-tool abc123 Write '{"file_path": "/tmp/output.txt", "content": "Hello World"}'

# Tool call without input
bun run src/index.ts --add-tool abc123 TodoRead
```

#### Add Tool Result

```bash
bun run src/index.ts --add-result <session-id> <tool-use-id> "<result>"
```

**Examples:**

```bash
bun run src/index.ts --add-result abc123 toolu_abc123 "File contents here..."
bun run src/index.ts --add-result abc123 toolu_xyz789 "Command completed successfully"
```

#### Add Full Exchange

```bash
bun run src/index.ts --add-exchange <session-id> "<user-message>" "<assistant-message>"
```

**Examples:**

```bash
bun run src/index.ts --add-exchange abc123 "What is TypeScript?" "TypeScript is a typed superset of JavaScript."
bun run src/index.ts --add-exchange abc123 "How do I create a React component?" "Here's how to create a functional React component..."
```

#### Add from DSL

```bash
bun run src/index.ts --add-dsl <session-id> "<dsl-string>"
```

**DSL Syntax:**

```
user: "message text"
assistant: "response text"
tool: ToolName {"input": "value"}
result: "output text"
```

**Examples:**

```bash
# Add a simple exchange
bun run src/index.ts --add-dsl abc123 'user: "Hello"
assistant: "Hi there!"'

# Add a tool interaction
bun run src/index.ts --add-dsl abc123 'tool: Read {"file_path": "/tmp/test.txt"}
result: "File contents here"'

# Add a complete conversation flow
bun run src/index.ts --add-dsl abc123 'user: "Read the config file"
assistant: "I will read the config file for you."
tool: Read {"file_path": "./config.json"}
result: "{\"debug\": true}"
assistant: "The config file contains debug mode enabled."'
```

### Append Output

```
Adding user message to session abc123...

=== Append Result ===
Success: true
Session: abc123
File: /Users/me/.claude/projects/-path/abc123.jsonl
Lines Added: 1
Total Lines: 15
Last Line UUID: f47ac10b-58cc-4372-a567-0e02b2c3d479

✅ Lines appended successfully
```

### Programmatic Usage

```typescript
import {
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
} from "fabricator";

// Add a single user message
const result1 = await addUserMessage("session-id", "Hello, Claude!");

// Add an assistant response
const result2 = await addAssistantMessage("session-id", "Hello! How can I help?");

// Add a tool call
const result3 = await addToolCall("session-id", "Read", {
  file_path: "/tmp/test.txt",
});

// Add a tool result
const result4 = await addToolResult(
  "session-id",
  "toolu_abc123",
  "File contents here..."
);

// Add a complete tool interaction (call + result)
const result5 = await addToolInteraction(
  "session-id",
  "Bash",
  { command: "ls -la" },
  "total 32\ndrwxr-xr-x  5 user  staff  160 Jan 13 10:00 ."
);

// Add a full exchange (user question + assistant response)
const result6 = await addExchange(
  "session-id",
  "What is TypeScript?",
  "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript."
);

// Add multiple lines at once
const result7 = await appendMultipleLines({
  sessionId: "session-id",
  contents: [
    { type: "user", text: "Can you read this file?" },
    { type: "assistant-tool", toolName: "Read", toolInput: { file_path: "./test.txt" } },
    { type: "tool-result", toolResult: "File contents here" },
    { type: "assistant-text", text: "The file contains: File contents here" },
  ],
});

// Parse and add from DSL
const dsl = `
  user: "Hello"
  assistant: "Hi there!"
  tool: Read {"file_path": "/tmp/test.txt"}
  result: "File contents"
`;

const contents = parseDSL(dsl);
const result8 = await addFromDSL("session-id", dsl);

// Using filePath option for direct file access
const result9 = await addUserMessage("session-id", "Hello", {
  filePath: "/path/to/session.jsonl",
});

// Creating a new session from existing
const result10 = await addUserMessage("session-id", "Hello", {
  createNew: true, // Creates a copy with new session ID
});
```

### Line Types Reference

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `user` | User message | `text` |
| `assistant-text` | Assistant text response | `text` |
| `assistant-tool` | Assistant tool call | `toolName`, optional `toolInput` |
| `tool-result` | Tool execution result | `toolUseId` or previous tool call, `toolResult` |

---

## 4. Conversation Extension

Extend existing conversations with additional exchanges using the `--extend` flag.

### CLI Usage

```bash
bun run src/index.ts <session-id> "<topic>" --extend <count>
# or
bun run src/index.ts <session-id> "<topic>" -e <count>
```

### Examples

```bash
# Add 3 more exchanges
bun run src/index.ts abc123 "helping with TypeScript" --extend 3

# Add 10 more exchanges
bun run src/index.ts abc123 "assisting with Python" -e 10

# Using equals syntax
bun run src/index.ts abc123 "helping with React" --extend=5
```

### Programmatic Usage

```typescript
import { extendConversation } from "fabricator";

const result = await extendConversation({
  sessionId: "abc123",
  topic: "helping with TypeScript development",
  count: 5, // Number of exchanges to add
});

console.log(`Added ${result.exchangesAdded} exchanges`);
console.log(`Total lines: ${result.totalLines}`);
```

---

## 5. Low-Level JSONL Processing

Access low-level JSONL processing functions for custom workflows.

```typescript
import {
  findJsonlFile,
  readJsonlFile,
  writeJsonlFile,
  getJsonlLines,
  removeFlaggedLines,
  updateJsonlLines,
  generateUUID,
  sanitizeJsonlEntry,
  replaceSessionId,
} from "fabricator";

// Find a session file by ID
const filePath = await findJsonlFile("session-id");

// Read JSONL file
const lines = await readJsonlFile("/path/to/session.jsonl");

// Write JSONL file
await writeJsonlFile("/path/to/output.jsonl", lines);

// Get lines from a session
const sessionLines = await getJsonlLines("session-id");

// Remove specific lines
const result = await removeFlaggedLines("session-id", [3, 7, 12]);

// Update lines with new content
const updateResult = await updateJsonlLines(
  "session-id",
  [3, 7, 12],
  "helping with TypeScript"
);

// Generate a new UUID
const uuid = generateUUID();

// Sanitize a JSONL entry
const sanitized = sanitizeJsonlEntry(entry);

// Replace session ID in content
const newContent = replaceSessionId(content, "old-id", "new-id");
```

---

## 6. Claude Integration

Use Claude to identify flagged lines and generate content.

```typescript
import {
  identifyFlaggedLines,
  runClaude,
  parseArrayOutput,
} from "fabricator";

// Identify lines where assistant refused
const flaggedLines = await identifyFlaggedLines(sessionContent);

// Run Claude with a custom prompt
const response = await runClaude("Your prompt here");

// Parse array output from Claude
const numbers = parseArrayOutput("[1, 2, 3]"); // Returns [1, 2, 3]
```

---

## CLI Reference

### All Commands

```bash
# Pipeline (main functionality)
bun run src/index.ts <session-id> <topic> [options]

# Session Conversion
bun run src/index.ts --to-codex <input-file> [output-dir]
bun run src/index.ts --to-claude <input-file> [output-dir]
bun run src/index.ts --clone-codex <session-id|codex-session-file> [output-dir]
bun run src/index.ts --list-sessions [claude|codex]

# Line Appending
bun run src/index.ts --add-user <session-id> "<text>"
bun run src/index.ts --add-assistant <session-id> "<text>"
bun run src/index.ts --add-tool <session-id> <tool-name> ['{"input": "json"}']
bun run src/index.ts --add-result <session-id> <tool-use-id> "<result>"
bun run src/index.ts --add-exchange <session-id> "<user-msg>" "<assistant-msg>"
bun run src/index.ts --add-dsl <session-id> "<dsl-string>"
```

### Pipeline Options

| Option | Description |
|--------|-------------|
| `--extend <n>`, `-e <n>` | Add N additional conversation exchanges |

### Conversion Commands

| Command | Description |
|---------|-------------|
| `--to-codex` | Convert Claude Code session to Codex format |
| `--to-claude` | Convert Codex session to Claude Code format |
| `--clone-codex` | Clone a Codex session to a new session ID |
| `--list-sessions` | List available sessions |

### Line Appending Commands

| Command | Description |
|---------|-------------|
| `--add-user` | Add a user message to a session |
| `--add-assistant` | Add an assistant text message to a session |
| `--add-tool` | Add an assistant tool call to a session |
| `--add-result` | Add a tool result to a session |
| `--add-exchange` | Add a user+assistant exchange to a session |
| `--add-dsl` | Add multiple lines using DSL syntax |

---

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/session-line-appender.test.ts
bun test tests/session-converter.test.ts
bun test tests/pipeline.test.ts

# Run tests with coverage
bun test --coverage
```

### Test Summary

- **69 tests** across 7 test files
- **222 assertions**
- Covers pipeline, conversion, and line appending functionality

---

## Project Structure

```
fabricator/
├── src/
│   ├── index.ts                 # Main entry point and CLI
│   ├── pipeline.ts              # Core pipeline logic
│   ├── claude-runner.ts         # Claude API integration
│   ├── jsonl-processor.ts       # JSONL file operations
│   ├── conversation-extender.ts # Conversation extension
│   ├── session-converter.ts     # Session format conversion
│   └── session-line-appender.ts # Line appending functionality
├── tests/
│   ├── index.test.ts
│   ├── pipeline.test.ts
│   ├── identify-flagged-lines.test.ts
│   ├── remove-flagged-lines.test.ts
│   ├── update-jsonl-lines.test.ts
│   ├── session-converter.test.ts
│   └── session-line-appender.test.ts
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HOME` | Home directory for session lookup | System default |
| `ANTHROPIC_API_KEY` | API key for Claude integration | Required for pipeline |

---

## API Reference

### Types

```typescript
// Pipeline Types
interface PipelineInput {
  sessionId: string;
  topic: string;
  extend?: number;
}

interface PipelineResult {
  originalSessionId: string;
  flaggedLines: number[];
  finalSessionId: string;
  finalFilePath: string;
  extended?: {
    exchangesAdded: number;
    linesAdded: number;
    totalLines: number;
  };
}

// Converter Types
interface ClaudeSession {
  path: string;
  sessionId: string;
  records: ClaudeRecord[];
  metadata: SessionMetadata;
}

interface CodexSession {
  path: string;
  sessionId: string;
  records: CodexRecord[];
  metadata: SessionMetadata;
}

interface ConversionResult {
  success: boolean;
  outputPath: string;
  statistics: {
    recordsConverted: number;
    messagesConverted: number;
    toolCallsConverted: number;
  };
  warnings: string[];
  errors: string[];
}

// Line Appender Types
type LineType = "user" | "assistant-text" | "assistant-tool" | "tool-result";

interface LineContent {
  type: LineType;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  toolResult?: string | Record<string, unknown>;
}

interface AppendLineOptions {
  sessionId: string;
  content: LineContent;
  createNew?: boolean;
  filePath?: string;
}

interface AppendMultipleLinesOptions {
  sessionId: string;
  contents: LineContent[];
  createNew?: boolean;
  filePath?: string;
}

interface AppendResult {
  success: boolean;
  sessionId: string;
  filePath: string;
  linesAdded: number;
  totalLines: number;
  lastLineUuid: string;
  errors: string[];
}

interface ConvenienceOptions {
  createNew?: boolean;
  filePath?: string;
}
```

---

## License

MIT

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `bun test`
5. Submit a pull request
