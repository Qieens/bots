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
  delayGroup: [5000, 10000], // random delay
  delayLoop: 10 * 60 * 1000,
  active: false,
  maxPerSession: 25
};

const CONFIG_FILE = "config.json";

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE));
  } catch {}
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ================= HELPER =================
const delay = ms => new Promise(r => setTimeout(r, ms));

const getRandomDelay = () => {
  const [min, max] = config.delayGroup;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// ================= TEXT VARIATION =================
const textVariations = [
  "🔥 PROMOTE DISINI 🔥",
  "🚀 PROMO DI SINI GAS!",
  "💰 Jual beli aman disini!",
  "📢 Open promote, join sekarang!",
  "🔥 Market aktif, yuk masuk!"
];

const getRandomText = () => {
  const base = textVariations[Math.floor(Math.random() * textVariations.length)];
  const noise = ["", ".", "..", "🔥", "🚀"];
  return base + " " + noise[Math.floor(Math.random() * noise.length)];
};

// ================= QUEUE SYSTEM =================
let queue = [];
let isProcessing = false;
let isReady = false;
let sentCount = 0;

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function buildQueue(groups) {
  const ids = Object.keys(groups);
  return shuffle(ids.filter(id => !groups[id].announce));
}

// ================= PROCESS =================
async function processQueue(sock) {
  if (isProcessing) return;
  isProcessing = true;

  while (config.active) {
    try {
      if (!isReady) {
        console.log("⏳ Menunggu koneksi siap...");
        await delay(3000);
        continue;
      }

      if (queue.length === 0) {
        const groups = await sock.groupFetchAllParticipating();
        queue = buildQueue(groups);
        console.log(`📦 Queue dibuat: ${queue.length} grup`);
      }

      const id = queue.shift();
      if (!id) continue;

      try {
        await sock.sendMessage(id, { text: getRandomText() });
        console.log(`✅ Kirim ke ${id}`);
      } catch (err) {
        console.log(`❌ Gagal ${id}:`, err.message);
      }

      sentCount++;

      // limit per sesi (anti spam)
      if (sentCount >= config.maxPerSession) {
        console.log("🛑 Limit tercapai, istirahat 10 menit...");
        sentCount = 0;
        await delay(10 * 60 * 1000);
      }

      const d = getRandomDelay();
      console.log(`⏳ Delay ${Math.floor(d / 1000)} detik`);
      await delay(d);

    } catch (err) {
      console.log("❌ Error:", err.message);
      await delay(5000);
    }
  }

  isProcessing = false;
}

// ================= START =================
async function startBot(retry = 0) {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  // ================= READY FIX =================
  sock.ev.on("connection.update", ({ connection, lastDisconnect, receivedPendingNotifications }) => {

    if (connection === "open") {
      console.log("✅ Connected");
    }

    // 🔥 ini kunci agar tidak stuck
    if (receivedPendingNotifications) {
      isReady = true;
      console.log("🔥 Socket siap digunakan!");

      if (config.active) processQueue(sock);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnect:", reason);

      isReady = false;
      isProcessing = false;

      if (reason === DisconnectReason.loggedOut) {
        console.log("🛑 Session logout, hapus folder session!");
        process.exit();
      }

      const delayReconnect = Math.min(3000 + retry * 3000, 30000);
      console.log(`🔄 Reconnect dalam ${delayReconnect / 1000} detik...`);

      setTimeout(() => startBot(retry + 1), delayReconnect);
    }
  });

  // ================= PAIRING =================
  if (!sock.authState.creds.registered) {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const nomor = await new Promise(resolve => {
      readline.question("📱 Masukkan nomor (62xxx): ", answer => {
        readline.close();
        resolve(answer);
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

    const reply = (txt) => sock.sendMessage(jid, { text: txt });

    switch (cmd) {
      case ".on":
        if (config.active) return reply("⚠️ Sudah aktif");
        config.active = true;
        saveConfig();
        reply("✅ Broadcast ON");
        processQueue(sock);
        break;

      case ".off":
        config.active = false;
        saveConfig();
        reply("🛑 Broadcast OFF");
        break;

      case ".delay":
        const m = parseInt(args[1]);
        if (isNaN(m)) return reply("❌ Contoh: .delay 10");
        config.delayLoop = m * 60000;
        saveConfig();
        reply(`✅ Delay loop ${m} menit`);
        break;

      case ".status":
        reply(
          `📊 STATUS\n\n` +
          `Aktif: ${config.active ? "ON" : "OFF"}\n` +
          `Delay: ${config.delayLoop / 60000} menit`
        );
        break;
    }
  });
}

// ================= RUN =================
startBot();