// node tests/pc-chat-error-page.cjs：错误页展示 Tips 与企业导航。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pages/ehr/pc/error.vue'), 'utf8')
const pages = fs.readFileSync(path.join(root, 'pages.json'), 'utf8')
const calls = []
const modals = []
const toasts = []
let closes = 0
let request = async () => ({ Code: 0, Data: {} })
const windowMock = { location: { href: '' }, close: () => { closes++ } }
const context = { module: { exports: {} }, console, window: windowMock,
  requestApi: args => { calls.push(args); return request(args) },
  uni: { showModal: value => modals.push(value), showToast: value => toasts.push(value) } }
vm.runInNewContext(source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports ='), context)
const page = context.module.exports
function instance(options) {
  const value = page.data()
  Object.entries(page.methods).forEach(([name, method]) => { value[name] = method.bind(value) })
  page.onLoad.call(value, options)
  return value
}
const tips = '职位已关闭 & 请重新选择？100%'
const stepName = '立即升级'
const display = instance({ tips, stepName })
assert.equal(display.tips, tips)
assert.equal(display.stepName, stepName)
assert.ok(source.includes('{{ tips || \'操作失败\' }}'))
assert.ok(source.includes("v-if=\"stepName\""))
assert.ok(source.includes("{{ isSubmitting ? '提交中...' : stepName }}"))
assert.ok(!source.includes('v-html'))
assert.ok(source.includes('class="site-header"'))
assert.ok(source.includes('class="site-nav"'))
assert.ok(!source.includes('site-nav-link--active'))
assert.match(source, /\.error-page\s*\{[^}]*min-height:\s*100vh;[^}]*background:\s*#fff;/)
assert.ok(source.includes('/static/pc/commomerror.jpg'))
assert.ok(fs.statSync(path.join(root, 'static/pc/commomerror.jpg')).size > 0)
assert.match(pages, /"path"\s*:\s*"pages\/ehr\/pc\/error"/)

async function verifyActions() {
  const upload = instance({ stepName: '立即上传' })
  upload.handleStepAction()
  assert.equal(windowMock.location.href, 'https://www.texhr.cn/ehr/qualification/')
  assert.equal(calls.length, 0)

  windowMock.location.href = ''
  const known = instance({ stepName: '知道了' })
  known.handleStepAction()
  assert.equal(windowMock.location.href, '')
  assert.equal(calls.length, 0)

  request = async () => ({ Code: 0, Data: { Code: 0 } })
  const upgrade = instance({ stepName: '申请开通' })
  await upgrade.handleStepAction()
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0])), {
    Name: 'Enterprise.Service.UpGrade', Content: { Type: 9 }
  })
  assert.equal(modals.length, 1)
  assert.equal(modals[0].content, '已成功接收您的需求,工作人员会在1个工作日内与您联系.')
  assert.equal(upgrade.isSubmitting, false)
  modals[0].success({ confirm: true })
  assert.equal(closes, 1)
  console.log('pc chat error page tests passed')
}

verifyActions().catch(error => { console.error(error); process.exitCode = 1 })
