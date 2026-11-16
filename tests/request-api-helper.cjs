// 在内存中运行真实请求封装，让页面测试共用 Limits 的记录和前置检查。
const fs = require('fs')
const path = require('path')
const vm = require('vm')

module.exports = function requestApiEnvironment(request, { enterprise = false } = {}) {
  const context = vm.createContext({
    process: { env: { NODE_ENV: 'test' } },
    document: { cookie: '' },
    window: { location: { pathname: enterprise ? '/ehr/pc/chat' : '/person/m/chat' } },
    uni: { request: options => {
      const args = { Name: options.data.Name, Content: options.data.Content ? JSON.parse(options.data.Content) : '' }
      try {
        Promise.resolve(request(args)).then(data => {
          options.success({ statusCode: 200, data })
        }, options.fail)
      } catch (error) { options.fail(error) }
    } }
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../services/request.js'), 'utf8')
    .replace(/^export /gm, ''), context)
  return { requestApi: context.requestApi, ensureChatLimitsBeforeChangeJob: context.ensureChatLimitsBeforeChangeJob, context }
}
