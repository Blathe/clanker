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
    delete process.env.GH_DELEGATE_PROVIDER;
    delete process.env.GH_TOKEN;
    delete process.env.GH_WORKFLOW_ID;
    delete process.env.GH_REPO;
    delete process.env.GH_DEFAULT_BRANCH;
    delete process.env.GH_REPOS;
  });

  afterEach(() => {
    // Clean up env vars after each test
    delete process.env.GH_DELEGATE_PROVIDER;
    delete process.env.GH_TOKEN;
    delete process.env.GH_WORKFLOW_ID;
    delete process.env.GH_REPO;
    delete process.env.GH_DEFAULT_BRANCH;
    delete process.env.GH_REPOS;
  });

  test("returns null when GH_DELEGATE_PROVIDER is not set", () => {
    const result = loadDispatchConfig();
    expect(result).toBeNull();
  });

  test("returns null when GH_DELEGATE_PROVIDER is invalid", () => {
    process.env.GH_DELEGATE_PROVIDER = "invalid";
    const result = loadDispatchConfig();
    expect(result).toBeNull();
  });

  test("returns null when required fields are missing", () => {
    process.env.GH_DELEGATE_PROVIDER = "claude";
    // Missing GH_TOKEN and GH_WORKFLOW_ID
    const result = loadDispatchConfig();
    expect(result).toBeNull();
  });

  test("GH_REPOS not set → approvedRepos equals [repo]", () => {
    process.env.GH_DELEGATE_PROVIDER = "claude";
    process.env.GH_TOKEN = "ghp_test";
    process.env.GH_WORKFLOW_ID = "clanker-delegate-claude.yml";
    process.env.GH_REPO = "owner/repo";
    process.env.GH_DEFAULT_BRANCH = "main";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.repo).toBe("owner/repo");
      expect(result.approvedRepos).toEqual(["owner/repo"]);
    }
  });

  test("GH_REPOS=owner/a,owner/b → approvedRepos = [owner/a, owner/b]", () => {
    process.env.GH_DELEGATE_PROVIDER = "claude";
    process.env.GH_TOKEN = "ghp_test";
    process.env.GH_WORKFLOW_ID = "clanker-delegate-claude.yml";
    process.env.GH_REPO = "owner/default";
    process.env.GH_DEFAULT_BRANCH = "main";
    process.env.GH_REPOS = "owner/a,owner/b";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.approvedRepos).toEqual(["owner/a", "owner/b"]);
    }
  });

  test("GH_REPOS with spaces is trimmed correctly", () => {
    process.env.GH_DELEGATE_PROVIDER = "claude";
    process.env.GH_TOKEN = "ghp_test";
    process.env.GH_WORKFLOW_ID = "clanker-delegate-claude.yml";
    process.env.GH_REPO = "owner/default";
    process.env.GH_DEFAULT_BRANCH = "main";
    process.env.GH_REPOS = "owner/foo , owner/bar , owner/baz";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.approvedRepos).toEqual(["owner/foo", "owner/bar", "owner/baz"]);
    }
  });

  test("provider can be codex", () => {
    process.env.GH_DELEGATE_PROVIDER = "codex";
    process.env.GH_TOKEN = "ghp_test";
    process.env.GH_WORKFLOW_ID = "clanker-delegate-codex.yml";
    process.env.GH_REPO = "owner/repo";
    process.env.GH_DEFAULT_BRANCH = "main";
    mockExecSync.mockReturnValue("");

    const result = loadDispatchConfig();
    expect(result).not.toBeNull();
    if (result) {
      expect(result.provider).toBe("codex");
    }
  });
});
