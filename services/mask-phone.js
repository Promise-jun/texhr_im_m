export function maskPhoneNumbers(text) {
	return text.replace(/(^|[^\d])((?:\+?86[ -]?)?)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g,
		(match, prefix, countryCode, start, end) => `${prefix}${countryCode}${start}****${end}`)
}
