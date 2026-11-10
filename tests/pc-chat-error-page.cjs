// node tests/pc-chat-error-page.cjs：错误页展示 Tips 与企业导航。
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pages/ehr/pc/error.vue'), 'utf8')
const pages = fs.readFileSync(path.join(root, 'pages.json'), 'utf8')
const context = { module: { exports: {} }, console, uni: {} }
vm.runInNewContext(source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '')
  .replace('export default', 'module.exports ='), context)
const page = context.module.exports
const instance = page.data()
const tips = '职位已关闭 & 请重新选择？100%'
page.onLoad.call(instance, { tips })
assert.equal(instance.tips, tips)
assert.ok(source.includes('{{ tips || \'操作失败\' }}'))
assert.ok(!source.includes('v-html'))
assert.ok(source.includes('class="site-header"'))
assert.ok(source.includes('class="site-nav"'))
assert.ok(!source.includes('site-nav-link--active'))
assert.match(source, /\.error-page\s*\{[^}]*min-height:\s*100vh;[^}]*background:\s*#fff;/)
assert.ok(source.includes('/static/pc/commomerror.jpg'))
assert.ok(fs.statSync(path.join(root, 'static/pc/commomerror.jpg')).size > 0)
assert.match(pages, /"path"\s*:\s*"pages\/ehr\/pc\/error"/)
console.log('pc chat error page tests passed')
