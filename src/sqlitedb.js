const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.resolve(__dirname, '../database.sqlite')
const db = new Database(dbPath)

db.prepare(`
  CREATE TABLE IF NOT EXISTS keyvalue (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`).run()

function save(key, data) {
  const json = JSON.stringify(data)
  const exists = db.prepare('SELECT 1 FROM keyvalue WHERE key = ?').get(key)
  if (exists) {
    db.prepare('UPDATE keyvalue SET value = ? WHERE key = ?').run(json, key)
  } else {
    db.prepare('INSERT INTO keyvalue (key, value) VALUES (?, ?)').run(key, json)
  }
}

function load(key) {
  const row = db.prepare('SELECT value FROM keyvalue WHERE key = ?').get(key)
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

module.exports = { save, load }
