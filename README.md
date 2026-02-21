# Clanker

![Clanker security-focused CLI agent with policy-gated command execution architecture](https://i.imgur.com/bLcHAB0.png)

A security-focused TypeScript CLI agent that runs interactive chat over local REPL and Discord, with every proposed action filtered through a **Policy Gate** before execution.

## Features

- **Secure Execution** — All commands are evaluated against configurable security policies before running
- **Policy-Driven** — Define rules for allowed operations (read-only, network-blocked, write-protected, etc.)
- **Session Continuity** — Maintains session logs so the agent can resume with context on restart
- **Persistent Memory** — Agent reads `MEMORY.md` at startup to retain knowledge across sessions
- **Multi-Transport Chat** — Run local REPL and Discord bot transport in the same process
- **Passphrase Protection** — Sensitive operations (writes, moves, etc.) require authentication
- **Async Job Queue** — Long-running delegation tasks execute in background without blocking sessions
- **Claude Delegation Review Gate (Optional)** — Delegated tasks run in isolated worktrees and return accept/reject diff proposals
- **Git Support** — Execute git commands (status, log, diff, add, commit, fetch, etc.) while blocking destructive operations
- **Environment Doctor** — Validate your configuration before startup with `npm run doctor`

## Quick Start

### Installation

```bash
npm install
```

### Setup

Copy `.env.example` to `.env` and set your OpenAI API key:

```bash
export OPENAI_API_KEY=sk-your-key-here
```

Optional Discord bot settings (to run Discord alongside REPL):

```bash
export DISCORD_BOT_TOKEN=your_bot_token
export DISCORD_ALLOWED_USER_IDS=123456789012345678,234567890123456789
export DISCORD_ALLOWED_CHANNEL_IDS=345678901234567890
export DISCORD_UNSAFE_ENABLE_WRITES=0
export CLANKER_TRANSPORTS=repl,discord
export ENABLE_CLAUDE_DELEGATE=0
```

If you want Discord to be able to trigger code-changing actions, set:

```bash
export DISCORD_UNSAFE_ENABLE_WRITES=1
```

This is intentionally unsafe and should only be used with strict user/channel allowlists.

If you need headless container operation, use:

```bash
export CLANKER_TRANSPORTS=discord
```

### Run

```bash
npm start          # Run the agent
npm run dev        # Run with file watching
npm run doctor     # Validate environment/config before startup
npx tsc --noEmit   # Type-check
```

### Docker (macOS-friendly)

Build and run with Docker Compose:

```bash
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" \
docker compose up --build
```

Defaults in `docker-compose.yml` run Discord-only transport (`CLANKER_TRANSPORTS=discord`) for daemon mode. Session logs are persisted via `./sessions:/app/sessions`. Environment variables are loaded from `.env` via Compose `env_file`, so you do not need to re-enter them for each new container.

If you want REPL inside the container, run with TTY and stdin open:

```bash
docker run --rm -it --env-file .env -e CLANKER_TRANSPORTS=repl,discord clanker:dev
```

If `repl` is enabled but container has no interactive TTY (for example, detached mode), Clanker automatically skips REPL and continues with Discord transport.

#### Claude Code delegation in Docker

The image includes the `claude` CLI installed globally. To enable delegation, add the following to your `.env`:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
ENABLE_CLAUDE_DELEGATE=1
```

`ENABLE_CLAUDE_DELEGATE` is intentionally not hardcoded in `docker-compose.yml` so `.env` controls it.

Pass `--version` or `-v` to print the current version and exit:

```bash
npm start -- --version
```

## How It Works

1. **User Input** — Type in REPL and/or message the Discord bot
2. **LLM Processing** — Message sent to OpenAI (GPT-4o) via the LLM wrapper
3. **Policy Gate** — Every proposed action is evaluated against rules in `policy.json`
4. **Execution** — Approved commands run via bash; blocked commands are rejected
5. **Response** — Clanker sees the result and continues the conversation

### Action Types

The agent responds in one of four structured formats:

| Type | Description |
|------|-------------|
| `command` | Run a shell command (subject to policy evaluation) |
| `edit` | Apply a targeted find-and-replace to a single file (requires passphrase) |
| `delegate` | Hand off a complex programming task to Claude Code (supports optional `working_dir`) |
| `message` | Plain text reply with no action |

Delegation review commands (all transports):

- `pending` — show the current pending delegated proposal for this session
- `accept` or `accept <proposalId>` — apply the pending proposal patch
- `reject` or `reject <proposalId>` — discard the pending proposal patch

## Configuration

### Policy Rules (`policy.json`)

Rules are evaluated in order; first match wins. Default action is **block**.

### Runtime Flags

| Variable | Purpose |
|------|-------------|
| `CLANKER_TRANSPORTS` | Comma-separated transports: `repl`, `discord`, or both |
| `ENABLE_CLAUDE_DELEGATE` | Enables delegate actions that invoke the `claude` CLI |
| `DISCORD_UNSAFE_ENABLE_WRITES` | Allows Discord-triggered write/delegate actions (unsafe) |
| `SHELL_BIN` | Optional shell path override used by command execution |

### Runtime Tuning Overrides

Optional `CLANKER_*` overrides are available for model and safety/performance limits:

- `CLANKER_OPENAI_MODEL`, `CLANKER_OPENAI_MAX_TOKENS`
- `CLANKER_MAX_HISTORY`, `CLANKER_MAX_SESSIONS`, `CLANKER_MAX_USER_INPUT`
- `CLANKER_MAX_COMMAND_LENGTH`, `CLANKER_MAX_OUTPUT_BYTES`
- `CLANKER_QUEUE_MAX_CONCURRENT_JOBS`
- `CLANKER_DELEGATE_PROPOSAL_TTL_MS`
- `CLANKER_DELEGATE_DIFF_PREVIEW_MAX_LINES`, `CLANKER_DELEGATE_DIFF_PREVIEW_MAX_CHARS`
- `CLANKER_DELEGATE_FILE_DIFF_MAX_LINES`, `CLANKER_DELEGATE_FILE_DIFF_MAX_CHARS`
- `CLANKER_LOGGER_MAX_OUT`, `CLANKER_LOGGER_MAX_CMD`, `CLANKER_LOGGER_MAX_MSG`

`npm run doctor` validates these overrides and fails on invalid values.

| Rule | Matches | Action |
|------|---------|--------|
| `allow-git-commands` | Most git operations (status, log, diff, add, commit, fetch, pull, merge) | Allow |
| `allow-reads` | ls, cat, grep, head, tail, find, pwd, echo, which, env | Allow |
| `allow-curl` | curl (without command chaining) | Allow |
| `block-network` | wget, nc, ssh, scp | Block |
| `block-rm-rf` | `rm -rf` patterns | Block |
| `secret-for-write` | tee, mv, cp, mkdir, touch, chmod, dd, redirects | Requires passphrase |
| `blocked-shell-commands` | ps | Block |

**Git Command Blocking:**
Certain destructive git operations are blocked: `git reset --hard`, `git push --force`, `git branch -D`, `git clean -fd`, `git checkout --force`

**Default passphrase:** `mypassphrase`

Generate a new passphrase hash:

```bash
node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update('yourpassphrase').digest('hex'))"
```

Update the hash in `policy.json`:

```json
{
  "passphraseHash": "your_new_hash_here"
}
```

### Agent Personality

Customize agent behavior in `config/SOUL.md`. This file is loaded at startup and prepended to the system prompt.

### Persistent Memory

Place a `MEMORY.md` file in the project root. Its contents are injected into the system prompt at startup under a `## Persistent Memory` heading, allowing the agent to carry knowledge across sessions.

