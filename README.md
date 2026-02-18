# Clanker

A security-focused TypeScript CLI agent that runs an interactive chat with Claude, with every proposed action filtered through a **Policy Gate** before execution.

## Features

- **Secure Execution** — All commands are evaluated against configurable security policies before running
- **Policy-Driven** — Define rules for allowed operations (read-only, network-blocked, write-protected, etc.)
- **Session Continuity** — Maintains session logs so the agent can resume with context on restart
- **Interactive REPL** — Chat with Claude, get responses, execute validated commands
- **Passphrase Protection** — Sensitive operations (writes, moves, etc.) require authentication

## Quick Start

### Installation

```bash
npm install
```

### Setup

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-your-key-here
```

### Run

```bash
npm start          # Run the agent
npm run dev        # Run with file watching
npx tsc --noEmit   # Type-check
```

## How It Works

1. **User Input** — Type a message in the REPL
2. **Claude Processing** — Message sent to Claude API via the LLM wrapper
3. **Policy Gate** — Every proposed action is evaluated against rules in `policy.json`
4. **Execution** — Approved commands run via bash; blocked commands are rejected
5. **Response** — Claude sees the result and continues the conversation

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

## Project Structure

```
src/
  types.ts        # Type definitions (ExecuteCommandInput, PolicyVerdict, etc.)
  policy.ts       # Policy evaluation engine
  executor.ts     # Command execution via bash
  llm.ts          # Claude API wrapper
  main.ts         # REPL loop and session management
config/
  SOUL.md         # Agent personality configuration
policy.json       # Security policy rules
sessions/         # Session logs (git-ignored)
```

## Session Logs

Session logs automatically track conversation history for context recovery. On startup, the agent summarizes the last session and injects it into the system prompt.

Session files are stored in `sessions/` (git-ignored) and follow the pattern `YYYY-MM-DDTHH-MM-SS_<pid>.jsonl`.

## Example Usage

```bash
$ npm start

Clanker loaded. Chat with Claude...

> list files in current directory
[Agent processes: allow-reads matches → executes `ls`]

> download example.zip from the web
[Agent processes: block-network matches → blocked]

> create a new directory called mydir
[Agent processes: secret-for-write matches → prompts for passphrase]
Enter passphrase: ****
[Passphrase verified → directory created]
```

## Security Notes

- All shell commands are blocked by default unless explicitly allowed by a policy rule
- All commands are validated before execution
- Network operations are blocked by default
- Destructive operations (`rm -rf`) are blocked
- Write operations require passphrase authentication
- Policies are evaluated in order; customize `policy.json` for your needs

## License

MIT
