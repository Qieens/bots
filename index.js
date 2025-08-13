process.env.BAILEYS_NO_LOG = 'true'

const fs = require('fs')
const os = require('os')
const pino = require('pino')
const chalk = require('chalk')
const qrcode = require('qrcode-terminal')
const { Boom } = require('@hapi/boom')
const { decodeJid } = require('@whiskeysockets/baileys')
const { default: WAConnection, useMultiFileAuthState, Browsers, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, jidNormalizedUser } = require('@whiskeysockets/baileys')
const { GroupParticipantsUpdate, MessagesUpsert } = require('./src/message')
const { exec } = require('child_process')
const { loadConfig, saveConfig } = require('./src/config')
const { save, load } = require('./src/sqlitedb')

const OWNER_NUMBER = '628975539822@s.whatsapp.net' // ganti nomor owner kamu
const BATCH_SIZE = 20

// Load config
let config = loadConfig()
let { currentText, currentIntervalMs, broadcastActive, variatetextActive } = config
const updateConfig = () => {
  config.currentText = currentText
  config.currentIntervalMs = currentIntervalMs
  config.broadcastActive = broadcastActive
  config.variatetextActive = variatetextActive
  saveConfig(config)
}

// Utils
const parseInterval = (text) => {
  const match = text.match(/^(\d+)(s|m|h)$/i)
  if (!match) return null
  const num = parseInt(match[1])
  return match[2].toLowerCase() === 's' ? num * 1000 : match[2].toLowerCase() === 'm' ? num * 60000 : num * 3600000
}

const humanInterval = (ms) => {
  if (ms < 60000) return `${ms / 1000}s`
  if (ms < 3600000) return `${ms / 60000}m`
  return `${ms / 3600000}h`
}

const variateText = (text) => {
  if (!variatetextActive) return text
  const emojis = ['✨', '✅', '🔥', '🚀', '📌', '🧠']
  const zwsp = '\u200B'
  const emoji = emojis[Math.floor(Math.random() * emojis.length)]
  const rand = Math.floor(Math.random() * 3)
  return rand === 0 ? text + ' ' + emoji
    : rand === 1 ? text.replace(/\s/g, m => m + (Math.random() > 0.8 ? zwsp : ''))
    : text
}

const delay = ms => new Promise(res => setTimeout(res, ms))

let globalStore = {}
let globalDB = {}

async function loadDBs() {
  const loadData = load('database')
  const storeLoadData = load('store')
  globalDB = loadData && Object.keys(loadData).length > 0 ? loadData : {
    hit: {}, set: {}, cmd: {}, store: {}, users: {}, game: {}, groups: {}, database: {}, premium: [], sewa: []
  }
  globalStore = storeLoadData && Object.keys(storeLoadData).length > 0 ? storeLoadData : {
    contacts: {}, presences: {}, messages: {}, groupMetadata: {}
  }
}

// Broadcast system
let broadcastTimeout
let isBroadcastRunning = false
let groupCache = {}

async function refreshGroups(sock) {
  try {
    groupCache = await sock.groupFetchAllParticipating()
    console.log(`🔄 Cache grup diperbarui: ${Object.keys(groupCache).length} grup`)
  } catch (err) {
    console.error('Gagal refresh group cache:', err.message)
  }
}

async function sendBatch(sock, batch, text) {
  for (const jid of batch) {
    try {
      await sock.sendMessage(jid, { text: variateText(text) })
      console.log(`✅ Broadcast terkirim ke ${jid}`)
      await delay(5000)
    } catch (err) {
      console.error(`❌ Gagal broadcast ke ${jid}:`, err.message)
    }
  }
}

async function broadcastAll(sock) {
  if (!currentText) return

  let sentGroups = new Set()

  while (true) {
    const allGroups = Object.entries(groupCache)
      .filter(([jid, info]) => !info.announce && !sentGroups.has(jid))
      .map(([jid]) => jid)

    if (allGroups.length === 0) {
      await sock.sendMessage(OWNER_NUMBER, { text: '✅ Semua grup sudah dikirimi broadcast.' })
      break
    }

    const batch = allGroups.slice(0, BATCH_SIZE)

    await sock.sendMessage(OWNER_NUMBER, { text: `📢 Mulai kirim batch, ukuran batch: ${batch.length}` })
    await sendBatch(sock, batch, currentText)
    await sock.sendMessage(OWNER_NUMBER, { text: `✅ Batch selesai dikirim.` })

    batch.forEach(jid => sentGroups.add(jid))

    await refreshGroups(sock)
    await delay(10000)
  }
}

