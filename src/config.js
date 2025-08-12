const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '..', 'config.json')

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
      return JSON.parse(raw)
    }
  } catch (e) {
    console.error('Gagal membaca config:', e)
  }
  return {
    currentText: '',
    currentIntervalMs: 5 * 60 * 1000,
    broadcastActive: false,
    variatetextActive: true
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  } catch (e) {
    console.error('Gagal menyimpan config:', e)
  }
}

module.exports = { loadConfig, saveConfig }
