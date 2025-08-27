const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const readline = require('readline');

// === FILE CONFIG ===
const CONFIG_FILE = 'config.json';
const PROMO_FILE = 'promo.json';

let promoteActive = false; 
let promoteTimer = null;  

// === LOAD / SAVE CONFIG ===
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ delay: 5000, interval: "1h" }, null, 2));
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE));
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
function loadPromo() {
  if (!fs.existsSync(PROMO_FILE)) fs.writeFileSync(PROMO_FILE, JSON.stringify([], null, 2));
  return JSON.parse(fs.readFileSync(PROMO_FILE));
}
function savePromo(promos) {
  fs.writeFileSync(PROMO_FILE, JSON.stringify(promos, null, 2));
}
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// === PARSER DURASI ===
function parseDuration(str) {
  const regex = /(\d+)([smhd])/g;
  let ms = 0, match;
  while ((match = regex.exec(str)) !== null) {
    const val = parseInt(match[1]);
    const unit = match[2];
    if (unit === 's') ms += val * 1000;
    if (unit === 'm') ms += val * 60 * 1000;
    if (unit === 'h') ms += val * 60 * 60 * 1000;
    if (unit === 'd') ms += val * 24 * 60 * 60 * 1000;
  }
  return ms;
}

// === AUTO PROMOTE LOOP ===
async function autoPromoteLoop(sock) {
  try {
    if (!promoteActive) return;

    const promos = loadPromo();
    const cfg = loadConfig();
    if (promos.length === 0) {
      console.log("⚠️ Tidak ada pesan promo, gunakan .setpromo dulu");
      return;
    }

    const groups = await sock.groupFetchAllParticipating();
    const groupIds = Object.keys(groups);

    console.log(`📢 Kirim promo ke ${groupIds.length} grup, delay ${cfg.delay / 1000}s`);

    for (let i = 0; i < groupIds.length; i++) {
      if (!promoteActive) {
        console.log("🛑 AutoPromote dihentikan di tengah jalan.");
        return;
      }
      const groupId = groupIds[i];
      for (let pesan of promos) {
        await sock.sendMessage(groupId, { text: pesan });
        console.log(`✅ Terkirim ke ${groups[groupId].subject}: ${pesan}`);
      }
      if (i < groupIds.length - 1) {
        await delay(cfg.delay);
      }
    }

    console.log("🎉 Semua promo terkirim!");
    if (promoteActive) {
      const ulang = parseDuration(cfg.interval) || 60 * 60 * 1000;
      console.log(`⏳ Tunggu ${(ulang / 1000 / 60).toFixed(1)} menit untuk siklus berikutnya...`);
      promoteTimer = setTimeout(() => autoPromoteLoop(sock), ulang);
    }
  } catch (err) {
    console.error("❌ Error autopromote:", err);
  }
}

// === PAIRING LOGIN (NO QR) ===
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" })
  });

  sock.ev.on('creds.update', saveCreds);

  // Pairing code jika belum login
  if (!sock.authState.creds.registered) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (text) => new Promise((res) => rl.question(text, res));
    const nomor = await question("Masukkan nomor WhatsApp (contoh: 628xx): ");
    rl.close();

    const code = await sock.requestPairingCode(nomor);
    console.log(`🔗 Pairing code untuk ${nomor}: ${code}`);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log('✅ Bot berhasil login!');
    } else if (connection === 'close') {
      console.log('❌ Koneksi terputus, mencoba ulang...');
      startBot();
    }
  });

  // === EVENT MESSAGE ===
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;
    const from = m.key.remoteJid;
    const type = Object.keys(m.message)[0];
    const body = type === "conversation" ? m.message.conversation :
      type === "extendedTextMessage" ? m.message.extendedTextMessage.text : "";

    if (!body.startsWith('.')) return;
    const cmd = body.split(" ")[0].slice(1).toLowerCase();
    const pesanCommand = body.split(" ").slice(1).join(" ");
    const config = loadConfig();

    async function reply(text) {
      await sock.sendMessage(from, { text });
    }

    switch (cmd) {
      case 'setpromo':
        if (!pesanCommand) return reply("❌ Format: .setpromo <pesan>");
        const promos = loadPromo();
        promos.push(pesanCommand);
        savePromo(promos);
        reply(`✅ Promo ditambahkan:\n${pesanCommand}`);
        break;

      case 'setdelay':
        if (!pesanCommand) return reply("❌ Format: .setdelay 5s / 10s / 2m");
        config.delay = parseDuration(pesanCommand);
        saveConfig(config);
        reply(`✅ Delay diatur: ${pesanCommand}`);
        break;

      case 'setinterval':
        if (!pesanCommand) return reply("❌ Format: .setinterval 30m / 2h / 1d");
        config.interval = pesanCommand;
        saveConfig(config);
        reply(`✅ Interval diatur: ${pesanCommand}`);
        break;

      case 'autopromote':
        if (promoteActive) return reply("⚠️ AutoPromote sudah berjalan!");
        promoteActive = true;
        reply("🚀 AutoPromote dimulai 24/7...");
        autoPromoteLoop(sock);
        break;

      case 'stopromote':
        if (!promoteActive) return reply("⚠️ AutoPromote tidak aktif.");
        promoteActive = false;
        if (promoteTimer) clearTimeout(promoteTimer);
        reply("🛑 AutoPromote dihentikan.");
        break;

      case 'cekpromo':
        const list = loadPromo();
        if (list.length === 0) return reply("⚠️ Belum ada promo");
        reply("📋 Daftar Promo:\n" + list.map((p, i) => `${i + 1}. ${p}`).join("\n"));
        break;

      case 'delpromo':
        const promosNow = loadPromo();
        if (promosNow.length === 0) return reply("⚠️ Tidak ada promo");
        promosNow.pop();
        savePromo(promosNow);
        reply("🗑️ Promo terakhir dihapus");
        break;
    }
  });
}

startBot();