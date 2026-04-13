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
  delayGroup: 5000, // diperbesar (anti ban)
  delayLoop: 10 * 60 * 1000,
  active: false
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

const delay = ms => new Promise(r => setTimeout(r, ms));
let isLooping = false;
let isConnected = false;

// ================= CHECK SOCKET =================
const isSocketReady = (sock) => {
  return sock?.ws && sock.ws.readyState === 1;
};

// ================= BROADCAST LOOP =================
async function startLoop(sock) {
  if (isLooping) return;
  isLooping = true;

  while (config.active) {
    try {
      // tunggu koneksi siap
      if (!isConnected || !isSocketReady(sock)) {
        console.log("⏳ Menunggu koneksi siap...");
        await delay(5000);
        continue;
      }

      console.log("\n🔁 Broadcast dimulai...");

      const groups = await sock.groupFetchAllParticipating();
      const ids = Object.keys(groups);

      let open = 0, closed = 0;

      console.log(`📊 Total grup: ${ids.length}`);

      for (let id of ids) {
        if (!config.active) break;

        if (!isConnected || !isSocketReady(sock)) {
          console.log("⚠️ Koneksi terputus saat broadcast, pause...");
          break;
        }

        const group = groups[id];

        if (group.announce) {
          closed++;
          console.log(`⛔ Skip (closed): ${group.subject}`);
          continue;
        }

        open++;

        try {
          await sock.sendMessage(id, { text: config.text });
          console.log(`✅ (open) ${group.subject}`);
        } catch (err) {
          console.log(`❌ ${group.subject}:`, err.message);
        }

        await delay(config.delayGroup);
      }

      console.log(`📊 Open: ${open} | Closed: ${closed}`);
      console.log(`⏳ Tunggu ${config.delayLoop / 60000} menit`);

      // delay tapi tetap cek koneksi tiap 5 detik
      let waitTime = 0;
      while (waitTime < config.delayLoop && config.active) {
        if (!isConnected) break;
        await delay(5000);
        waitTime += 5000;
      }

    } catch (err) {
      console.log("❌ Error:", err.message);
      await delay(5000);
    }
  }

  isLooping = false;
}

// ================= START BOT =================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

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
        config.delayLoop = menit * 60 * 1000;
        saveConfig();
        reply(`✅ Delay diubah ke ${menit} menit`);
        break;

      case ".status":
        reply(
          `📊 STATUS\n\n` +
          `Aktif: ${config.active ? "ON" : "OFF"}\n` +
          `Delay: ${config.delayLoop / 60000} menit\n` +
          `Pesan: ${config.text}`
        );
        break;
    }
  });

  // ================= CONNECTION =================
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {

    if (connection === "open") {
      console.log("✅ Connected");
      isConnected = true;

      // kasih delay biar auth stabil
      setTimeout(() => {
        if (config.active) startLoop(sock);
      }, 5000);
    }

    if (connection === "close") {
      isConnected = false;

      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Disconnect:", reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log("🛑 Session invalid. Hapus folder session!");
        process.exit(0);
      }

      // penting: destroy socket lama
      try { sock.ws.close(); } catch {}

      console.log("🔄 Reconnecting...");
      setTimeout(startBot, 5000);
    }
  });
}

startBot();