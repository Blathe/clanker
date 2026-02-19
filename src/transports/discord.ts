import type { ProcessTurn, SendFn } from "../runtime.js";
import { getEnv, parseCsvEnvSet } from "../config.js";

type DiscordModule = typeof import("discord.js");
type DiscordMessage = import("discord.js").Message<boolean>;

async function loadDiscordModule(): Promise<DiscordModule | null> {
  try {
    const moduleName = "discord.js";
    return (await import(moduleName)) as DiscordModule;
  } catch {
    return null;
  }
}

function splitDiscordMessage(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    parts.push(text.slice(start, start + maxLen));
    start += maxLen;
  }
  return parts;
}

export async function runDiscordTransport(processTurn: ProcessTurn): Promise<boolean> {
  const token = getEnv("DISCORD_BOT_TOKEN");
  if (!token) {
    console.log("Discord transport: disabled (DISCORD_BOT_TOKEN not set).");
    return false;
  }

  const discord = await loadDiscordModule();
  if (!discord) {
    console.log("Discord transport: disabled (discord.js is not installed).");
    return false;
  }

  const allowedUsers = parseCsvEnvSet("DISCORD_ALLOWED_USER_IDS");
  const allowedChannels = parseCsvEnvSet("DISCORD_ALLOWED_CHANNEL_IDS");

  const client = new discord.Client({
    intents: [
      discord.GatewayIntentBits.Guilds,
      discord.GatewayIntentBits.GuildMessages,
      discord.GatewayIntentBits.DirectMessages,
      discord.GatewayIntentBits.MessageContent,
    ],
    partials: [discord.Partials.Channel],
  });

  client.on(discord.Events.ClientReady, (readyClient) => {
    console.log(`Discord transport: connected as ${readyClient.user.tag}`);
  });

  client.on(discord.Events.ShardDisconnect, (event, shardId) => {
    console.error(`Discord transport: WebSocket disconnected (shard ${shardId}, code ${event.code})`);
  });

  client.on(discord.Events.ShardReconnecting, (shardId) => {
    console.log(`Discord transport: reconnecting (shard ${shardId})...`);
  });

  client.on(discord.Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`Discord transport: resumed (shard ${shardId}, replayed ${replayedEvents} events)`);
  });

  client.on(discord.Events.ShardError, (error, shardId) => {
    console.error(`Discord transport: shard ${shardId} error:`, error);
  });

  client.on(discord.Events.MessageCreate, async (message: DiscordMessage) => {
    if (message.author?.bot) return;

    if (allowedUsers.size > 0 && !allowedUsers.has(message.author.id)) {
      console.log(`Discord: dropping message from unlisted user ${message.author.id}`);
      return;
    }
    if (allowedChannels.size > 0 && !allowedChannels.has(message.channelId)) {
      console.log(`Discord: dropping message from unlisted channel ${message.channelId}`);
      return;
    }

    const botId = client.user?.id;
    const isDM = !message.guildId;
    const isUserMentioned = botId ? message.mentions?.users?.has(botId) : false;
    const isRoleMentioned = message.guild?.members.me
      ? message.mentions.roles.some((r) => message.guild!.members.me!.roles.cache.has(r.id))
      : false;
    if (!isDM && !isUserMentioned && !isRoleMentioned) return;

    let content = String(message.content ?? "").trim();
    if (botId) {
      const userMentionRegex = new RegExp(`<@!?${botId}>`, "g");
      content = content.replace(userMentionRegex, "").trim();
    }
    if (message.guild?.members.me) {
      for (const role of message.mentions.roles.values()) {
        if (message.guild.members.me.roles.cache.has(role.id)) {
          content = content.replace(`<@&${role.id}>`, "").trim();
        }
      }
    }
    if (!content) return;

    const sessionId = `discord:${message.channelId}:${message.author.id}`;

    const send: SendFn = async (text: string) => {
      const parts = splitDiscordMessage(text);
      for (const part of parts) {
        await message.reply(part);
      }
    };

    try {
      await processTurn(sessionId, "discord", content, send);
    } catch (err) {
      await message.reply(`Error: ${String(err)}`);
    }
  });

  await client.login(token);
  return true;
}
