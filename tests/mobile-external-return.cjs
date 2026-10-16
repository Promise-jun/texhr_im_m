const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'services/navigation.js'), 'utf8')
  .replace(/^export /gm, '')

const browser = {
  href: 'https://app.example.com/pages/person/m/list',
  origin: 'https://app.example.com',
  referrer: 'https://external.example.com/from'
}
const navigation = { back: 0, relaunch: '' }
const context = vm.createContext({
  URL,
  window: { location: browser },
  document: { referrer: browser.referrer },
  getCurrentPages: () => [{}, {}],
  uni: {
    navigateBack: () => { navigation.back += 1 },
    reLaunch: options => { navigation.relaunch = options.url }
  }
})
vm.runInContext(source, context)

assert.equal(context.getExternalReturnUrl({ returnUrl: 'https://outside.example.com/detail?a=1' }),
  'https://outside.example.com/detail?a=1')
assert.equal(context.getExternalReturnUrl({ returnUrl: encodeURIComponent('https://outside.example.com/detail?a=1') }),
  'https://outside.example.com/detail?a=1')
assert.equal(context.getExternalReturnUrl({}), 'https://external.example.com/from')
assert.equal(context.getExternalReturnUrl({ returnUrl: 'https://app.example.com/pages/person/m/list' }), '')
assert.equal(context.appendExternalReturnUrl('/pages/person/m/detail?Accid=enterprise', 'https://outside.example.com/from'),
  '/pages/person/m/detail?Accid=enterprise&returnUrl=https%3A%2F%2Foutside.example.com%2Ffrom')

browser.href = ''
assert.equal(context.navigateBackWithExternal('https://outside.example.com/from'), true)
assert.equal(browser.href, 'https://outside.example.com/from')
assert.equal(navigation.back, 0)

assert.equal(context.navigateBackWithExternal('', '/pages/person/m/list'), true)
assert.equal(navigation.back, 1)
context.getCurrentPages = () => []
assert.equal(context.navigateBackWithExternal('', '/pages/person/m/list'), true)
assert.equal(navigation.relaunch, '/pages/person/m/list')
console.log('mobile external return navigation tests passed')