## REPL Slash Commands

The local REPL supports these built-in slash commands:

| Command | Description |
|---------|-------------|
| `/help`  | Print the list of available slash commands |
| `/clear` | Clear the current conversation history |
| `/exit`  | Gracefully exit the agent |

Delegation control commands are handled in chat as conversational keywords: `pending`, `accept`, `reject`.

## Project Structure

```
src/
  types.ts        # Type definitions (ExecuteCommandInput, PolicyVerdict, LLMResponse, etc.)
  policy.ts       # Policy evaluation engine with rule matching
  executor.ts     # Command execution via bash
  llm.ts          # OpenAI API wrapper (GPT-4o)
  logger.ts       # Session event logger
  main.ts         # Shared session core, job queue instantiation
  queue.ts        # JobQueue for async delegation task execution
  context.ts      # System prompt builder with session resumption
  config.ts       # Environment variable parsing
  doctor.ts       # Environment/config validation tool
  runtime.ts      # Shared types (Channel, SendFn, ProcessTurn)
  turnHandlers.ts # Action handlers (command, edit, delegate, message)
  transports/
    repl.ts       # Interactive REPL with slash commands
    discord.ts    # Discord bot transport with message reply support
config/
  SOUL.md         # Agent personality configuration
tests/
  unit/           # Unit tests (181 tests across policy, executor, session, queue, etc.)
MEMORY.md         # Persistent agent memory (optional, not committed)
policy.json       # Security policy rules (allow/block/requires-secret)
Dockerfile        # Docker image with Node 22, git, and curl
docker-compose.yml # Docker Compose for daemon mode
sessions/         # Session logs (git-ignored)
```

## Session Logs

Session logs automatically track conversation history for context recovery. On startup, the agent summarizes the last session and injects it into the system prompt, and prints a preview to the terminal.

Session files are stored in `sessions/` (git-ignored) and follow the pattern `YYYY-MM-DDTHH-MM-SS_<pid>.jsonl`.

## Example Usage

```bash
$ npm start

Clanker — security-focused agent.
Enabled transports: repl, discord
Default passphrase for write operations: mypassphrase
Claude delegation is disabled (ENABLE_CLAUDE_DELEGATE is not set).
Type /help for local REPL slash commands.

> list files in current directory
[allow-reads rule → executes `ls`]

> download example.zip using wget
[block-network rule → blocked]

> create a new directory called mydir
[secret-for-write rule → prompts for passphrase]
Enter passphrase: ****
[Passphrase verified → directory created]

> /help
Available slash commands:
  /help      Print this list of available slash commands.
  /clear     Clear current REPL conversation history.
  /exit      Gracefully exit the agent process.
```

## Security Notes

- All shell commands are blocked by default unless explicitly allowed by a policy rule
- Most network operations are blocked by default (`curl` is explicitly allowed)
- Destructive operations (`rm -rf`) are blocked
- Write operations and file edits require passphrase authentication
- Delegated file changes are proposed first and are only applied after `accept`
- Discord users cannot trigger write, apply, or delegate actions unless `DISCORD_UNSAFE_ENABLE_WRITES=1`
- Policies are evaluated in order; customize `policy.json` for your needs

## License

MIT