async function startBroadcastLoop(sock) {
  if (broadcastTimeout) clearTimeout(broadcastTimeout)
  if (isBroadcastRunning) return
  isBroadcastRunning = true
  await refreshGroups(sock)

  async function loop() {
    if (!broadcastActive) {
      isBroadcastRunning = false
      return
    }
    await broadcastAll(sock)
    await delay(currentIntervalMs)
    await refreshGroups(sock)
    return loop()
  }

  return loop()
}

// Bot start
async function startNazeBot() {
  await loadDBs()
  // auto save interval
  setInterval(() => {
    if (globalDB) save('database', globalDB)
    if (globalStore) save('store', globalStore)
  }, 30000)

  const { state, saveCreds } = await useMultiFileAuthState('nazedev')
  const { version, isLatest } = await fetchLatestBaileysVersion()
  const level = pino({ level: 'silent' })

  globalStore.loadMessage = function (remoteJid, id) {
    const messages = globalStore.messages?.[remoteJid]?.array
    if (!messages) return null
    return messages.find(msg => msg?.key?.id === id) || null
  }
  const getMessage = async (key) => {
    if (globalStore) {
      const msg = await globalStore.loadMessage(key.remoteJid, key.id)
      return msg?.message || ''
    }
    return { conversation: 'Halo Saya Naze Bot' }
  }

  const naze = WAConnection({
    logger: level,
    getMessage,
    syncFullHistory: true,
    maxMsgRetryCount: 15,
    retryRequestDelayMs: 10,
    defaultQueryTimeoutMs: 0,
    connectTimeoutMs: 60000,
    browser: Browsers.ubuntu('Chrome'),
    generateHighQualityLinkPreview: true,
    shouldSyncHistoryMessage: msg => !!msg.syncType,
    transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 10 },
    appStateMacVerification: { patch: true, snapshot: true },
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, level) },
  })

  naze.ev.on('creds.update', saveCreds)

  naze.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect, isNewLogin } = update
    if (qr) {
      console.clear()
      console.log(`📅 ${new Date().toLocaleString()} | 📌 Scan QR:\n`)
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') {
      console.log('✅ Bot connected')
      if (broadcastActive) {
        await naze.sendMessage(OWNER_NUMBER, { text: `♻️ Melanjutkan broadcast...\nInterval: ${humanInterval(currentIntervalMs)}` })
        startBroadcastLoop(naze)
      }
    }
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode
      console.log(`❌ Connection closed, code: ${reason}`)
      if (reason !== DisconnectReason.loggedOut) {
        console.log('🔁 Reconnecting in 5 seconds...')
        setTimeout(() => startNazeBot(), 5000)
      } else {
        console.log('⚠️ Session logged out, silakan scan ulang QR')
        exec('rm -rf ./nazedev/*')
        process.exit(1)
      }
    }
  })

  naze.ev.on('group-participants.update', async (update) => {
    await GroupParticipantsUpdate(naze, update, globalStore)
    await refreshGroups(naze)
  })

  naze.ev.on('groups.update', (updates) => {
    for (const update of updates) {
      if (globalStore.groupMetadata[update.id]) Object.assign(globalStore.groupMetadata[update.id], update)
      else globalStore.groupMetadata[update.id] = update
    }
  })

  naze.ev.on('presence.update', ({ id, presences: update }) => {
    globalStore.presences[id] = globalStore.presences?.[id] || {}
    Object.assign(globalStore.presences[id], update)
  })

  let lastDecryptWarn = 0
  const decryptWarnInterval = 60 * 1000

  naze.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const jid = msg.key.remoteJid || ''
    const fromOwner = jid === OWNER_NUMBER
    const isGroup = jid.endsWith('.g.us')

    if (isGroup && !fromOwner) return
    if (!fromOwner) return

    try {
      const teks = msg.message.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || ''

      const reply = (text) => naze.sendMessage(OWNER_NUMBER, { text })

      // Command Join Grup
      if (teks.startsWith('.join ')) {
        const links = teks.split(' ').slice(1) // ambil semua link setelah .join
        if (links.length === 0) return reply('❌ Format salah. Contoh: `.join https://chat.whatsapp.com/xxxxx`')

        for (const link of links) {
          if (!link.includes('whatsapp.com')) {
            await reply(`❌ Link tidak valid: ${link}`)
            continue
          }
          const code = link.split('/').pop().split('?')[0] // ambil kode invite tanpa query params
          try {
            await naze.groupAcceptInvite(code)
            await reply(`✅ Berhasil masuk grup: ${link}`)
          } catch (err) {
            await reply(`❌ Gagal masuk grup: ${err.message} (${link})`)
          }
          // Delay 5 detik biar gak spam request sekaligus
          await delay(5000)
        }
      }

      // Broadcast commands
      if (teks.startsWith('.teks ')) {
        currentText = teks.slice(6).trim()
        updateConfig()
        return reply('✅ Pesan broadcast disimpan.')
      }
      if (teks.startsWith('.setinterval ')) {
        const val = parseInterval(teks.slice(13).trim())
        if (!val) return reply('❌ Format salah. Contoh: `.setinterval 5m`')
        currentIntervalMs = val
        updateConfig()
        return reply(`✅ Interval broadcast diset: ${humanInterval(val)}`)
      }
      if (teks === '.variasi on') {
        variatetextActive = true
        updateConfig()
        return reply('✅ Variasi teks diaktifkan.')
      }
      if (teks === '.variasi off') {
        variatetextActive = false
        updateConfig()
        return reply('✅ Variasi teks dinonaktifkan.')
      }
      if (teks === '.start') {
        if (!currentText) return reply('❌ Set pesan dulu dengan `.teks <pesan>`')
        if (broadcastActive) return reply('❌ Broadcast sudah aktif.')
        broadcastActive = true
        updateConfig()
        startBroadcastLoop(naze)
        return reply('✅ Broadcast dimulai.')
      }
      if (teks === '.stop') {
        if (!broadcastActive) return reply('❌ Broadcast belum aktif.')
        broadcastActive = false
        if (broadcastTimeout) clearTimeout(broadcastTimeout)
        updateConfig()
        return reply('🛑 Broadcast dihentikan.')
      }
      if (teks === '.status') {
        return reply(`📊 Status Broadcast:\n\nAktif: ${broadcastActive ? '✅ Ya' : '❌ Tidak'}\nInterval: ${humanInterval(currentIntervalMs)}\nVariasi : ${variatetextActive ? '✅ Aktif' : '❌ Mati'}\nPesan: ${currentText || '⚠️ Belum diset!'}`)
      }

      // process pesan lain
      await MessagesUpsert(naze, { messages }, globalStore)

    } catch (e) {
      if (e.message && e.message.includes('Failed decrypt')) {
        console.warn('⚠️ Gagal decrypt pesan.')
        const now = Date.now()
        if (now - lastDecryptWarn > decryptWarnInterval) {
          lastDecryptWarn = now
          await naze.sendMessage(OWNER_NUMBER, { text: '⚠️ Pesan gagal didekripsi, mohon kirim ulang.' }).catch(() => {})
        }
      } else {
        console.error('Error di messages.upsert:', e)
      }
    }
  })

  setInterval(async () => {
    if (naze?.user?.id) await naze.sendPresenceUpdate('available', decodeJid(naze.user.id)).catch(() => {})
  }, 10 * 60 * 1000)

  return naze
}

startNazeBot()

process.on('SIGINT', () => {
  console.log('SIGINT diterima, menyimpan database...')
  if (globalDB) save('database', globalDB)
  if (globalStore) save('store', globalStore)
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('SIGTERM diterima, menyimpan database...')
  if (globalDB) save('database', globalDB)
  if (globalStore) save('store', globalStore)
  process.exit(0)
})
