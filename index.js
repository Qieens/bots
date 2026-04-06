const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const fs = require('fs');

// ================= CONFIG =================
let config = {
  text: "🔥 PROMOTE DISINI 🔥",
  delayGroup: 3000,
  delayLoop: 10 * 60 * 1000,
  active: false
};

const CONFIG_FILE = "config.json";

if (fs.existsSync(CONFIG_FILE)) {
  try { config = JSON.parse(fs.readFileSync(CONFIG_FILE)); } catch {}
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const delay = ms => new Promise(r => setTimeout(r, ms));
let isLooping = false;

// ================= BROADCAST =================
async function startLoop(sock) {
  if (isLooping) return;
  isLooping = true;

  while (config.active) {
    if (!sock.ws || sock.ws.readyState !== 1) {
      console.log("⚠️ Socket mati, hentikan loop.");
      config.active = false;
      saveConfig();
      break;
    }

    console.log("\n🔁 Broadcast dimulai...");
    const groups = await sock.groupFetchAllParticipating();
    const ids = Object.keys(groups);

    let open = 0, closed = 0;

    for (let id of ids) {
      if (!config.active) break;

      const group = groups[id];

      if (group.announce) {
        closed++;
        console.log(`⛔ Closed: ${group.subject}`);
        continue;
      }

      open++;
      try {
        await sock.sendMessage(id, { text: config.text });
        console.log(`✅ ${group.subject}`);
      } catch (err) {
        console.log(`❌ ${group.subject}:`, err.message);
      }

      await delay(config.delayGroup);
    }

    console.log(`📊 Open: ${open} | Closed: ${closed}`);
    await delay(config.delayLoop);
  }

  isLooping = false;
}

// ================= START BOT =================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  // ❗ Saat belum registered → reconnect ON
  // ❗ Setelah registered → reconnect OFF
  const INITIAL_RECONNECT = !state.creds.registered;

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    shouldReconnect: () => INITIAL_RECONNECT
  });

  sock.ev.on("creds.update", saveCreds);

  // ================= PAIRING =================
  if (!state.creds.registered) {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const nomor = await new Promise(resolve => {
      readline.question("📱 Masukkan nomor (62xxx): ", ans => {
        readline.close();
        resolve(ans);
      });
    });

    const code = await sock.requestPairingCode(nomor.replace(/[^0-9]/g, ""));
    console.log("🔑 Kode pairing:", code);
  }

  // ================= COMMAND =================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || !msg.key.fromMe) return;

    const jid = msg.key.remoteJid;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text.startsWith(".")) return;

    const args = text.trim().split(" ");
    const cmd = args[0].toLowerCase();

    const reply = txt => sock.sendMessage(jid, { text: txt });

    switch (cmd) {
      case ".on":
        if (config.active) return reply("⚠️ Sudah aktif");
        config.active = true;
        saveConfig();
        reply("✅ Broadcast ON");
        startLoop(sock);
        break;

      case ".off":
        config.active = false;
        saveConfig();
        reply("🛑 Broadcast OFF");
        break;

      case ".teks":
        const newText = text.slice(6).trim();
        if (!newText) return reply("❌ Isi teks kosong");
        config.text = newText;
        saveConfig();
        reply("✅ Teks diupdate");
        break;

      case ".delay":
        const menit = parseInt(args[1]);
        if (isNaN(menit)) return reply("❌ Contoh: .delay 10");
        config.delayLoop = menit * 60000;
        saveConfig();
        reply(`✅ Delay ${menit} menit`);
        break;

      case ".status":
        reply(
          `📊 STATUS\n\nAktif: ${config.active}\nDelay: ${config.delayLoop / 60000} menit\nPesan: ${config.text}`
        );
        break;
    }
  });

  // ================= CONNECTION =================
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("✅ Connected");

      // setelah connected → matikan reconnect
      sock.shouldReconnect = () => false;

      if (config.active) startLoop(sock);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnect:", reason);
      console.log("🛑 Bot berhenti.");
      process.exit(0);
    }
  });
}

startBot();
