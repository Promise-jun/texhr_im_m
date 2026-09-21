let defaultApiUrl = '/gateway/'

// H5 本地开发时改用 webpack-dev-server 反向代理，避免浏览器跨域限制。
// #ifdef H5
if (process.env.NODE_ENV === 'development') {
	defaultApiUrl = '/api/gateway/'
}
// #endif

export const API_URL = defaultApiUrl
export const DEFAULT_API_VERSION = 'V1.0.0'

export const AUTH_COOKIE_KEYS = Object.freeze({
	PERSONAL: 'persontokeninfotexhr'
})

const REQUEST_TIMEOUT = 15000

const SPECIAL_CODE_MESSAGES = Object.freeze({
	'9000002': '登录失效',
	'4100001': '账户不存在',
	'9000004': '您的账户已在其他设备登录，如非本人操作，请联系400-672-6626'
})

const requestConfig = {
	apiUrl: API_URL
}

function createRequestError(message, response) {
	const error = new Error(message)
	if (response) {
		error.statusCode = response.statusCode
		error.data = response.data
	}
	return error
}

function uniRequest(options) {
	return new Promise((resolve, reject) => {
		uni.request({
			...options,
			timeout: options.timeout || REQUEST_TIMEOUT,
			success: resolve,
			fail: reject
		})
	})
}

function showSpecialCodeMessage(responseData) {
	if (!responseData || responseData.Code === undefined || responseData.Code === null) return

	const message = SPECIAL_CODE_MESSAGES[String(responseData.Code)]
	if (!message || typeof uni === 'undefined' || typeof uni.showModal !== 'function') return

	uni.showModal({
		title: '提示',
		content: message,
		showCancel: false
	})
}

function getRawCookie(name) {
	let cookieString = ''

	// #ifdef H5
	if (typeof document !== 'undefined') cookieString = document.cookie || ''
	// #endif

	if (!cookieString) return ''

	const cookie = cookieString
		.split(';')
		.map(item => item.trim())
		.find(item => item.startsWith(`${name}=`))

	if (!cookie) return ''

	return cookie.slice(name.length + 1)
}

function decodeCookieComponent(value) {
	try {
		return decodeURIComponent(value)
	} catch (error) {
		return value
	}
}

export function getCookie(name) {
	const value = getRawCookie(name)
	if (!value) return ''

	return decodeCookieComponent(value)
}

export function setEncodedCookie(name, encodedValue) {
	// #ifdef H5
	if (typeof document !== 'undefined') {
		document.cookie = `${name}=${encodedValue}; path=/; SameSite=Lax`
	}
	// #endif
}

function normalizeAuth(personal) {
	if (!personal || typeof personal !== 'object') return null

	const hasPersonId = Object.prototype.hasOwnProperty.call(personal, 'personId')
		|| Object.prototype.hasOwnProperty.call(personal, 'PersonId')
	const hasToken = Object.prototype.hasOwnProperty.call(personal, 'token')
		|| Object.prototype.hasOwnProperty.call(personal, 'Token')
	if (!hasPersonId && !hasToken) return null

	const personId = hasPersonId
		? (personal.personId !== undefined ? personal.personId : personal.PersonId)
		: ''
	const token = hasToken
		? (personal.token !== undefined ? personal.token : personal.Token)
		: ''

	return {
		PersonId: personId === undefined || personId === null ? '' : String(personId),
		Token: typeof token === 'string' ? token : ''
	}
}

function parseQueryAuth(value) {
	const fields = {}

	value.split('&').forEach(item => {
		const separatorIndex = item.indexOf('=')
		if (separatorIndex < 0) return

		const key = decodeCookieComponent(item.slice(0, separatorIndex)).trim()
		if (key !== 'personId' && key !== 'PersonId' && key !== 'token' && key !== 'Token') return

		fields[key] = decodeCookieComponent(item.slice(separatorIndex + 1))
	})

	return normalizeAuth(fields)
}

function parseAuthCookie(rawCookie) {
	const decodedCookie = decodeCookieComponent(rawCookie)
	const candidates = decodedCookie === rawCookie
		? [rawCookie]
		: [rawCookie, decodedCookie]

	for (const candidate of candidates) {
		try {
			const auth = normalizeAuth(JSON.parse(candidate))
			if (auth) return auth
		} catch (error) {
			// 新版 Cookie 是查询串格式，JSON 解析失败后继续按键值对解析。
		}

		const auth = parseQueryAuth(candidate)
		if (auth) return auth
	}

	return null
}

function getAuthFromCookie() {
	return { PersonId: 210902, Token: 'N7Ysxh4nQy4u8LCeOVcJ' }
	
	const personalCookie = getRawCookie(AUTH_COOKIE_KEYS.PERSONAL)
	if (!personalCookie) return { PersonId: '', Token: '' }

	return parseAuthCookie(personalCookie) || { PersonId: '', Token: '' }
}

function serializeContent(Content) {
	if (typeof Content === 'string') return Content
	if (Content === undefined || Content === null) return ''

	try {
		return JSON.stringify(Content)
	} catch (error) {
		throw new Error(`Content 序列化失败：${error.message}`)
	}
}

/**
 * 根据 texhr OpenAPI 文档创建完整请求体。
 * 文档要求空值字段也不能省略，因此暂不使用的字段统一传空字符串。
 */
export function createRequestPayload({ Name, Content = '', Version = DEFAULT_API_VERSION, Ip = '' }) {
	if (typeof Name !== 'string' || !Name.trim()) {
		throw new Error('Name 不能为空')
	}
	if (typeof Version !== 'string' || !Version.trim()) {
		throw new Error('Version 不能为空')
	}

	const auth = getAuthFromCookie()

	return {
		Name: Name.trim(),
		Version: Version.trim(),
		EnterpriseId: '',
		PersonId: auth.PersonId,
		Token: auth.Token,
		Platform: 1,
		Appid: 'M',
		IdCode: '',
		Ip,
		EnterpriseType: 1,
		Content: serializeContent(Content)
	}
}

/**
 * 统一调用 texhr OpenAPI。
 *
 * @example
 * requestApi({
 *   Name: 'Person.Account.GetPersonalInformation',
 *   Content: {}
 * })
 */
export async function requestApi({ Name, Content = '', Version = DEFAULT_API_VERSION }) {
	// 当前业务不需要客户端 IP，按照接口结构要求保留字段并传空字符串。
	const data = createRequestPayload({ Name, Content, Version, Ip: '' })
	const response = await uniRequest({
		url: requestConfig.apiUrl,
		method: 'POST',
		header: {
			'Content-Type': 'application/x-www-form-urlencoded' // application/json  
		},
		data
	})

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw createRequestError(`接口请求失败（HTTP ${response.statusCode}）`, response)
	}

	showSpecialCodeMessage(response.data)

	return response.data
}
