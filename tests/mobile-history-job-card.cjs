const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const detailSource = read('pages/person/m/detail.vue')
const detailScript = detailSource.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')
const urls = []
const toasts = []
let response = { Code: 0, Data: { JobId: 'job', ResumeId: 'resume', CodeNum: 'company &1' } }
const globals = {
  module: { exports: {} }, UniPopup: {},
  requestApi: async () => response,
  window: { location: { replace: url => urls.push(url) } },
  uni: { showToast: options => toasts.push(options) }
}
const service = vm.createContext({ ...globals })
vm.runInContext(read('services/chat-history.js').replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), service)
const pageContext = vm.createContext(globals)
vm.runInContext(detailScript, pageContext)
const page = pageContext.module.exports.data()
for (const [name, method] of Object.entries(pageContext.module.exports.methods)) page[name] = method.bind(page)

async function verify() {
  assert.match(detailSource, /@click\.stop="handleJobCardClick\(message\)"/)
  page.chatDetail = await service.getHistoryChatDetail('person', 'enterprise')
  page.handleJobCardClick({ type: 'job-card', job: { JobId: 'job /2', status: true } })
  assert.deepStrictEqual(urls, ['https://m.texhr.cn/zpcompany%20%261/job%20%2F2/'])

  for (const status of [false, 0, undefined, null, '']) {
    page.handleJobCardClick({ type: 'job-card', job: { JobId: 'inactive', status } })
  }
  page.handleJobCardClick({ type: 'text', job: { JobId: 'other', status: true } })
  assert.equal(urls.length, 1)

  page.handleJobCardClick({ type: 'job-card', job: { status: true } })
  assert.equal(toasts.pop().title, '未获取到职位编号')
  page.chatDetail = {}
  page.handleJobCardClick({ type: 'job-card', job: { JobId: 'job', status: true } })
  assert.equal(toasts.pop().title, '未获取到公司编号')

  response = { Code: 0, Data: JSON.stringify({ JobId: 'job', ResumeId: 'resume' }), CodeNum: 'root-code' }
  page.chatDetail = await service.getHistoryChatDetail('person', 'enterprise')
  page.handleJobCardClick({ type: 'job-card', job: { JobId: 'job', status: true } })
  assert.equal(urls[1], 'https://m.texhr.cn/zproot-code/job/')

  response = { Code: 0, Data: { JobId: 'job', ResumeId: 'resume', CodeNum: 'data-code' }, CodeNum: 'root-code' }
  assert.equal((await service.getHistoryChatDetail('person', 'enterprise')).CodeNum, 'data-code')
  console.log('mobile history job card navigation tests passed')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
