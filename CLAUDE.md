# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Clanker

A security-focused TypeScript CLI agent built on OpenAI's GPT-4o. Accepts user chat messages, sends them to an LLM (OpenAI GPT-4o), and intercepts every proposed action through a Policy Gate before execution. Supports multiple transports: interactive REPL and Discord. Complex programming tasks can be delegated by triggering a GitHub Actions `workflow_dispatch` event; the workflow runs Claude Code or Codex on GitHub's infrastructure and opens a PR.

## Commands

```bash
npm start          # Run the agent (requires OPENAI_API_KEY env var)
npm run dev        # Run with file-watching (requires --env-file-if-exists=.env)
npm run doctor     # Validate configuration before startup
npm test           # Run all unit tests
npm run test:watch # Run tests in watch mode
npm run test:coverage # Generate coverage report
npx tsc --noEmit   # Type-check without emitting files
```

## Development Workflow (Required)

**All new features and changes must follow Test-Driven Development (TDD):**

### Step 1: Discuss Expected Outcome
Before any code is written, discuss the requirements and expected behavior:
- What is the feature supposed to do?
- What are the edge cases and error conditions?
- How should it integrate with existing code?
- What are the security implications?

### Step 2: Write Unit Tests
Write tests **before** implementing the feature:
1. Create test file in `tests/unit/[feature]/[feature].test.ts`
2. Write test cases covering:
   - Happy path (expected behavior)
   - Edge cases (boundary conditions)
   - Error cases (invalid inputs, failures)
   - Security cases (where applicable)
3. Tests should fail initially (you're writing tests for code that doesn't exist yet)

**Test File Checklist:**
- [ ] Test file created with `.test.ts` extension
- [ ] Test cases written with descriptive names
- [ ] Edge cases and error conditions covered
- [ ] Tests currently fail (red state)

### Step 3: Implement the Feature
Once tests are written, implement the feature to make tests pass:
1. Write the minimal code needed to pass tests
2. Follow existing code style and patterns
3. Add inline comments only for non-obvious logic
4. Do not add unnecessary features or "improvements"

### Step 4: Run Tests
After implementation, always verify:
```bash
npm test              # Run all tests — must pass
npm run test:watch   # Optional: watch mode during development
npm run test:coverage # Check coverage on critical paths
```

**Pre-commit Checklist:**
- [ ] All tests pass (`npm test` exits with code 0)
- [ ] No broken existing tests
- [ ] New tests for new functionality
- [ ] Type checking passes (`npx tsc --noEmit`)

### Why This Matters
- **Security-First:** Tests catch vulnerabilities before deployment
- **Regression Prevention:** Tests verify nothing breaks when changing code
- **Documentation:** Tests serve as executable requirements
- **Confidence:** Tests prove the code works as intended

## Architecture

```
agent/
  types.ts          # Shared interfaces (ExecuteCommandInput, PolicyVerdict, LLMResponse, etc.)
  policy.ts         # Policy gate: evaluate(command) → PolicyVerdict, verifySecret()
  executor.ts       # runCommand() via spawnSync bash -c, applyEdit(), formatResult()
  llm.ts            # OpenAI SDK wrapper (gpt-4o), callLLM()
  logger.ts         # Session event logging: initLogger(), logUserInput(), logLLMResponse(), etc.
  main.ts           # Entry point: transport orchestration, session state, processTurn()
  context.ts        # Builds system prompt: loadSoul(), loadMemory(), loadLastSession()
  runtime.ts        # Shared types: Channel, SendFn, ProcessTurn
  config.ts         # Env var parsing: getEnv(), envFlagEnabled(), parseTransportsDetailed(), etc.
  doctor.ts         # Config validator — checks all env vars, exits 1 on failure
  turnHandlers.ts   # Modular action handlers: handleTurnAction() dispatches by LLMResponse.type
  dispatch/
    types.ts        # DispatchConfig, DispatchResult interfaces
    config.ts       # loadDispatchConfig() — reads GITHUB_DELEGATE_PROVIDER, GITHUB_TOKEN, etc.
    dispatcher.ts   # dispatchWorkflow() — POSTs workflow_dispatch to GitHub Actions API
    poller.ts       # startPrPoller() — polls for opened PR and notifies user
  transports/
    repl.ts         # Interactive REPL transport (/help, /clear, /exit slash commands)
    discord.ts      # Discord bot transport (discord.js)
config/
  SOUL.md           # Agent personality — loaded at startup, prepended to system prompt
memory/
  MEMORY.md         # Persistent agent memory — injected into system prompt each session
policies/
  policy.json       # Rule definitions (first-match wins, default: block)
audit/              # JSONL session logs (git-ignored)
skills/             # Markdown runbooks (future)
cron/               # Cron job definitions (future)
```

