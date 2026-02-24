/**
 * Unit tests for dispatch config loading
 */

import { jest } from "@jest/globals";

// Mock execSync to control git remote detection
jest.mock("node:child_process", () => ({
  execSync: jest.fn(),
}));

import { loadDispatchConfig } from "../../../agent/dispatch/config.js";
import { execSync } from "node:child_process";

const mockExecSync = jest.mocked(execSync);

describe("loadDispatchConfig()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear env vars
    delete process.env.GITHUB_DELEGATE_PROVIDER;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_WORKFLOW_ID;
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_DEFAULT_BRANCH;
    delete process.env.GITHUB_REPOS;
  });

  afterEach(() => {
    // Clean up env vars after each test
    delete process.env.GITHUB_DELEGATE_PROVIDER;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_WORKFLOW_ID;
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_DEFAULT_BRANCH;
    delete process.env.GITHUB_REPOS;
  });

  test("returns null when GITHUB_DELEGATE_PROVIDER is not set", () => {
    const result = loadDispatchConfig();
    expect(result).toBeNull();
  });

  test("returns null when GITHUB_DELEGATE_PROVIDER is invalid", () => {
    process.env.GITHUB_DELEGATE_PROVIDER = "invalid";
    const result = loadDispatchConfig();
    expect(result).toBeNull();
  });

  test("returns null when required fields are missing", () => {
    process.env.GITHUB_DELEGATE_PROVIDER = "claude";
    // Missing GITHUB_TOKEN and GITHUB_WORKFLOW_ID
    const result = loadDispatchConfig();
    expect(result).toBeNull();
  });

  test("GITHUB_REPOS not set → approvedRepos equals [repo]", () => {
    process.env.GITHUB_DELEGATE_PROVIDER = "claude";
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_WORKFLOW_ID = "clanker-delegate-claude.yml";
    process.env.GITHUB_REPO = "owner/repo";
    process.env.GITHUB_DEFAULT_BRANCH = "main";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.repo).toBe("owner/repo");
      expect(result.approvedRepos).toEqual(["owner/repo"]);
    }
  });

  test("GITHUB_REPOS=owner/a,owner/b → approvedRepos = [owner/a, owner/b]", () => {
    process.env.GITHUB_DELEGATE_PROVIDER = "claude";
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_WORKFLOW_ID = "clanker-delegate-claude.yml";
    process.env.GITHUB_REPO = "owner/default";
    process.env.GITHUB_DEFAULT_BRANCH = "main";
    process.env.GITHUB_REPOS = "owner/a,owner/b";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.approvedRepos).toEqual(["owner/a", "owner/b"]);
    }
  });

  test("GITHUB_REPOS with spaces is trimmed correctly", () => {
    process.env.GITHUB_DELEGATE_PROVIDER = "claude";
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_WORKFLOW_ID = "clanker-delegate-claude.yml";
    process.env.GITHUB_REPO = "owner/default";
    process.env.GITHUB_DEFAULT_BRANCH = "main";
    process.env.GITHUB_REPOS = "owner/foo , owner/bar , owner/baz";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.approvedRepos).toEqual(["owner/foo", "owner/bar", "owner/baz"]);
    }
  });

  test("provider can be codex", () => {
    process.env.GITHUB_DELEGATE_PROVIDER = "codex";
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_WORKFLOW_ID = "clanker-delegate-codex.yml";
    process.env.GITHUB_REPO = "owner/repo";
    process.env.GITHUB_DEFAULT_BRANCH = "main";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.provider).toBe("codex");
    }
  });
});
