import { expect, test, describe } from "bun:test";
import { runPipeline, verifyPipelineOutput } from "../src/index";

describe("Fabricator exports", () => {
  test("runPipeline function exists", () => {
    expect(typeof runPipeline).toBe("function");
  });

  test("verifyPipelineOutput function exists", () => {
    expect(typeof verifyPipelineOutput).toBe("function");
  });
});