## LLM Response Types

The LLM must return one of four JSON shapes (`LLMResponse` in `types.ts`):

| type | fields | effect |
|------|--------|--------|
| `command` | `command`, `working_dir?`, `explanation` | Runs a shell command through the policy gate |
| `edit` | `file`, `old`, `new`, `explanation` | Replaces exact text in a file (requires passphrase unless Discord unsafe mode) |
| `delegate` | `prompt`, `working_dir?`, `explanation` | Triggers a GitHub Actions `workflow_dispatch` event; the workflow runs Claude Code or Codex on GitHub's infrastructure and opens a PR; Clanker polls for the PR and notifies the user with a link (requires `GITHUB_DELEGATE_PROVIDER`, `GITHUB_TOKEN`, `GITHUB_WORKFLOW_ID`) |
| `message` | `explanation` | Replies with text only, no action |

## Policy Rules (policy.json)

Rules are evaluated in order; first match wins. Default is `"block"` (deny by default).

| id | pattern | action |
|----|---------|--------|
| `allow-curl` | curl (without command chaining) | allowed |
| `block-network` | wget, nc, ssh, scp | blocked |
| `block-rm-rf` | `rm -rf` patterns | blocked |
| `secret-for-write` | tee, mv, cp, mkdir, touch, chmod, dd, sed, redirects | requires passphrase |
| `allow-git-remote-v` | `git remote -v` exactly | allowed |
| `allow-reads` | ls, cat, head, tail, grep, find, pwd, echo, which, env | allowed |
| `blocked-shell-commands` | ps | blocked |

Default passphrase: `mypassphrase`

To generate a new hash: `node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update('yourpassphrase').digest('hex'))"`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT-4o (must start with `sk-`) |
| `CLANKER_TRANSPORTS` | No | Comma-separated: `repl`, `discord` (default: both) |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token; absence disables Discord transport |
| `DISCORD_ALLOWED_USER_IDS` | No | Comma-separated Discord snowflake IDs; empty = any user |
| `DISCORD_ALLOWED_CHANNEL_IDS` | No | Comma-separated Discord snowflake IDs; empty = any channel |
| `DISCORD_UNSAFE_ENABLE_WRITES` | No | `1`/`true` = Discord can trigger write/delegate actions (dangerous) |
| `GITHUB_DELEGATE_PROVIDER` | For delegation | `claude` or `codex`; enables `delegate` action via GitHub Actions |
| `GITHUB_TOKEN` | For delegation | GitHub PAT with `contents:write` and `pull-requests:write` scope |
| `GITHUB_REPO` | No | `owner/repo` override; auto-detected from `git remote get-url origin` if omitted |
| `GITHUB_WORKFLOW_ID` | For delegation | Workflow filename, e.g. `clanker-delegate-claude.yml` |
| `GITHUB_DEFAULT_BRANCH` | No | Branch to dispatch workflow on (default: `main`) |
| `SHELL_BIN` | No | Override shell for command execution (default: bash, or Git Bash on Windows) |
| `CLANKER_*` runtime tuning overrides | No | Optional numeric limits (history, poll intervals, logger caps, OpenAI model/tokens); validated by `npm run doctor` |

## Transports

- **REPL** — requires interactive TTY (`process.stdin.isTTY && process.stdout.isTTY`). Slash commands: `/help`, `/clear`, `/exit`.
- **Discord** — requires `DISCORD_BOT_TOKEN` and `discord.js` installed. Bot responds in DMs or when mentioned in allowed channels. Messages split at 1900 chars.
- **Headless** — if REPL TTY is unavailable but Discord is active, the process stays alive as a daemon.

## Session Continuity

Clanker maintains a brief log of each session so the agent can resume with context on the next startup.

### How it works

1. **During a session** — every completed user turn is appended to `sessionTopics[]` (first 100 chars of user message, prefixed with channel).
2. **On exit** (`exit`, Ctrl-C, or fatal error) — `logSessionSummary(sessionTopics)` writes a `{ ev: "summary", topics: [...] }` entry to the JSONL session file, followed by the `end` event.
3. **On next startup** — `loadLastSession()` in `context.ts` reads the most recent `audit/*.jsonl` file:
   - If a `summary` event is found, it formats the topic list as a `## Last Session Summary` block and injects it into the system prompt.
   - If no summary exists (e.g. session was killed mid-write), it falls back to reconstructing a narrative from raw `user` / `llm` events.
