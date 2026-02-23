import { randomUUID } from "node:crypto";
import type { ProcessTurn, SendFn } from "../runtime.js";
import { getEnv, parseCsvEnvSet } from "../config.js";
import { validateInputLength } from "../validators.js";
import { getRuntimeConfig } from "../runtimeConfig.js";

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

  // Map to track session tokens for each channel+user combination
  // This ensures conversation continuity while using cryptographically secure session IDs
  const sessionTokens = new Map<string, string>();

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
    console.log(`[Discord] Message received from ${message.author?.username}: "${message.content?.slice(0, 50)}..."`);

    if (message.author?.bot) {
      console.log(`[Discord] Ignoring bot message`);
      return;
    }

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
    console.log(`[Discord] isDM=${isDM}, botId=${botId}, isUserMentioned=${isUserMentioned}, isRoleMentioned=${isRoleMentioned}`);
    if (!isDM && !isUserMentioned && !isRoleMentioned) {
      console.log(`[Discord] Message doesn't match criteria, ignoring`);
      return;
    }

    let content = String(message.content ?? "").trim();
    if (botId) {
      // Remove bot mentions (both <@botId> and <@!botId> formats)
      // Discord IDs are numeric, so safe to use in string operations
      content = content.replace(`<@${botId}>`, "").replace(`<@!${botId}>`, "").trim();
    }
    if (message.guild?.members.me) {
      for (const role of message.mentions.roles.values()) {
        if (message.guild.members.me.roles.cache.has(role.id)) {
          // Remove role mentions — Discord IDs are numeric and safe to use directly
          content = content.replace(`<@&${role.id}>`, "").trim();
        }
      }
    }
    if (!content) return;

    // Validate input length
    const validation = validateInputLength(content, getRuntimeConfig().maxUserInput);
    if (!validation.valid) {
      await message.reply(`Error: ${validation.error}`);
      return;
    }

    // Generate or retrieve a cryptographically secure session token for this channel+user pair
    const sessionKey = `${message.channelId}:${message.author.id}`;
    let sessionToken = sessionTokens.get(sessionKey);
    if (!sessionToken) {
      sessionToken = randomUUID();
      sessionTokens.set(sessionKey, sessionToken);
    }
    const sessionId = `discord:${sessionToken}`;

    // Create a send function that fetches a fresh message reference
    // This handles the case where background jobs reply after long delays
    // and the original message object becomes stale
    const messageId = message.id;
    const channelId = message.channelId;

    const send: SendFn = async (text: string) => {
      const parts = splitDiscordMessage(text);
      for (const part of parts) {
        try {
          // Try the cached message object first (works for immediate replies)
          await message.reply(part);
          console.log(`[Discord] Sent reply using cached message object`);
        } catch (err) {
          console.log(`[Discord] Cached message object failed: ${err}. Fetching fresh message...`);
          // If that fails, fetch a fresh message from Discord
          // This is necessary for background tasks that reply after delays
          try {
            const channel = await client.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) {
              console.error(`[Discord] Channel ${channelId} is not text-based`);
              return;
            }
            const freshMessage = await channel.messages.fetch(messageId);
            await freshMessage.reply(part);
            console.log(`[Discord] Sent reply using fresh message fetch`);
          } catch (fetchErr) {
            console.error(`[Discord] Failed to reply to message ${messageId} in channel ${channelId}: ${fetchErr}`);
          }
        }
      }
    };

    try {
      await processTurn(sessionId, "discord", content, send);
    } catch (err) {
      // Log full error for debugging, but send sanitized message to user
      console.error(`[Discord] Error in session ${sessionId}:`, err);
      await message.reply("An error occurred while processing your request. Please try again.");
    }
  });

  await client.login(token);
  return true;
}
