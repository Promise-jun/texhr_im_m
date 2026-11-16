// node tests/nim-not-ready-notice.cjs: the NIM unavailable notice is shared across chat surfaces.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../services/nim.js'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')
const toasts = []
const listeners = new Map()
const context = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  NIM_EVENT: { LOGIN_STATUS: 'login-status' },
  uni: { showToast: value => toasts.push(value), $emit() {} }
})
vm.runInContext(source, context)

assert.equal(context.notifyNimNotReady(), true)
assert.equal(context.notifyNimNotReady(), false)
assert.equal(context.notifyNimNotReady('send'), true, 'message sending has its own necessary notice')
assert.equal(context.notifyNimNotReady('send'), false)
assert.equal(toasts.length, 2)
assert.equal(toasts[0].title, '聊天服务尚未就绪')

context.bindLoginListeners({ V2NIMLoginService: { on: (event, callback) => listeners.set(event, callback) } })
listeners.get('onLoginStatus')(1)
assert.equal(context.notifyNimNotReady(), true)
assert.equal(context.notifyNimNotReady('send'), true)
assert.equal(toasts.length, 4, 'successful login resets both notice contexts')

context.logoutNim().then(() => {
  assert.equal(context.notifyNimNotReady(), true)
  assert.equal(context.notifyNimNotReady('send'), true)
  assert.equal(toasts.length, 6, 'logout resets both notice contexts')
  console.log('PASS: action and send notices are independently shown once per logged-out period')
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})
