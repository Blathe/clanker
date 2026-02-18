import type { ProcessTurn, SendFn } from "../runtime.js";

function parseIdList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

async function loadDiscordModule(): Promise<any | null> {
  try {
    const moduleName = "discord.js";
    return await import(moduleName);
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
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log("Discord transport: disabled (DISCORD_BOT_TOKEN not set).");
    return false;
  }

  const discord = await loadDiscordModule();
  if (!discord) {
    console.log("Discord transport: disabled (discord.js is not installed).");
    return false;
  }

  const allowedUsers = parseIdList(process.env.DISCORD_ALLOWED_USER_IDS);
  const allowedChannels = parseIdList(process.env.DISCORD_ALLOWED_CHANNEL_IDS);

  const client = new discord.Client({
    intents: [
      discord.GatewayIntentBits.Guilds,
      discord.GatewayIntentBits.GuildMessages,
      discord.GatewayIntentBits.DirectMessages,
      discord.GatewayIntentBits.MessageContent,
    ],
    partials: [discord.Partials.Channel],
  });

  client.on(discord.Events.ClientReady, (readyClient: { user: { tag: string } }) => {
    console.log(`Discord transport: connected as ${readyClient.user.tag}`);
  });

  client.on(discord.Events.MessageCreate, async (message: any) => {
    if (message.author?.bot) return;

    if (allowedUsers.size > 0 && !allowedUsers.has(message.author.id)) return;
    if (allowedChannels.size > 0 && !allowedChannels.has(message.channelId)) return;

    const botId = client.user?.id;
    const isDM = !message.guildId;
    const isMentioned = botId ? message.mentions?.users?.has(botId) : false;
    if (!isDM && !isMentioned) return;

    let content = String(message.content ?? "").trim();
    if (botId) {
      const mentionRegex = new RegExp(`<@!?${botId}>`, "g");
      content = content.replace(mentionRegex, "").trim();
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
      await message.reply(`Error: ${err}`);
    }
  });

  await client.login(token);
  return true;
}
