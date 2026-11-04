const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
let browserBackCount = 0

for (const relativePath of [
  'pages/person/m/chat.vue',
  'pages/person/m/detail.vue',
  'pages/person/m/list.vue'
]) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
    .replace('export default', 'module.exports =')
  const context = vm.createContext({
    module: { exports: {} },
    UniPopup: {},
    window: { history: { back: () => { browserBackCount += 1 } } }
  })
  vm.runInContext(script, context)
  context.module.exports.methods.navigateBack.call({})
  assert.equal(browserBackCount, 1, `${relativePath} should use browser history.back()`)
  browserBackCount = 0
}

console.log('mobile browser back tests passed')
