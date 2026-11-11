// node tests/pc-chat-close.cjs：验证外链会话及切换会话后的关闭行为。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')
function load(file, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports =')
  const context = vm.createContext({ module: { exports: {} }, ...globals })
  vm.runInContext(script, context)
  return { definition: context.module.exports, source }
}
let closes = 0
const { definition: pageDef, source: pageSource } = load('pages/ehr/pc/chat.vue', {
  PcChatPanel: {}, PcChatHistoryPanel: {}, window: { close: () => closes++ }
})
const { definition: panelDef } = load('components/pc-chat-panel/pc-chat-panel.vue')
const page = { ...pageDef.data(), _conversationPageAlive: true, pageVisible: true,
  activeMainTab: 'recent', selectedId: 'p2p-a', chatDetail: { conversationId: 'p2p-a', personAccId: 'a' } }
page.handleChatNavigateBack = pageDef.methods.handleChatNavigateBack.bind(page)
const panel = { conversationId: 'p2p-a', $emit: (event, id) => {
  assert.equal(event, 'navigate-back')
  page.handleChatNavigateBack(id)
} }
assert.match(pageSource, /@navigate-back="handleChatNavigateBack"/)
const navigateBack = () => panelDef.methods.navigateBack.call(panel)

navigateBack()
assert.equal(closes, 0, '无会话参数时不关闭')
page.routePersonAccId = 'b'
navigateBack()
assert.equal(closes, 0, '选中会话与参数不匹配时不关闭')
page.routePersonAccId = 'a'
navigateBack()
assert.equal(closes, 1, '选中外链会话时关闭')
page.selectedId = 'p2p-b'
navigateBack()
assert.equal(closes, 1, '旧会话回调不能关闭页面')
page.selectedId = 'p2p-a'
page.openingConversationId = 'p2p-b'
navigateBack()
assert.equal(closes, 1, '切换会话过程中不关闭')
page.openingConversationId = ''
page.activeMainTab = 'history'
navigateBack()
assert.equal(closes, 1, '历史会话选中时不关闭')
page.activeMainTab = 'recent'
page.pageVisible = false
navigateBack()
assert.equal(closes, 1, '页面隐藏后的回调不关闭')
console.log('pc chat close tests passed')
