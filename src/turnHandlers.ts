import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { evaluate, verifySecret } from "./policy.js";
import { runCommand, formatResult, applyEdit } from "./executor.js";
import type { LLMResponse } from "./types.js";
import type { Channel, SendFn } from "./runtime.js";
import {
  logVerdict,
  logSecretVerification,
  logCommandResult,
  logEdit,
  logDelegate,
} from "./logger.js";

export interface DelegateResult {
  exitCode: number;
  summary: string;
}

export type TurnActionOutcome = "continue" | "break";

interface TurnActionContext {
  channel: Channel;
  send: SendFn;
  response: LLMResponse;
  history: ChatCompletionMessageParam[];
  discordUnsafeEnableWrites: boolean;
  delegateEnabled: boolean;
  promptSecret: (question: string) => Promise<string>;
  delegateToClaude: (delegatePrompt: string) => Promise<DelegateResult>;
}

function pushUserHistory(history: ChatCompletionMessageParam[], content: string): void {
  history.push({ role: "user", content });
}

async function handleMessageAction(ctx: TurnActionContext): Promise<TurnActionOutcome> {
  if (ctx.response.type !== "message") return "continue";
  await ctx.send(ctx.response.explanation);
  return "break";
}

async function handleDelegateAction(ctx: TurnActionContext): Promise<TurnActionOutcome> {
  if (ctx.response.type !== "delegate") return "continue";

  if (!ctx.delegateEnabled) {
    await ctx.send("Delegation is disabled in this runtime.");
    pushUserHistory(ctx.history, "Delegate action denied: delegation is disabled.");
    return "continue";
  }

  if (ctx.channel === "discord" && !ctx.discordUnsafeEnableWrites) {
    pushUserHistory(
      ctx.history,
      "Delegate actions are disabled from Discord. Provide a message response or a read-only command."
    );
    return "continue";
  }

  if (ctx.channel === "discord" && ctx.discordUnsafeEnableWrites) {
    await ctx.send("[UNSAFE MODE] Executing delegate action from Discord.");
  }

  await ctx.send(ctx.response.explanation);
  await ctx.send("[DELEGATING TO CLAUDE]");

  try {
    const { exitCode, summary } = await ctx.delegateToClaude(ctx.response.prompt);
    logDelegate(exitCode, summary.length);
    await ctx.send(`[CLAUDE DONE] Exit code: ${exitCode}`);
    pushUserHistory(
      ctx.history,
      `Claude completed the task (exit code: ${exitCode}).\nSummary: ${summary || "No summary provided."}`
    );
  } catch (err) {
    pushUserHistory(ctx.history, `Claude failed to run: ${err}`);
  }

  return "continue";
}

async function handleEditAction(ctx: TurnActionContext): Promise<TurnActionOutcome> {
  if (ctx.response.type !== "edit") return "continue";

  if (ctx.channel === "discord" && !ctx.discordUnsafeEnableWrites) {
    pushUserHistory(
      ctx.history,
      "Edit actions are disabled from Discord. Provide a message response or a read-only command."
    );
    return "continue";
  }

  await ctx.send(ctx.response.explanation);
  await ctx.send(`[EDIT REQUEST] ${ctx.response.file}`);

  const verified =
    ctx.channel === "discord" && ctx.discordUnsafeEnableWrites
      ? true
      : verifySecret("secret-for-write", await ctx.promptSecret("Enter passphrase: "));
  logSecretVerification("secret-for-write", verified);

  if (!verified) {
    await ctx.send("[ACCESS DENIED] Incorrect passphrase.");
    pushUserHistory(ctx.history, "Access denied: incorrect passphrase. The edit was not applied.");
    return "continue";
  }

  const result = applyEdit(ctx.response.file, ctx.response.old, ctx.response.new);
  logEdit(ctx.response.file, result);
  if (result.success) {
    await ctx.send(`[EDIT APPLIED] ${ctx.response.file}`);
    return "break";
  }

  await ctx.send(`[EDIT FAILED] ${result.error}`);
  pushUserHistory(ctx.history, `Edit failed: ${result.error}`);
  return "continue";
}

async function handleCommandAction(ctx: TurnActionContext): Promise<TurnActionOutcome> {
  if (ctx.response.type !== "command") return "continue";

  const verdict = evaluate(ctx.response.command);

  switch (verdict.decision) {
    case "blocked": {
      logVerdict(ctx.response.command, verdict);
      pushUserHistory(
        ctx.history,
        `Command blocked by policy (rule: ${verdict.rule_id}): ${verdict.reason}`
      );
      return "continue";
    }

    case "requires-secret": {
      logVerdict(ctx.response.command, verdict);

      if (ctx.channel === "discord" && !ctx.discordUnsafeEnableWrites) {
        pushUserHistory(
          ctx.history,
          `Command requires local approval and cannot run from Discord (rule: ${verdict.rule_id}). Use local REPL for this action.`
        );
        return "continue";
      }

      if (!(ctx.channel === "discord" && ctx.discordUnsafeEnableWrites)) {
        await ctx.send(`[REQUIRES PASSPHRASE] ${verdict.prompt}`);
      } else {
        await ctx.send(
          `[UNSAFE MODE] Running passphrase-gated command from Discord (rule: ${verdict.rule_id}).`
        );
      }

      const verified =
        ctx.channel === "discord" && ctx.discordUnsafeEnableWrites
          ? true
          : verifySecret(verdict.rule_id, await ctx.promptSecret("Enter passphrase: "));
      logSecretVerification(verdict.rule_id, verified);

      if (!verified) {
        await ctx.send("[ACCESS DENIED] Incorrect passphrase.");
        pushUserHistory(ctx.history, "Access denied: incorrect passphrase. The write command was not executed.");
        return "continue";
      }

      const result = runCommand({
        command: ctx.response.command,
        reason: ctx.response.explanation,
        working_dir: ctx.response.working_dir,
      });
      logCommandResult(ctx.response.command, result);
      await ctx.send(formatResult(result));
      return "break";
    }

    case "allowed": {
      logVerdict(ctx.response.command, verdict);
      const result = runCommand({
        command: ctx.response.command,
        reason: ctx.response.explanation,
        working_dir: ctx.response.working_dir,
      });
      logCommandResult(ctx.response.command, result);
      const formatted = formatResult(result);
      await ctx.send(formatted);
      pushUserHistory(ctx.history, `Command output for: ${ctx.response.command}\n${formatted}`);
      return "continue";
    }
  }
}

export async function handleTurnAction(ctx: TurnActionContext): Promise<TurnActionOutcome> {
  switch (ctx.response.type) {
    case "message":
      return handleMessageAction(ctx);
    case "delegate":
      return handleDelegateAction(ctx);
    case "edit":
      return handleEditAction(ctx);
    case "command":
      return handleCommandAction(ctx);
  }
}
