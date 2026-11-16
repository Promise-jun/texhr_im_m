// node tests/pc-chat-login-pending.cjs: pending NIM login is shown as progress, failures remain visible.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../components/pc-chat-panel/pc-chat-panel.vue'), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')
const state = { loggedIn: false, loginError: null }
const context = vm.createContext({
  module: { exports: {} },
  NIM_EVENT: {},
  NIM_EMOJIS: [],
  PcChatPanel: {},
  PcChatHistoryPanel: {},
  getNimLoginError: () => state.loginError,
  isNimLoggedIn: () => state.loggedIn
})
vm.runInContext(script, context)

const definition = context.module.exports
const panel = {
  ...definition.data.call({ detail: { jobName: '' }, conversation: { stickTop: false } }),
  _alive: true
}
for (const [name, method] of Object.entries(definition.methods)) panel[name] = method.bind(panel)

panel.prepareConversation()
assert.equal(panel.isWaitingForNim, true)
assert.equal(panel.historyError, '')

state.loginError = { message: '登录失败，请重试' }
panel.prepareConversation()
assert.equal(panel.isWaitingForNim, false)
assert.equal(panel.historyError, '登录失败，请重试')

console.log('PASS: pending login stays in a connection state and actual login failure remains visible')
