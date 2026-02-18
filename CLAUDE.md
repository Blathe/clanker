# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Clanker

A security-focused TypeScript CLI agent. Accepts user chat messages, sends them to Claude via the Anthropic SDK, and intercepts every proposed action through a Policy Gate before execution.

## Commands

```bash
npm start          # Run the agent (requires ANTHROPIC_API_KEY env var)
npm run dev        # Run with file-watching (tsx watch)
npx tsc --noEmit   # Type-check without emitting files
```

## Architecture

```
src/
  types.ts        # Shared interfaces (ExecuteCommandInput, PolicyVerdict, etc.)
  policy.ts       # Policy gate: evaluate(command) → PolicyVerdict, verifySecret()
  executor.ts     # runCommand() via spawnSync bash -c, formatResult()
  llm.ts          # OpenAI SDK wrapper, callLLM()
  main.ts         # REPL loop: user input → LLM → policy gate → executor → LLM
config/
  SOUL.md         # Agent personality — loaded at startup, prepended to system prompt
policy.json       # Rule definitions (first-match wins, default: block)
```

## Policy Rules (policy.json)

Rules are evaluated in order; first match wins. Default is `"block"` (deny by default).

- `allow-reads` — read-only commands (ls, cat, grep, etc.) → allowed
- `block-network` — curl, wget, nc, ssh, scp → blocked
- `block-rm-rf` — `rm -rf` patterns → blocked
- `secret-for-write` — tee, mv, cp, mkdir, touch, chmod, dd, redirects → requires passphrase

Default passphrase: `mypassphrase`

To generate a new hash: `node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update('yourpassphrase').digest('hex'))"`

## Session Continuity

Clanker maintains a brief log of each session so the agent can resume with context on the next startup.

### How it works

1. **During a session** — every completed user turn is appended to `sessionTopics[]` (first 120 chars of the user message).
2. **On exit** (`exit`, Ctrl-C, or fatal error) — `logSessionSummary(sessionTopics)` writes a `{ ev: "summary", topics: [...] }` entry to the JSONL session file, followed by the `end` event.
3. **On next startup** — `loadLastSession()` in `main.ts` reads the most recent `sessions/*.jsonl` file:
   - If a `summary` event is found, it formats the topic list as a `## Last Session Summary` block and injects it into the system prompt.
   - If no summary exists (e.g. session was killed mid-write), it falls back to reconstructing a narrative from raw `user` / `llm` events.
4. **Console recap** — if a last session exists, the first 6 lines of the summary are also printed to the terminal at startup so the human can reorient quickly.

### Session files

Session logs live in `sessions/` (git-ignored). File names follow the pattern `YYYY-MM-DDTHH-MM-SS_<pid>.jsonl`. Each line is a JSON object with a `t` (unix timestamp) and `ev` (event type) field.

Event types: `start`, `user`, `llm`, `policy`, `auth`, `cmd`, `edit`, `delegate`, `summary`, `end`.

## Usage

```bash
ANTHROPIC_API_KEY=sk-... npm start
> list files in current directory    # allow-reads rule → executed
> download something from the web    # block-network rule → blocked
> create a new directory called foo  # secret-for-write → prompts for passphrase
```