4. **Console recap** — if a last session exists, the first 6 lines of the summary are also printed to the terminal at startup.

### Session files

Session logs live in `audit/` (git-ignored). File names follow the pattern `YYYY-MM-DDTHH-MM-SS_<pid>.jsonl`. Each line is a JSON object with a `t` (unix timestamp) and `ev` (event type) field.

Event types: `start`, `user`, `llm`, `policy`, `auth`, `cmd`, `edit`, `delegate`, `proposal`, `summary`, `end`.

## Persistent Agent Memory

`memory/MEMORY.md` is injected into the system prompt under a `## Persistent Memory` section. The agent can read and write this file to persist knowledge across sessions.

## Usage

```bash
# Basic setup (OpenAI only)
OPENAI_API_KEY=sk-... npm start
> list files in current directory    # allow-reads rule → executed
> download something with wget from the web    # block-network rule → blocked
> create a new directory called foo  # secret-for-write → prompts for passphrase

# With GitHub Actions delegation enabled
OPENAI_API_KEY=sk-... GITHUB_DELEGATE_PROVIDER=claude GITHUB_TOKEN=ghp_... GITHUB_WORKFLOW_ID=clanker-delegate-claude.yml npm start
> delegate to claude to refactor this function  # delegate action → triggers workflow_dispatch → opens PR
```

## Delegation via GitHub Actions

When `GITHUB_DELEGATE_PROVIDER`, `GITHUB_TOKEN`, and `GITHUB_WORKFLOW_ID` are set, the `delegate` action dispatches a `workflow_dispatch` event to GitHub Actions. The workflow runs Claude Code or Codex on GitHub's infrastructure:

- No in-process AI execution; all compute happens on GitHub runners
- A new branch (`clanker/<jobId>`) is created for each delegation
- The workflow opens a PR with the changes
- Clanker polls the GitHub API and notifies the user with a direct link to the PR
- Workflow templates are provided in `.github/workflows/`

Example delegate flow:
1. User: "I need help refactoring this TypeScript module"
2. GPT-4o returns a `delegate` response
3. Clanker dispatches `workflow_dispatch` to GitHub Actions
4. The workflow runs Claude Code (or Codex), commits changes, opens a PR
5. Clanker notifies: "✓ PR ready: Refactor TypeScript module — https://github.com/…"

## Config Doctor

Run the doctor to validate all environment variables before starting:

```bash
npm run doctor
```

The doctor validates:
- `OPENAI_API_KEY` format (must start with `sk-`)
- Discord configuration (token, allowlists, unsafe mode flag)
- Transport configuration (at least one transport must be enabled)
- GitHub delegation configuration (`GITHUB_DELEGATE_PROVIDER`, `GITHUB_TOKEN`, `GITHUB_WORKFLOW_ID`, `GITHUB_REPO` format) when `GITHUB_DELEGATE_PROVIDER` is set

## Security & Testing

### Security is Non-Negotiable
Clanker is a security-focused agent that executes commands. Security must be built in from the start:

1. **Policy Rule Tests** (`tests/unit/policy/patterns.test.ts`)
   - Verify regex patterns block dangerous commands
   - Test all combinations of dangerous flags
   - Validate command chaining is prevented (`;`, `|`, `&&`, `||`)
   - **Must pass before any policy change is deployed**

2. **Path Validation Tests** (Executor)
   - Test path traversal prevention (`../../../etc/passwd`)
   - Test symlink detection and rejection
   - Test working directory validation
   - **Required for any file operation changes**

3. **Input Validation Tests**
   - Test LLM response validation (Zod schemas)
   - Test Discord input sanitization
   - Test REPL input length limits
   - **Required for all user-facing inputs**

4. **Cryptographic Tests**
   - Test timing-safe comparisons for secrets
   - Test hash generation and verification
   - **Critical for authentication features**

### Adding Security Features
When adding security features:
1. Write tests that verify the vulnerability is fixed
2. Write tests that verify the vulnerability cannot be re-introduced
3. Run `npm test` to ensure no regressions
4. Document the vulnerability and fix in comments

### Adding Policy Rules
New policy rules must include:
```typescript
test.each([
  { cmd: 'dangerous-command', shouldMatch: true },
  { cmd: 'variant-flag-order', shouldMatch: true },
  { cmd: 'bypass-attempt', shouldMatch: true },
  { cmd: 'legitimate-command', shouldMatch: false },
])
```
