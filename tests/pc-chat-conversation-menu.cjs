// node tests/pc-chat-conversation-menu.cjs：验证 PC 会话操作菜单的滚动容器边界定位。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const pageSource = fs.readFileSync(path.join(__dirname, '../pages/ehr/pc/chat.vue'), 'utf8')
const context = vm.createContext({ module: { exports: {} }, PcChatPanel: {}, PcChatHistoryPanel: {} })
vm.runInContext(pageSource.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports ='), context)

const definition = context.module.exports
const page = definition.data()
page.activeMainTab = 'recent'
page.openConversationMenu = definition.methods.openConversationMenu.bind(page)
page.$nextTick = callback => callback()

function row(top, menuTop, menuHeight, list) {
  const menu = { getBoundingClientRect: () => ({ top: menuTop, height: menuHeight }) }
  return {
    getBoundingClientRect: () => ({ top }),
    querySelector: selector => selector === '.conversation-action-menu' ? menu : null,
    menu,
    list
  }
}

const list = {
  getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
  querySelector: () => activeRow
}
let activeRow = row(720, 754, 76, list)
page.$refs = { conversationList: { $el: list } }
page.openConversationMenu({ id: 'bottom-row', type: 1 })
assert.equal(page.conversationMenuAbove, true)
assert.equal(page.activeConversationMenuId, 'bottom-row')

activeRow = row(300, 334, 76, list)
page.openConversationMenu({ id: 'middle-row', type: 1 })
assert.equal(page.conversationMenuAbove, false)
assert.equal(page.activeConversationMenuId, 'middle-row')

console.log('pc conversation menu positioning tests passed')
