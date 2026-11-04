// node tests/p2p-read-receipts.cjs: exercise the SDK-facing read receipt contract with in-memory data.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../services/conversation.js'), 'utf8')
  .replace(/import[^\n]+\n/g, '').replace(/^export /gm, '')
const sent = []
let olderPages = []
let receiptTime = 0
let queryFailure = false
const conversation = (id, sender, time, extra = {}) => ({
  conversationId: id, type: 1,
  lastMessage: { messageRefer: { senderId: sender, createTime: time, messageClientId: id + time }, text: 'hello', messageType: 0, ...extra }
})
let list = []
const nim = {
  V2NIMLoginService: { getLoginUser: () => 'self' },
  V2NIMConversationIdUtil: { parseConversationTargetId: id => id },
  V2NIMLocalConversationService: { getConversationList: async () => ({ conversationList: list, finished: true }) },
  V2NIMMessageService: {
    getP2PMessageReceipt: async () => { if (queryFailure) throw new Error('offline'); return { timestamp: receiptTime } },
    sendP2PMessageReceipt: async message => { sent.push(message) },
    getMessageList: async () => olderPages.shift() || []
  }
}
const context = vm.createContext({ getNimInstance: () => nim, isNimLoggedIn: () => true,
  console: { warn() {} }, requestApi: async () => ({}) })
vm.runInContext(source, context)
const message = (senderId, createTime, id = String(createTime)) => ({
  conversationId: 'c', senderId, createTime, messageClientId: id
})

async function main() {
  list = [conversation('c', 'self', 100), conversation('incoming', 'other', 100),
    conversation('failed', 'self', 100, { sendingState: 2 })]
  let rows = await context.getAllNimConversations()
	assert.equal(context.normalizeConversation(rows[0]).readState, '')
  assert.equal(context.normalizeConversation(rows[1]).readState, '')
  assert.equal(context.normalizeConversation(rows[2]).readState, '')
  receiptTime = 100
  rows = await context.getAllNimConversations()
  assert.equal(context.normalizeConversation(rows[0]).readState, '已读')
  const changed = { ...rows[0], lastMessage: conversation('c', 'other', 101).lastMessage }
  assert.equal(context.normalizeConversation(changed).readState, '')
  queryFailure = true
  rows = await context.getAllNimConversations()
  assert.equal(context.normalizeConversation(rows[0]).readState, '')

  // Only the latest incoming message is sent, including when it is on an older page.
  olderPages = [[message('other', 80), message('self', 90)]]
  await context.sendNimP2PReadReceipt('c', [message('self', 100)])
  assert.deepStrictEqual(sent.map(item => item.createTime), [80])
  await context.sendNimP2PReadReceipt('c', [message('other', 70), message('other', 110)])
  await context.sendNimP2PReadReceipt('c', [message('other', 90)])
  assert.deepStrictEqual(sent.map(item => item.createTime), [80, 110])
  await context.sendNimP2PReadReceipt('c', [message('other', 120)], () => false)
  assert.deepStrictEqual(sent.map(item => item.createTime), [80, 110])
  let visible = true
  nim.V2NIMMessageService.getMessageList = async () => { visible = false; return [message('other', 130)] }
  await context.sendNimP2PReadReceipt('c', [message('self', 140)], () => visible)
  assert.deepStrictEqual(sent.map(item => item.createTime), [80, 110])

  // A failed send remains retryable, and overlapping sends cannot move the boundary backwards.
  let fail = true
  nim.V2NIMMessageService.sendP2PMessageReceipt = async item => {
    if (fail) { fail = false; throw new Error('offline') }
    sent.push(item)
  }
  await assert.rejects(context.sendNimP2PReadReceipt('c', [message('other', 150)]), /offline/)
  await context.sendNimP2PReadReceipt('c', [message('other', 150)])
  let release
  let started
  const sending = new Promise(resolve => { started = resolve })
  nim.V2NIMMessageService.sendP2PMessageReceipt = item => new Promise(resolve => {
    if (item.createTime === 160) { release = () => { sent.push(item); resolve() }; started() }
    else { sent.push(item); resolve() }
  })
  const first = context.sendNimP2PReadReceipt('c', [message('other', 160)])
  await sending
  const second = context.sendNimP2PReadReceipt('c', [message('other', 170)])
  release()
  await Promise.all([first, second])
  assert.deepStrictEqual(sent.map(item => item.createTime), [80, 110, 150, 160, 170])
  console.log('p2p read receipt tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
