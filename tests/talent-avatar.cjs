const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const context = vm.createContext({ PcChatPanel: {}, PcChatHistoryPanel: {} })
const source = fs.readFileSync(path.join(root, 'services/talent-avatar.js'), 'utf8').replace(/^export /gm, '')
vm.runInContext(source, context)

const getTalentAvatar = context.getTalentAvatar
assert.equal(getTalentAvatar(), '/static/preson_avatar.png')
assert.equal(getTalentAvatar(0), '/static/preson_avatar.png')
assert.equal(getTalentAvatar(1), '/static/man_avatar.png')
assert.equal(getTalentAvatar('男'), '/static/man_avatar.png')
assert.equal(getTalentAvatar('female'), '/static/woman_avatar.png')
assert.equal(getTalentAvatar({ Gender: 2 }), '/static/woman_avatar.png')

const pageSource = fs.readFileSync(path.join(root, 'pages/ehr/pc/chat.vue'), 'utf8')
const pageScript = pageSource.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')
context.module = { exports: {} }
vm.runInContext(pageScript, context)
const getConversationAvatar = context.module.exports.methods.getConversationAvatar
const list = { failedAvatarMap: {} }
assert.equal(getConversationAvatar.call(list, { id: 'missing', avatar: '/static/default_avatar.png' }), '/static/preson_avatar.png')
assert.equal(getConversationAvatar.call(list, { id: 'male', avatar: '/static/default_avatar.png', gender: 1 }), '/static/man_avatar.png')
assert.equal(getConversationAvatar.call(list, { id: 'female', avatar: '/broken.png', gender: 'female' }), '/broken.png')
list.failedAvatarMap.female = '/broken.png'
assert.equal(getConversationAvatar.call(list, { id: 'female', avatar: '/broken.png', gender: 'female' }), '/static/woman_avatar.png')
console.log('talent avatar fallback tests passed')
