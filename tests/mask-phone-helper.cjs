const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = fs.readFileSync(path.join(__dirname, '../services/mask-phone.js'), 'utf8')
module.exports = vm.runInNewContext(source.replace('export function', 'function') + '\nmaskPhoneNumbers')
