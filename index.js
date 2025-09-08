const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const readline = require('readline');
const clc = require('cli-color');

// === CONFIG ===
const CONFIG_FILE = 'config.json';
let config = {
  delay_loop: 15,
  owner_number: '6281243027475@s.whatsapp.net',
  broadcast_text: ''
};

// Baca config jika ada, atau buat file baru jika belum ada
if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE));
  } catch (err) {
    console.error('❌ Gagal membaca config.json, menggunakan default', err.message);
    saveConfig(); // buat file baru dengan default
  }
} else {
  saveConfig(); // buat file baru dengan default config
}

// Simpan config
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('💾 Config tersimpan di config.json');
}

// Status broadcast
let broadcastActive = false;
let isLooping = false;

// Random delay helper (detik)
const randomDelay = (min = 2, max = 5) => Math.floor(Math.random() * (max - min + 1) + min) * 1000;

// === BROADCAST SEKALI ===
async function Broadcastonce(sock, pesanBroadcast, sender, lastMsgMedia = null) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupJids = Object.keys(groups);
    console.log(`📢 Memulai broadcast sekali ke ${groupJids.length} grup...`);
    await sock.sendMessage(sender, { text: `📢 Broadcast dimulai` });

    for (const jid of groupJids) {
      try {
        const msgOptions = {};
        if (pesanBroadcast) msgOptions.text = pesanBroadcast;
        if (lastMsgMedia) {
          if (lastMsgMedia.type === 'image') msgOptions.image = { url: lastMsgMedia.url };
          if (lastMsgMedia.type === 'video') msgOptions.video = { url: lastMsgMedia.url };
          if (pesanBroadcast) msgOptions.caption = pesanBroadcast;
        }
        await sock.sendMessage(jid, msgOptions);
        console.log(`✅ Broadcast ke ${jid} berhasil`);
      } catch (err) {
        console.error(`❌ Gagal broadcast ke ${jid}:`, err.message);
      }
      await new Promise(r => setTimeout(r, randomDelay()));
    }

    await sock.sendMessage(sender, { text: '📢 Broadcast selesai!' });
    console.log('📢 Broadcast sekali selesai');
  } catch (err) {
    console.error('❌ Terjadi kesalahan saat broadcast:', err.message);
  }
}

// === LOOP BROADCAST ===
async function startBroadcastLoop(sock, pesanBroadcast, sender, lastMsgMedia = null) {
  if (isLooping) return;
  isLooping = true;
  broadcastActive = true;

  while (broadcastActive) {
    try {
      const groups = await sock.groupFetchAllParticipating();
      const groupJids = Object.keys(groups);
      console.log(`📢 Broadcast loop ke ${groupJids.length} grup...`);
      await sock.sendMessage(sender, { text: "📢 Auto Jpm dimulai/dilanjutkan" });

      for (const jid of groupJids) {
        if (!broadcastActive) break;

        try { 
          const msgOptions = {};
          if (pesanBroadcast) msgOptions.text = pesanBroadcast;
          if (lastMsgMedia) {
            if (lastMsgMedia.type === 'image') msgOptions.image = { url: lastMsgMedia.url };
            if (lastMsgMedia.type === 'video') msgOptions.video = { url: lastMsgMedia.url };
            if (pesanBroadcast) msgOptions.caption = pesanBroadcast;
          }
          await sock.sendMessage(jid, msgOptions);
          console.log(`✅ Broadcast ke ${jid}`); 
        } catch (err) { 
          console.error(`❌ Gagal broadcast ke ${jid}:`, err.message); 
        }

        const totalDelay = randomDelay();
        const step = 100;
        for (let elapsed = 0; elapsed < totalDelay; elapsed += step) {
          if (!broadcastActive) break;
          await new Promise(r => setTimeout(r, step));
        }
        if (!broadcastActive) break;
      }

      if (!broadcastActive) break;

      await sock.sendMessage(sender, { text: `📢 Loop selesai, menunggu ${config.delay_loop} menit...` });
      console.log(`⏳ Menunggu ${config.delay_loop} menit sebelum loop berikutnya...`);

      const totalLoopDelay = config.delay_loop * 60 * 1000;
      const step = 1000;
      for (let elapsed = 0; elapsed < totalLoopDelay; elapsed += step) {
        if (!broadcastActive) break;
        await new Promise(r => setTimeout(r, step));
      }

    } catch (err) {
      console.error('❌ Error broadcast loop:', err.message);
      await sock.sendMessage(sender, { text: `❌ Error broadcast loop: ${err.message}` });
      break;
    }
  }

  broadcastActive = false;
  isLooping = false;
  console.log('⏹️ Broadcast loop dihentikan');
}

