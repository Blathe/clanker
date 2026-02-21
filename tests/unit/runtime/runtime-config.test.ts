import { buildRuntimeConfig, validateRuntimeConfigEnv } from "../../../src/runtimeConfig.js";

describe("runtimeConfig", () => {
  test("buildRuntimeConfig returns defaults when no overrides are set", () => {
    const cfg = buildRuntimeConfig({});
    expect(cfg.openAiModel).toBe("gpt-4o");
    expect(cfg.openAiMaxTokens).toBe(1024);
    expect(cfg.maxHistory).toBe(50);
    expect(cfg.maxSessions).toBe(100);
    expect(cfg.maxUserInput).toBe(8000);
    expect(cfg.maxCommandLength).toBe(10000);
    expect(cfg.maxOutputBytes).toBe(512 * 1024);
    expect(cfg.maxActionsPerTurn).toBe(8);
    expect(cfg.queueMaxConcurrentJobs).toBe(10);
    expect(cfg.delegateProposalTtlMs).toBe(15 * 60 * 1000);
    expect(cfg.delegateDiffPreviewMaxLines).toBe(80);
    expect(cfg.delegateDiffPreviewMaxChars).toBe(3000);
    expect(cfg.delegateFileDiffMaxLines).toBe(120);
    expect(cfg.delegateFileDiffMaxChars).toBe(1400);
    expect(cfg.loggerMaxOut).toBe(500);
    expect(cfg.loggerMaxCmd).toBe(200);
    expect(cfg.loggerMaxMsg).toBe(300);
  });

  test("buildRuntimeConfig applies valid numeric overrides", () => {
    const cfg = buildRuntimeConfig({
      CLANKER_OPENAI_MODEL: "gpt-4.1-mini",
      CLANKER_OPENAI_MAX_TOKENS: "2048",
      CLANKER_MAX_HISTORY: "60",
      CLANKER_MAX_SESSIONS: "120",
      CLANKER_MAX_USER_INPUT: "12000",
      CLANKER_MAX_COMMAND_LENGTH: "15000",
      CLANKER_MAX_OUTPUT_BYTES: "262144",
      CLANKER_QUEUE_MAX_CONCURRENT_JOBS: "3",
      CLANKER_DELEGATE_PROPOSAL_TTL_MS: "1800000",
      CLANKER_DELEGATE_DIFF_PREVIEW_MAX_LINES: "100",
      CLANKER_DELEGATE_DIFF_PREVIEW_MAX_CHARS: "4096",
      CLANKER_DELEGATE_FILE_DIFF_MAX_LINES: "150",
      CLANKER_DELEGATE_FILE_DIFF_MAX_CHARS: "2048",
      CLANKER_LOGGER_MAX_OUT: "600",
      CLANKER_LOGGER_MAX_CMD: "250",
      CLANKER_LOGGER_MAX_MSG: "400",
    });

    expect(cfg.openAiModel).toBe("gpt-4.1-mini");
    expect(cfg.openAiMaxTokens).toBe(2048);
    expect(cfg.maxHistory).toBe(60);
    expect(cfg.maxSessions).toBe(120);
    expect(cfg.maxUserInput).toBe(12000);
    expect(cfg.maxCommandLength).toBe(15000);
    expect(cfg.maxOutputBytes).toBe(262144);
    expect(cfg.queueMaxConcurrentJobs).toBe(3);
    expect(cfg.delegateProposalTtlMs).toBe(1800000);
    expect(cfg.delegateDiffPreviewMaxLines).toBe(100);
    expect(cfg.delegateDiffPreviewMaxChars).toBe(4096);
    expect(cfg.delegateFileDiffMaxLines).toBe(150);
    expect(cfg.delegateFileDiffMaxChars).toBe(2048);
    expect(cfg.loggerMaxOut).toBe(600);
    expect(cfg.loggerMaxCmd).toBe(250);
    expect(cfg.loggerMaxMsg).toBe(400);
  });

  test("buildRuntimeConfig throws when overrides are invalid", () => {
    expect(() =>
      buildRuntimeConfig({
        CLANKER_MAX_HISTORY: "zero",
        CLANKER_MAX_OUTPUT_BYTES: "-1",
      })
    ).toThrow("Invalid runtime configuration");
  });

  test("validateRuntimeConfigEnv returns all validation errors", () => {
    const errors = validateRuntimeConfigEnv({
      CLANKER_MAX_HISTORY: "nope",
      CLANKER_MAX_SESSIONS: "0",
      CLANKER_OPENAI_MAX_TOKENS: "-5",
    });

    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.join("\n")).toContain("CLANKER_MAX_HISTORY");
    expect(errors.join("\n")).toContain("CLANKER_MAX_SESSIONS");
    expect(errors.join("\n")).toContain("CLANKER_OPENAI_MAX_TOKENS");
  });
});
