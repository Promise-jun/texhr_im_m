const assert = require('assert')
const maskPhoneNumbers = require('./mask-phone-helper.cjs')

assert.equal(maskPhoneNumbers('13812345678,13987654321'), '138****5678,139****4321')
assert.equal(maskPhoneNumbers('+8613812345678 / 86-13987654321'), '+86138****5678 / 86-139****4321')
assert.equal(maskPhoneNumbers('0123456789012 138123456789 12345678901'), '0123456789012 138123456789 12345678901')
assert.equal(maskPhoneNumbers('138****5678'), '138****5678')
console.log('PASS: mainland mobile numbers are masked without changing surrounding text or longer numbers')
