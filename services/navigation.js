const INTERNAL_PAGE_PATH_PREFIX = '/pages/'

function decodeExternalOption(value) {
	const raw = String(value || '').trim()
	if (!raw) return ''
	if (/^https?:\/\//i.test(raw)) return raw
	try {
		return decodeURIComponent(raw).trim()
	} catch (error) {
		return raw
	}
}

function normalizeExternalUrl(value) {
	const raw = decodeExternalOption(value)
	if (!raw || !/^https?:\/\//i.test(raw)) return ''

	try {
		const currentLocation = typeof window !== 'undefined' && window.location ? window.location : null
		const UrlConstructor = typeof URL === 'function' ? URL :
			(typeof window !== 'undefined' && typeof window.URL === 'function' ? window.URL : null)
		if (!UrlConstructor) return raw
		const parsed = new UrlConstructor(raw, currentLocation && currentLocation.href ? currentLocation.href : undefined)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
		const currentOrigin = currentLocation && currentLocation.href ?
			new UrlConstructor(currentLocation.href).origin : currentLocation && currentLocation.origin
		if (currentOrigin && parsed.origin === currentOrigin &&
			parsed.pathname.indexOf(INTERNAL_PAGE_PATH_PREFIX) === 0) return ''
		return parsed.toString()
	} catch (error) {
		return /^https?:\/\//i.test(raw) ? raw : ''
	}
}

export function getExternalReturnUrl(options = {}) {
	const explicitUrl = options.returnUrl || options.ReturnUrl || options.fromUrl || options.FromUrl ||
		options.externalUrl || options.ExternalUrl
	if (explicitUrl) return normalizeExternalUrl(explicitUrl)

	if (typeof document === 'undefined' || !document.referrer) return ''
	return normalizeExternalUrl(document.referrer)
}

export function appendExternalReturnUrl(url, externalReturnUrl) {
	const normalizedUrl = String(url || '')
	const returnUrl = normalizeExternalUrl(externalReturnUrl)
	if (!normalizedUrl || !returnUrl) return normalizedUrl
	return `${normalizedUrl}${normalizedUrl.includes('?') ? '&' : '?'}returnUrl=${encodeURIComponent(returnUrl)}`
}

export function openExternalUrl(url) {
	const normalizedUrl = normalizeExternalUrl(url)
	if (!normalizedUrl) return false

	// #ifdef H5
	if (typeof window !== 'undefined' && window.location) {
		window.location.href = normalizedUrl
		return true
	}
	// #endif
	// #ifdef APP-PLUS
	if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.openURL === 'function') {
		plus.runtime.openURL(normalizedUrl)
		return true
	}
	// #endif
	return false
}

export function navigateBackWithExternal(externalReturnUrl, fallbackUrl = '') {
	if (openExternalUrl(externalReturnUrl)) return true

	const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
	if (pages.length > 1) {
		uni.navigateBack()
		return true
	}
	if (fallbackUrl) {
		uni.reLaunch({ url: fallbackUrl })
		return true
	}
	return false
}
