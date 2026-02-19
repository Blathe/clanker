import type { Interface } from "node:readline";
import type { ProcessTurn, SendFn } from "../runtime.js";
import { validateInputLength } from "../main.js";

const REPL_SESSION_ID = "repl:local";

export interface ReplTransportDeps {
  rl: Interface;
  prompt: (question: string) => Promise<string>;
  processTurn: ProcessTurn;
  clearSession: (sessionId: string) => void;
  endSession: () => void;
}

export async function runReplTransport(deps: ReplTransportDeps): Promise<void> {
  const { rl, prompt, processTurn, clearSession, endSession } = deps;

  const slashCommands: Record<string, { description: string; action: () => Promise<void> | void }> = {
    "/help": {
      description: "Print this list of available slash commands.",
      action: () => {
        console.log("\nAvailable slash commands:");
        for (const [name, { description }] of Object.entries(slashCommands)) {
          console.log(`  ${name.padEnd(10)} ${description}`);
        }
        console.log();
      },
    },
    "/clear": {
      description: "Clear current REPL conversation history.",
      action: () => {
        clearSession(REPL_SESSION_ID);
        console.log("Conversation history for REPL cleared.\n");
      },
    },
    "/exit": {
      description: "Gracefully exit the agent process.",
      action: () => {
        endSession();
        console.log("Goodbye.");
        rl.close();
        process.exit(0);
      },
    },
  };

  while (true) {
    const userInput = await prompt("> ").catch(() => "exit");

    if (userInput.trim().toLowerCase() === "exit") {
      endSession();
      console.log("Goodbye.");
      rl.close();
      process.exit(0);
    }

    const slashCommand = slashCommands[userInput.trim()];
    if (slashCommand) {
      await slashCommand.action();
      continue;
    }

    if (!userInput.trim()) continue;

    // Validate input length
    const validation = validateInputLength(userInput);
    if (!validation.valid) {
      console.log(`\nError: ${validation.error}\n`);
      continue;
    }

    const send: SendFn = async (text: string) => {
      console.log(`\nClanker: ${text}\n`);
    };

    await processTurn(REPL_SESSION_ID, "repl", userInput, send);
  }
}
