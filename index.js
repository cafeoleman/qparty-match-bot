import express from "express";
import bodyParser from "body-parser";
import helmet from "helmet";
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from "discord.js";

const app = express();
app.use(helmet());
app.use(bodyParser.json());

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const API_KEY = process.env.API_KEY || "";
const PORT = process.env.PORT || 10000;
const INVITE_TTL_SECONDS = parseInt(process.env.INVITE_TTL_SECONDS || "600");
const CHANNEL_TTL_SECONDS = parseInt(process.env.CHANNEL_TTL_SECONDS || "3600");

if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error("Missing DISCORD_TOKEN or GUILD_ID env vars.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.on("ready", () => {
  console.log(`Bot ready: ${client.user.tag}`);
});

await client.login(DISCORD_TOKEN);

const cleanupTimers = new Map();

function scheduleChannelDeletion(channel, seconds) {
  if (!channel || !channel.id) return;
  const id = channel.id;
  if (cleanupTimers.has(id)) clearTimeout(cleanupTimers.get(id));
  const t = setTimeout(async () => {
    try {
      await channel.delete("Auto cleanup - match finished");
      cleanupTimers.delete(id);
      console.log(`Deleted channel ${id}`);
    } catch (e) {
      console.error("Failed to delete channel", id, e);
    }
  }, seconds * 1000);
  cleanupTimers.set(id, t);
}

app.post("/generate-invite", async (req, res) => {
  try {
    const apiKey = req.header("x-api-key") || "";
    if (!API_KEY || apiKey !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { member_ids, game = "match", party_size = 5 } = req.body;
    if (!Array.isArray(member_ids) || member_ids.length === 0) {
      return res.status(400).json({ error: "member_ids must be a non-empty array" });
    }
    if (member_ids.length > 20) {
      return res.status(400).json({ error: "Too many member_ids" });
    }

    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) return res.status(500).json({ error: "Guild not found" });

    const categories = await guild.channels.fetch();
    const category = categories.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === game.toLowerCase());

    const timestamp = Date.now();
    const channelName = `match-${game.toLowerCase().replace(/\s+/g,'-')}-${timestamp.toString().slice(-6)}`;

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      }
    ];

    for (const id of member_ids) {
      overwrites.push({
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect]
      });
    }

    const channelOptions = {
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
      topic: `Match channel for ${game} created ${new Date().toISOString()}`
    };

    let createdChannel;
    if (category) {
      createdChannel = await guild.channels.create({
        name: channelName,
        parent: category.id,
        ...channelOptions
      });
    } else {
      createdChannel = await guild.channels.create({
        name: channelName,
        ...channelOptions
      });
    }

    const invite = await createdChannel.createInvite({
      maxAge: INVITE_TTL_SECONDS,
      maxUses: party_size,
      unique: true
    });

    scheduleChannelDeletion(createdChannel, CHANNEL_TTL_SECONDS);

    return res.json({
      invite_url: `https://discord.gg/${invite.code}`,
      channel_id: createdChannel.id,
      guild_id: guild.id
    });

  } catch (err) {
    console.error("generate-invite error:", err);
    return res.status(500).json({ error: "internal_error", details: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("QParty Match Bot API");
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
