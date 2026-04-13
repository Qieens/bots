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
  delayGroup: [5000, 10000],
  delayLoop: 10 * 60 * 1000,
  active: false,
  maxPerSession: 25
};

const CONFIG_FILE = "config.json";

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const file = JSON.parse(fs.readFileSync(CONFIG_FILE));
    config = { ...config, ...file };
  } catch {
    console.log("⚠️ Config rusak, pakai default");
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ================= HELPER =================
const delay = ms => new Promise(r => setTimeout(r, ms));

const getRandomDelay = () => {
  if (!Array.isArray(config.delayGroup)) return 7000;
  const [min, max] = config.delayGroup;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// ================= STATE =================
let queue = [];
let isProcessing = false;
let isReady = false;
let sentCount = 0;
let currentSock = null;
let sentCache = new Set();

// ================= QUEUE =================
function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function buildQueue(groups) {
  if (!groups) return [];
  const ids = Object.keys(groups);
  return shuffle(ids.filter(id => !groups[id]?.announce));
}

// ================= PROCESS =================
async function processQueue(sock) {
  if (isProcessing) return;
  isProcessing = true;

  console.log("🚀 Worker dimulai");

  while (config.active) {
    try {
      if (!sock || !sock.ws || sock.ws.readyState !== 1) {
        console.log("⏳ Socket belum ready...");
        await delay(3000);
        continue;
      }

      if (!isReady) {
        console.log("⏳ Menunggu sync...");
        await delay(3000);
        continue;
      }

      // build queue
      if (queue.length === 0) {
        const groups = await sock.groupFetchAllParticipating().catch(() => null);

        if (!groups) {
          console.log("⚠️ Gagal ambil grup");
          await delay(5000);
          continue;
        }

        queue = buildQueue(groups);
        sentCache.clear(); // ✅ reset anti double
        console.log(`📦 Queue baru: ${queue.length} grup`);
      }

      const id = queue.shift();
      if (!id) continue;

      // ✅ anti duplicate send
      if (sentCache.has(id)) continue;

      try {
        await sock.sendMessage(id, { text: config.text });
        sentCache.add(id);
        console.log(`✅ ${id}`);
      } catch (err) {
        console.log(`❌ ${id}:`, err?.message || err);
      }

      sentCount++;

      if (sentCount >= config.maxPerSession) {
        console.log("🛑 Cooldown 10 menit...");
        sentCount = 0;
        await delay(10 * 60 * 1000);
      }

      const d = getRandomDelay();
      console.log(`⏳ Delay ${Math.floor(d / 1000)} detik`);
      await delay(d);

    } catch (err) {
      console.log("❌ Loop error:", err?.message || err);
      await delay(5000);
    }
  }

  console.log("🛑 Worker berhenti");
  isProcessing = false;
}

// ================= START =================
async function startBot() {
  console.log("🔄 Memulai bot...");

  // ✅ kill socket lama
  if (currentSock) {
    try { currentSock.end(); } catch {}
  }

  // reset state
  queue = [];
  sentCache.clear();
  sentCount = 0;
  isProcessing = false;
  isReady = false;

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  // ================= CONNECTION =================
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {

    if (connection === "open") {
      console.log("✅ Connected");

      isReady = true; // ✅ FIX: tidak pakai receivedPendingNotifications

      if (config.active && !isProcessing) {
        processQueue(sock);
      }
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnect:", reason);

      isReady = false;
      isProcessing = false;

      if (reason === DisconnectReason.loggedOut) {
        console.log("🛑 Session logout! Hapus session.");
        process.exit(0);
      }

      console.log("🔄 Reconnect 5 detik...");
      setTimeout(startBot, 5000);
    }
  });

  // ================= PAIRING =================
  if (!sock.authState.creds.registered) {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const nomor = await new Promise(resolve => {
      readline.question("📱 Nomor (62xxx): ", answer => {
        readline.close();
        resolve(answer);
      });
    });

    const code = await sock.requestPairingCode(nomor.replace(/[^0-9]/g, ""));
    console.log("🔑 Pairing code:", code);
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

        if (isReady && !isProcessing) processQueue(sock);
        break;

      case ".off":
        config.active = false;
        saveConfig();
        reply("🛑 Broadcast OFF");
        break;

      case ".teks":
        const newText = text.slice(6).trim();
        if (!newText) return reply("❌ Teks kosong");
        config.text = newText;
        saveConfig();
        reply("✅ Teks diupdate");
        break;

      case ".status":
        reply(
          `📊 STATUS\n\n` +
          `Aktif: ${config.active ? "ON" : "OFF"}\n` +
          `Queue: ${queue.length}\n` +
          `Processing: ${isProcessing}`
        );
        break;
    }
  });
}

// ================= RUN =================
startBot();