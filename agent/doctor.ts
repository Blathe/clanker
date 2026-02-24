import {
  getEnv,
  parseDiscordIdCsv,
  parseBoolFlag,
  parseTransportsDetailed,
  parseCsvList,
} from "./config.js";
import { validateRuntimeConfigEnv } from "./runtimeConfig.js";

function printOk(message: string): void {
  console.log(`OK   ${message}`);
}

function printWarn(message: string): void {
  console.log(`WARN ${message}`);
}

function printFail(message: string): void {
  console.log(`FAIL ${message}`);
}

function main(): void {
  let hasFailure = false;

  const openAiKey = getEnv("OPENAI_API_KEY");
  if (!openAiKey) {
    printFail("OPENAI_API_KEY is missing.");
    hasFailure = true;
  } else if (!openAiKey.startsWith("sk-")) {
    printWarn("OPENAI_API_KEY does not start with 'sk-'. Verify the value.");
  } else {
    printOk("OPENAI_API_KEY is set.");
  }

  const discordToken = getEnv("DISCORD_BOT_TOKEN");
  if (!discordToken) {
    printWarn("DISCORD_BOT_TOKEN is not set. Discord transport will be disabled.");
  } else {
    printOk("DISCORD_BOT_TOKEN is set.");
  }

  const allowedUsers = parseDiscordIdCsv("DISCORD_ALLOWED_USER_IDS");
  const allowedChannels = parseDiscordIdCsv("DISCORD_ALLOWED_CHANNEL_IDS");
  const discordUnsafeWrites = parseBoolFlag("DISCORD_UNSAFE_ENABLE_WRITES");
  const transports = parseTransportsDetailed("CLANKER_TRANSPORTS");

  if (allowedUsers.invalid.length > 0) {
    printFail(
      `DISCORD_ALLOWED_USER_IDS contains invalid ID(s): ${allowedUsers.invalid.join(", ")}`
    );
    hasFailure = true;
  } else if (allowedUsers.values.length > 0) {
    printOk(`DISCORD_ALLOWED_USER_IDS parsed (${allowedUsers.values.length} value(s)).`);
  } else {
    printWarn("DISCORD_ALLOWED_USER_IDS is empty. Any user can reach the bot in allowed channels.");
  }

  if (allowedChannels.invalid.length > 0) {
    printFail(
      `DISCORD_ALLOWED_CHANNEL_IDS contains invalid ID(s): ${allowedChannels.invalid.join(", ")}`
    );
    hasFailure = true;
  } else if (allowedChannels.values.length > 0) {
    printOk(`DISCORD_ALLOWED_CHANNEL_IDS parsed (${allowedChannels.values.length} value(s)).`);
  } else {
    printWarn("DISCORD_ALLOWED_CHANNEL_IDS is empty. Bot can respond in any channel it can access.");
  }

  if (discordToken && allowedUsers.values.length === 0 && allowedChannels.values.length === 0) {
    printWarn("Discord token is set without allowlists. Consider setting user/channel allowlists.");
  }

  if (!discordUnsafeWrites.valid) {
    printFail("DISCORD_UNSAFE_ENABLE_WRITES must be one of: 1,true,yes,on,0,false,no,off.");
    hasFailure = true;
  } else if (discordUnsafeWrites.enabled) {
    printWarn("DISCORD_UNSAFE_ENABLE_WRITES is enabled. Discord users can trigger write actions.");
  } else {
    printOk("DISCORD_UNSAFE_ENABLE_WRITES is disabled.");
  }

  if (transports.invalid.length > 0) {
    printFail(`CLANKER_TRANSPORTS contains invalid value(s): ${transports.invalid.join(", ")}`);
    hasFailure = true;
  } else {
    const enabled = [
      ...(transports.repl ? ["repl"] : []),
      ...(transports.discord ? ["discord"] : []),
    ];
    if (enabled.length === 0) {
      printFail("CLANKER_TRANSPORTS disables all transports. Enable at least one of repl or discord.");
      hasFailure = true;
    } else {
      printOk(`CLANKER_TRANSPORTS enabled: ${enabled.join(", ")}.`);
    }
  }

  // GitHub Actions delegation validation (only when GITHUB_DELEGATE_PROVIDER is set)
  const delegateProvider = getEnv("GITHUB_DELEGATE_PROVIDER");
  if (delegateProvider !== undefined) {
    if (delegateProvider !== "claude" && delegateProvider !== "codex") {
      printFail("GITHUB_DELEGATE_PROVIDER must be 'claude' or 'codex'.");
      hasFailure = true;
    } else {
      printOk(`GITHUB_DELEGATE_PROVIDER is set to '${delegateProvider}'.`);
    }

    const githubToken = getEnv("GITHUB_TOKEN");
    if (!githubToken) {
      printFail("GITHUB_TOKEN is required when GITHUB_DELEGATE_PROVIDER is set.");
      hasFailure = true;
    } else if (!githubToken.startsWith("ghp_") && !githubToken.startsWith("github_pat_")) {
      printWarn("GITHUB_TOKEN does not look like a PAT (expected prefix: ghp_ or github_pat_). Verify the value.");
      printOk("GITHUB_TOKEN is set.");
    } else {
      printOk("GITHUB_TOKEN is set.");
    }

    const workflowId = getEnv("GITHUB_WORKFLOW_ID");
    if (!workflowId) {
      printFail("GITHUB_WORKFLOW_ID is required when GITHUB_DELEGATE_PROVIDER is set.");
      hasFailure = true;
    } else {
      printOk(`GITHUB_WORKFLOW_ID is set to '${workflowId}'.`);
    }

    const githubRepo = getEnv("GITHUB_REPO");
    if (githubRepo !== undefined && !githubRepo.includes("/")) {
      printFail("GITHUB_REPO must be in 'owner/repo' format.");
      hasFailure = true;
    } else if (githubRepo) {
      printOk(`GITHUB_REPO is set to '${githubRepo}'.`);
    } else {
      printWarn("GITHUB_REPO is not set; will attempt to detect from git remote.");
    }

    // Validate GITHUB_REPOS if set
    const githubRepos = getEnv("GITHUB_REPOS");
    if (githubRepos) {
      const repos = parseCsvList(githubRepos);
      const invalid = repos.filter((r) => !r.includes("/"));
      if (invalid.length > 0) {
        printFail(`GITHUB_REPOS contains invalid repo(s): ${invalid.join(", ")}. Each must be in 'owner/repo' format.`);
        hasFailure = true;
      } else {
        printOk(`GITHUB_REPOS is set (${repos.length} repo(s)).`);
      }
    } else {
      printWarn("GITHUB_REPOS is not set. Only the default repo will be approved for delegation.");
    }
  } else {
    printWarn("GITHUB_DELEGATE_PROVIDER is not set. GitHub Actions delegation will be disabled.");
  }

  const runtimeConfigErrors = validateRuntimeConfigEnv();
  if (runtimeConfigErrors.length > 0) {
    for (const error of runtimeConfigErrors) {
      printFail(error);
    }
    hasFailure = true;
  } else {
    printOk("Runtime configuration overrides are valid.");
  }

  if (hasFailure) {
    console.log("\nDoctor found configuration errors.");
    process.exit(1);
  }

  console.log("\nDoctor checks passed.");
}

main();
