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
- **Claude Delegation** — Complex programming tasks can be delegated to Claude Code for execution
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
```

If you want Discord to be able to trigger code-changing actions, set:

```bash
export DISCORD_UNSAFE_ENABLE_WRITES=1
```

This is intentionally unsafe and should only be used with strict user/channel allowlists.

### Run

```bash
npm start          # Run the agent
npm run dev        # Run with file watching
npm run doctor     # Validate environment/config before startup
npx tsc --noEmit   # Type-check
```

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
| `delegate` | Hand off a complex programming task to Claude Code |
| `message` | Plain text reply with no action |

## Configuration

### Policy Rules (`policy.json`)

Rules are evaluated in order; first match wins. Default action is **block**.

| Rule | Matches | Action |
|------|---------|--------|
| `allow-reads` | ls, cat, grep, head, tail, find | Allow |
| `block-network` | curl, wget, nc, ssh, scp | Block |
| `block-rm-rf` | `rm -rf` patterns | Block |
| `secret-for-write` | tee, mv, cp, mkdir, touch, chmod, dd, redirects | Requires passphrase |

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

## Project Structure

```
src/
  types.ts        # Type definitions (ExecuteCommandInput, PolicyVerdict, etc.)
  policy.ts       # Policy evaluation engine
  executor.ts     # Command execution via bash
  llm.ts          # OpenAI API wrapper (GPT-4o)
  logger.ts       # Session event logger
  main.ts         # Shared session core + REPL/Discord transports
  doctor.ts       # Environment/config validation tool
config/
  SOUL.md         # Agent personality configuration
MEMORY.md         # Persistent agent memory (optional, not committed)
policy.json       # Security policy rules
sessions/         # Session logs (git-ignored)
```

## Session Logs

Session logs automatically track conversation history for context recovery. On startup, the agent summarizes the last session and injects it into the system prompt, and prints a preview to the terminal.

Session files are stored in `sessions/` (git-ignored) and follow the pattern `YYYY-MM-DDTHH-MM-SS_<pid>.jsonl`.

## Example Usage

```bash
$ npm start

Clanker — security-focused agent.
REPL and Discord transports can run together.
Default passphrase for write operations: mypassphrase
Type /help for local REPL slash commands.

> list files in current directory
[allow-reads rule → executes `ls`]

> download example.zip from the web
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
- Network operations are blocked by default
- Destructive operations (`rm -rf`) are blocked
- Write operations and file edits require passphrase authentication
- Discord users cannot trigger write or delegate actions unless `DISCORD_UNSAFE_ENABLE_WRITES=1`
- Policies are evaluated in order; customize `policy.json` for your needs

## License

MIT