// === JOIN MULTI LINK ===
async function handleJoinCommand(sock, sender, pesan) {
  const links = pesan.match(/https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/g) || [];
  if (!links.length) return sock.sendMessage(sender, { text: '⚠️ Tidak ada link grup valid ditemukan.' });

  await sock.sendMessage(sender, { text: `🔗 Ditemukan ${links.length} link. Memproses join...` });

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    try {
      const code = link.split('/').pop();
      const res = await sock.groupAcceptInvite(code);
      await sock.sendMessage(sender, { text: `✅ Berhasil join grup (${i+1}/${links.length})\nID: ${res}` });
      console.log(`✅ Bot join link: ${link}`);
    } catch (err) {
      await sock.sendMessage(sender, { text: `❌ Gagal join link: ${link}\nAlasan: ${err.message}` });
      console.error(`❌ Gagal join link: ${link}`, err.message);
    }
    await new Promise(r => setTimeout(r, 10000));
  }

  await sock.sendMessage(sender, { text: '📢 Proses join semua link selesai!' });
}

// === REFRESH GRUP ===
async function handleRefreshGrup(sock, sender) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups);

    let announceCount = 0;
    let nonAnnounceCount = 0;

    for (const g of groupList) {
      if (g.announce) announceCount++;
      else nonAnnounceCount++;
    }

    const total = groupList.length;
    const text = `📌 Ringkasan Grup:\n\n` +
                 `Total grup: ${total}\n` +
                 `Grup announce: ${announceCount}\n` +
                 `Grup non-announce: ${nonAnnounceCount}`;

    await sock.sendMessage(sender, { text });
    console.log(`✅ Refresh grup sukses. Total: ${total}, Announce: ${announceCount}, Non-announce: ${nonAnnounceCount}`);
  } catch (err) {
    console.error('❌ Gagal refresh grup:', err.message);
    await sock.sendMessage(sender, { text: '❌ Gagal refresh grup' });
  }
}

