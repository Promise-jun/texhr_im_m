// node tests/pc-chat-logout.cjs：不访问真实退出地址。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../pages/ehr/pc/chat.vue'), 'utf8')
let modal
let opened = false
const window = { location: { href: 'http://localhost/chat' }, open() { opened = true } }
const context = vm.createContext({ module: { exports: {} }, PcChatPanel: {}, PcChatHistoryPanel: {},
  window, uni: { showModal(options) { modal = options } } })
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')
vm.runInContext(script, context)

context.module.exports.methods.confirmLogout()
assert.equal(modal.title, '退出登录')
assert.equal(window.location.href, 'http://localhost/chat')
modal.success({ confirm: false, cancel: true })
assert.equal(window.location.href, 'http://localhost/chat')
modal.success({ confirm: true, cancel: false })
assert.equal(window.location.href, 'http://www.texhr.cn/ehr/loginout/')
assert.equal(opened, false)
console.log('PASS: logout requires confirmation and navigates in the current window')
