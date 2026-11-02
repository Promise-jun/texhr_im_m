// node tests/pc-chat-company-name.cjs：使用模拟网关验证企业名称加载。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../pages/ehr/pc/chat.vue'), 'utf8')
const calls = []
let request = async () => ({ Code: 0, Data: { CompanyName: '测试企业' } })
const context = vm.createContext({
  module: { exports: {} }, PcChatPanel: {}, PcChatHistoryPanel: {},
  console: { error() {} },
  createRequestPayload: ({ Name }) => {
    assert.equal(Name, 'Enterprise.BasicInformation.GetById')
    return { EnterpriseId: 42, Token: 'test-token', EnterpriseType: 1 }
  },
  requestApi: args => { calls.push(args); return request(args) }
})
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports =')
vm.runInContext(script, context)
const definition = context.module.exports
const page = { ...definition.data(), _conversationPageAlive: true, _companyNameRequestId: 0, pageVisible: true }
for (const [name, method] of Object.entries(definition.methods)) page[name] = method.bind(page)

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function verify() {
  assert.match(source, /:title="companyName \|\| '企业账号'"/)
  assert.match(source, /\{\{ companyName \|\| '企业账号' \}\}/)
  await page.loadCompanyName()
  assert.equal(page.companyName, '测试企业')
  assert.equal(JSON.stringify(calls[0]), JSON.stringify({
    Name: 'Enterprise.BasicInformation.GetById', Version: 'V1.1.0',
    Content: { EnterpriseId: '42', AccountToken: 'test-token', EnterpriseType: '1' }
  }))

  request = async () => ({ Code: '0', Data: JSON.stringify({ Code: 0, CompanyName: ' 新企业 ' }) })
  await page.loadCompanyName()
  assert.equal(page.companyName, '新企业')

  for (const response of [
    { Code: 1, Data: { CompanyName: '错误数据' } },
    { Code: 0, Data: { Code: 1, CompanyName: '错误数据' } },
    { Code: 0, Data: '{invalid' }, { Code: 0, Data: null },
    { Code: 0, Data: { CompanyName: 123 } }
  ]) {
    request = async () => response
    await page.loadCompanyName()
    assert.equal(page.companyName, '')
  }
  request = async () => { throw new Error('network') }
  await page.loadCompanyName()
  assert.equal(page.companyName, '')

  const old = deferred(), current = deferred()
  request = () => old.promise
  const oldLoad = page.loadCompanyName()
  request = () => current.promise
  const currentLoad = page.loadCompanyName()
  current.resolve({ Code: 0, Data: { CompanyName: '当前企业' } })
  await currentLoad
  old.resolve({ Code: 0, Data: { CompanyName: '旧企业' } })
  await oldLoad
  assert.equal(page.companyName, '当前企业')

  const hidden = deferred()
  request = () => hidden.promise
  const hiddenLoad = page.loadCompanyName()
  page.pageVisible = false
  hidden.resolve({ Code: 0, Data: { CompanyName: '已隐藏' } })
  await hiddenLoad
  assert.equal(page.companyName, '')

  console.log('PASS: enterprise identity parameters, company name parsing, failures and stale responses')
}

verify().catch(error => { console.error(error); process.exitCode = 1 })
