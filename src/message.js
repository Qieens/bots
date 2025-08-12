async function GroupParticipantsUpdate(sock, update, store) {
  // contoh log update peserta grup
  console.log('GroupParticipantsUpdate:', update)
  // bisa update store.groupMetadata atau data lainnya
}

async function MessagesUpsert(sock, { messages }, store) {
  // contoh handle pesan masuk
  const msg = messages[0]
  console.log('Pesan masuk:', msg.key.remoteJid, msg.message)
  // bisa tambah fitur command lain di sini
}

module.exports = { GroupParticipantsUpdate, MessagesUpsert }
