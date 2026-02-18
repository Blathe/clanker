# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Clanker

A security-focused TypeScript CLI agent. Accepts user chat messages, sends them to an LLM (OpenAI gpt-4o via OpenAI SDK), and intercepts every proposed action through a Policy Gate before execution. Supports multiple transports: interactive REPL and Discord.

## Commands

```bash
npm start          # Run the agent (requires OPENAI_API_KEY env var)
npm run dev        # Run with file-watching (tsx watch)
npx tsc --noEmit   # Type-check without emitting files
```

## Architecture

```
src/
  types.ts          # Shared interfaces (ExecuteCommandInput, PolicyVerdict, LLMResponse, etc.)
  policy.ts         # Policy gate: evaluate(command) → PolicyVerdict, verifySecret()
  executor.ts       # runCommand() via spawnSync bash -c, applyEdit(), formatResult()
  llm.ts            # OpenAI SDK wrapper (gpt-4o), callLLM()
  main.ts           # Entry point: transport orchestration, session state, processTurn()
  context.ts        # Builds system prompt: loadSoul(), loadMemory(), loadLastSession()
  runtime.ts        # Shared types: Channel, SendFn, ProcessTurn
  config.ts         # Env var parsing: envFlagEnabled(), parseTransportsDetailed(), etc.
  doctor.ts         # Config validator — checks all env vars, exits 1 on failure
  turnHandlers.ts   # Modular action handlers: handleTurnAction() dispatches by LLMResponse.type
  transports/
    repl.ts         # Interactive REPL transport (/help, /clear, /exit slash commands)
    discord.ts      # Discord bot transport (discord.js, optional peer dep)
config/
  SOUL.md           # Agent personality — loaded at startup, prepended to system prompt
MEMORY.md           # Persistent agent memory — injected into system prompt each session
policy.json         # Rule definitions (first-match wins, default: block)
sessions/           # JSONL session logs (git-ignored)
```

## LLM Response Types

The LLM must return one of four JSON shapes (`LLMResponse` in `types.ts`):

| type | fields | effect |
|------|--------|--------|
| `command` | `command`, `working_dir?`, `explanation` | Runs a shell command through the policy gate |
| `edit` | `file`, `old`, `new`, `explanation` | Replaces exact text in a file (requires passphrase unless Discord unsafe mode) |
| `delegate` | `prompt`, `explanation` | Spawns `claude -p <prompt> --dangerously-skip-permissions` subprocess |
| `message` | `explanation` | Replies with text only, no action |

## Policy Rules (policy.json)

Rules are evaluated in order; first match wins. Default is `"block"` (deny by default).

| id | pattern | action |
|----|---------|--------|
| `block-network` | curl, wget, nc, ssh, scp | blocked |
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
| `OPENAI_API_KEY` | Yes | OpenAI API key (must start with `sk-`) |
| `CLANKER_TRANSPORTS` | No | Comma-separated: `repl`, `discord` (default: both) |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token; absence disables Discord transport |
| `DISCORD_ALLOWED_USER_IDS` | No | Comma-separated Discord snowflake IDs; empty = any user |
| `DISCORD_ALLOWED_CHANNEL_IDS` | No | Comma-separated Discord snowflake IDs; empty = any channel |
| `DISCORD_UNSAFE_ENABLE_WRITES` | No | `1`/`true` = Discord can trigger write/delegate actions (dangerous) |
| `ENABLE_CLAUDE_DELEGATE` | No | `1`/`true` = enable `delegate` action via `claude` CLI subprocess |
| `SHELL_BIN` | No | Override shell for command execution (default: bash, or Git Bash on Windows) |

## Transports

- **REPL** — requires interactive TTY (`process.stdin.isTTY && process.stdout.isTTY`). Slash commands: `/help`, `/clear`, `/exit`.
- **Discord** — requires `DISCORD_BOT_TOKEN` and `discord.js` installed. Bot responds in DMs or when mentioned in allowed channels. Messages split at 1900 chars.
- **Headless** — if REPL TTY is unavailable but Discord is active, the process stays alive as a daemon.

## Session Continuity

Clanker maintains a brief log of each session so the agent can resume with context on the next startup.

### How it works

1. **During a session** — every completed user turn is appended to `sessionTopics[]` (first 100 chars of user message, prefixed with channel).
2. **On exit** (`exit`, Ctrl-C, or fatal error) — `logSessionSummary(sessionTopics)` writes a `{ ev: "summary", topics: [...] }` entry to the JSONL session file, followed by the `end` event.
3. **On next startup** — `loadLastSession()` in `context.ts` reads the most recent `sessions/*.jsonl` file:
   - If a `summary` event is found, it formats the topic list as a `## Last Session Summary` block and injects it into the system prompt.
   - If no summary exists (e.g. session was killed mid-write), it falls back to reconstructing a narrative from raw `user` / `llm` events.
4. **Console recap** — if a last session exists, the first 6 lines of the summary are also printed to the terminal at startup.

### Session files

Session logs live in `sessions/` (git-ignored). File names follow the pattern `YYYY-MM-DDTHH-MM-SS_<pid>.jsonl`. Each line is a JSON object with a `t` (unix timestamp) and `ev` (event type) field.

Event types: `start`, `user`, `llm`, `policy`, `auth`, `cmd`, `edit`, `delegate`, `summary`, `end`.

## Persistent Agent Memory

`MEMORY.md` at the project root is injected into the system prompt under a `## Persistent Memory` section. The agent can read and write this file to persist knowledge across sessions.

## Usage

```bash
OPENAI_API_KEY=sk-... npm start
> list files in current directory    # allow-reads rule → executed
> download something from the web    # block-network rule → blocked
> create a new directory called foo  # secret-for-write → prompts for passphrase
```

## Config Doctor

Run the doctor to validate all environment variables before starting:

```bash
npx tsx src/doctor.ts
```
