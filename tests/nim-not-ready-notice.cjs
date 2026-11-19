// node tests/nim-not-ready-notice.cjs: production chat surfaces must not show the removed notice.
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const removedNotice = ['聊天服务', '尚未就绪'].join('')
const removedNotifier = ['notifyNim', 'NotReady'].join('')
const files = []

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(file)
    else if (/\.(js|vue|ts)$/.test(entry.name)) files.push(file)
  }
}

for (const directory of ['components', 'pages', 'services']) collect(path.join(root, directory))

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  assert.ok(!source.includes(removedNotice), `${path.relative(root, file)} still contains the removed notice`)
  assert.ok(!source.includes(removedNotifier), `${path.relative(root, file)} still uses the removed notifier`)
}

console.log(`PASS: removed readiness notice is absent from ${files.length} production files`)
