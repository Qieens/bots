const fs = require('fs')
const path = require('path')

function dataBase(filePath) {
  return {
    read: async () => {
      try {
        if (fs.existsSync(filePath)) {
          const data = await fs.promises.readFile(filePath, 'utf-8')
          return JSON.parse(data)
        }
      } catch (e) {
        console.error('Gagal baca database:', e)
      }
      return {}
    },
    write: async (data) => {
      try {
        await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2))
      } catch (e) {
        console.error('Gagal tulis database:', e)
      }
    }
  }
}

module.exports = { dataBase }