// === START SOCKET ===
async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('session');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, logger: pino({ level:'silent' }), auth: state, printQRInTerminal: false });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg?.message) continue;
      const jid = msg.key.remoteJid;
      const fromMe = msg.key.fromMe;
      const sender = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);

      // Ambil pesan / caption media
      let pesan = '';
      let lastMsgMedia = null;
      try { 
        if (msg.message.conversation) pesan = msg.message.conversation;
        else if (msg.message?.extendedTextMessage?.text) pesan = msg.message.extendedTextMessage.text;
        else if (msg.message?.imageMessage?.caption) {
          pesan = msg.message.imageMessage.caption;
          lastMsgMedia = { type: 'image', url: await sock.downloadMediaMessage(msg) };
        } else if (msg.message?.videoMessage?.caption) {
          pesan = msg.message.videoMessage.caption;
          lastMsgMedia = { type: 'video', url: await sock.downloadMediaMessage(msg) };
        }
      } catch { continue; }

      if (jid.endsWith('@g.us') && !fromMe) continue;
      if (!sender.includes(config.owner_number.replace('@s.whatsapp.net','')) && !fromMe) continue;

      const reply = async text => await sock.sendMessage(jid, { text });
      if (!pesan.startsWith('.')) continue;

      const args = pesan.trim().split(' ');
      const cmd = args[0].slice(1).toLowerCase();
      const pesanCommand = pesan.slice(pesan.indexOf(' ') + 1).trim();

      switch (cmd) {
        case 'ping':
          await reply('Bot sudah aktif ✅');
          break;

        case 'join':
          if (!pesanCommand) return reply('❌ Kirim link grup setelah perintah .join');
          await handleJoinCommand(sock, sender, pesanCommand);
          break;

        case 'refresh':
          await handleRefreshGrup(sock, sender);
          break;

        case 'teks':
          if (!pesanCommand) return reply('❌ Silakan tulis teks broadcast.\nContoh: .teks Halo semua!');
          config.broadcast_text = pesanCommand;
          saveConfig();
          await reply('✅ Teks broadcast berhasil disimpan di config.json');
          break;

        case 'jpm':
          if (!config.broadcast_text && !lastMsgMedia) 
              return reply('⚠️ Silakan tambahkan teks broadcast terlebih dahulu menggunakan .teks atau kirim media dengan caption perintah .teks');
          await Broadcastonce(sock, config.broadcast_text, sender, lastMsgMedia);
          break;

        case 'autojpm':
          if (!config.broadcast_text && !lastMsgMedia) 
              return reply('⚠️ Silakan tambahkan teks broadcast terlebih dahulu menggunakan .teks atau kirim media dengan caption perintah .teks');
          if (broadcastActive) return reply('❌ Broadcast sudah aktif!');
          broadcastActive = true;
          await reply(`✅ Auto Jpm berhasil diaktifkan. Pesan akan dikirim setiap ${config.delay_loop} menit`);
          startBroadcastLoop(sock, config.broadcast_text, sender, lastMsgMedia);
          break;

        case 'setdelay':
          if (!args[1] || isNaN(args[1])) return reply('❌ Format salah!\nGunakan: .setdelay <menit>\nContoh: .setdelay 30');
          config.delay_loop = parseInt(args[1]);
          saveConfig();
          await reply(`✅ Delay loop diubah menjadi ${config.delay_loop} menit`);
          break;

        case 'stop':
          if (!broadcastActive) return reply('❌ Broadcast belum aktif!');
          broadcastActive = false;
          await reply('✅ Broadcast loop dihentikan');
          break;

        case 'status':
          await reply(`Bot sedang ${broadcastActive ? 'Aktif' : 'Tidak aktif'}\nDelay saat ini: ${config.delay_loop} menit`);
          break;

        case 'help':
          await reply(
            `╔═•✦•══════════╗\n` +
            `      📢 *Broadcast Bot* 📢\n` +
            `╚════════•✦•═╝\n\n` +
            `.jpm\n` +
            `.autojpm\n` +
            `.teks <pesan>\n` +
            `.setdelay <menit>\n` +
            `.refresh\n` +
            `.join <link>\n` +
            `.stop\n` +
            `.status\n` +
            `.help`
          );
          break;

        default:
          await reply('❌ Perintah tidak dikenal. Ketik .help untuk daftar perintah.');
          break;
      }
    }
  });

  if (!sock.authState.creds.registered) {
    const phoneNumber = await new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Masukkan nomor (ex:62xxx): ', answer => { rl.close(); resolve(answer) });
    });
    const code = await sock.requestPairingCode(phoneNumber.trim());
    console.log(clc.yellow.bold(`🔑 Kode pairing: ${code}`));
  }

  sock.ev.on('connection.update', update => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) console.log('❌ Logged out, hapus session dan scan ulang');
      else { console.log('🔄 Reconnect...'); startSock(); }
    } else if (connection === 'open') console.log('✅ Bot berhasil connect');
  });

  sock.ev.on('creds.update', saveCreds);
}

startSock();

process.on('unhandledRejection', reason => {
  console.error('⚠️ Unhandled Rejection:', reason);
  fs.appendFileSync('error.log', `[${new Date().toISOString()}] ${reason}\n`);
});
process.on('uncaughtException', err => {
  console.error('❌ Uncaught Exception:', err);
  fs.appendFileSync('error.log', `[${new Date().toISOString()}] ${err}\n`);
});