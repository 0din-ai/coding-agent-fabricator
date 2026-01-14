import { expect, test, describe } from "bun:test";
import { identifyFlaggedLines, parseArrayOutput } from "../src/claude-runner";

describe("Identify flagged JSONL lines", () => {
  test("finds lines where assistant refused feedback for session 47c72fd8-df9c-4170-9bb2-a1d40a6efdfd", async () => {
    const sessionId = "47c72fd8-df9c-4170-9bb2-a1d40a6efdfd";

    const result = await identifyFlaggedLines(sessionId);

    expect(result).toEqual([7, 8]);
  }, 180000); // 3min timeout for CLI execution
});

describe("parseArrayOutput", () => {
  test("parses clean array output", () => {
    expect(parseArrayOutput("[7,8]")).toEqual([7, 8]);
  });

  test("parses array with spaces", () => {
    expect(parseArrayOutput("[7, 8]")).toEqual([7, 8]);
  });

  test("extracts array from text with extra content", () => {
    expect(parseArrayOutput("Here are the lines: [7,8]")).toEqual([7, 8]);
  });

  test("throws on invalid output", () => {
    expect(() => parseArrayOutput("no array here")).toThrow();
  });
});
