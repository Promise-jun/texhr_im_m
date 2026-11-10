// node tests/pc-chat-limits-error.cjs
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { createRequire } = require('module')

const harnessPath = path.join(__dirname, 'pc-chat-phrases.cjs')
const harness = fs.readFileSync(harnessPath, 'utf8')
const context = { require: createRequire(harnessPath), __dirname, module: { exports: {} }, console }
vm.runInNewContext(harness.slice(0, harness.indexOf('async function verify()')) +
  '\nmodule.exports = { environment, greetingEnvironment, source }', context)
const { environment, greetingEnvironment, source } = context.module.exports

async function verify() {
  assert.ok(source.includes('v-show="!limitsErrorMessage" class="job-context"'))
  assert.ok(source.includes('class="action-link resume-link"'))
  assert.ok(source.includes('<view class="composer">'))
  assert.ok(!source.includes('v-show="!limitsErrorMessage" class="action-link resume-link"'))
  assert.ok(!source.includes('v-show="!limitsErrorMessage" class="composer"'))
  assert.match(source, /class="chat-title"/)
  assert.match(source, /accessError \|\| historyError/)

  const env = greetingEnvironment({ Code: 1, ErrorMessage: '该职位不存在或已删除，暂不能发送消息。' })
  env.panel.accessReady = false
  await env.panel.loadChatAccess()
  assert.equal(env.modals.length, 1)
  assert.equal(env.modals[0].content, '该职位不存在或已删除，暂不能发送消息。')
  assert.equal(env.panel.limitsErrorMessage, env.modals[0].content)
  assert.equal(env.panel.accessError, env.modals[0].content)
  assert.equal(env.panel.accessReady, false)
  assert.equal(env.state.prepares, 0)

  let resolveRetry
  env.request(() => new Promise(resolve => { resolveRetry = resolve }))
  const retry = env.panel.loadChatAccess()
  assert.ok(env.panel.limitsErrorMessage)
  resolveRetry({ Code: 0, Data: {} })
  await retry
  assert.equal(env.panel.limitsErrorMessage, '')
  assert.equal(env.panel.accessError, '')
  assert.equal(env.panel.accessReady, true)
  assert.equal(env.state.prepares, 1)

  const otherError = greetingEnvironment({ Code: 1 })
  otherError.panel.accessReady = false
  await otherError.panel.loadChatAccess()
  assert.equal(otherError.panel.limitsErrorMessage, '')
  assert.equal(otherError.panel.accessError, '获取沟通状态失败')
  assert.equal(otherError.modals.length, 0)

  const success = environment()
  success.request(async () => ({ Code: 0, ErrorMessage: '忽略', Data: {} }))
  await success.panel.loadChatAccess()
  assert.equal(success.panel.limitsErrorMessage, '')
  assert.equal(success.modals.length, 0)
  console.log('pc chat Limits error visibility tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
