import {
  getEnv,
  parseDiscordIdCsv,
  parseBoolFlag,
  parseTransportsDetailed,
} from "./config.js";

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
  const delegateEnabled = parseBoolFlag("ENABLE_CLAUDE_DELEGATE");
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

  if (!delegateEnabled.valid) {
    printFail("ENABLE_CLAUDE_DELEGATE must be one of: 1,true,yes,on,0,false,no,off.");
    hasFailure = true;
  } else if (delegateEnabled.enabled) {
    printOk("ENABLE_CLAUDE_DELEGATE is enabled.");
  } else {
    printWarn("ENABLE_CLAUDE_DELEGATE is disabled. Delegate actions will be blocked.");
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

  if (hasFailure) {
    console.log("\nDoctor found configuration errors.");
    process.exit(1);
  }

  console.log("\nDoctor checks passed.");
}

main();
