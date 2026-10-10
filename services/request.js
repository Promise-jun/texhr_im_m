let defaultApiUrl = '/api/gateway/'

// H5 本地开发时改用 webpack-dev-server 反向代理，避免浏览器跨域限制。
// #ifdef H5
if (process.env.NODE_ENV === 'development') {
	defaultApiUrl = '/api/gateway/'
}
// #endif

export const API_URL = defaultApiUrl
export const DEFAULT_API_VERSION = 'V1.0.0'

export const AUTH_COOKIE_KEYS = Object.freeze({
	PERSONAL: 'persontokeninfotexhr',
	ENTERPRISE: 'enterprisetokeninfotexhr'
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

function normalizeAuth(auth, idField) {
	if (!auth || typeof auth !== 'object') return null

	const cookieIdField = idField.charAt(0).toLowerCase() + idField.slice(1)
	const hasId = Object.prototype.hasOwnProperty.call(auth, cookieIdField) ||
		Object.prototype.hasOwnProperty.call(auth, idField)
	const hasToken = Object.prototype.hasOwnProperty.call(auth, 'token') ||
		Object.prototype.hasOwnProperty.call(auth, 'Token')
	if (!hasId && !hasToken) return null

	const id = hasId ?
		(auth[cookieIdField] !== undefined ? auth[cookieIdField] : auth[idField]) :
		''
	const token = hasToken ?
		(auth.token !== undefined ? auth.token : auth.Token) :
		''

	return {
		[idField]: id === undefined || id === null ? '' : String(id),
		Token: typeof token === 'string' ? token : ''
	}
}

function parseQueryAuth(value, idField) {
	const fields = {}
	const cookieIdField = idField.charAt(0).toLowerCase() + idField.slice(1)

	value.split('&').forEach(item => {
		const separatorIndex = item.indexOf('=')
		if (separatorIndex < 0) return

		const key = decodeCookieComponent(item.slice(0, separatorIndex)).trim()
		if (key !== cookieIdField && key !== idField && key !== 'token' && key !== 'Token') return

		fields[key] = decodeCookieComponent(item.slice(separatorIndex + 1))
	})

	return normalizeAuth(fields, idField)
}

function parseAuthCookie(rawCookie, idField) {
	const decodedCookie = decodeCookieComponent(rawCookie)
	const candidates = decodedCookie === rawCookie ? [rawCookie] : [rawCookie, decodedCookie]

	for (const candidate of candidates) {
		try {
			const auth = normalizeAuth(JSON.parse(candidate), idField)
			if (auth) return auth
		} catch (error) {
			// 新版 Cookie 是查询串格式，JSON 解析失败后继续按键值对解析。
		}

		const auth = parseQueryAuth(candidate, idField)
		if (auth) return auth
	}

	return null
}

function isEnterprisePage() {
	// #ifdef H5
	if (typeof window !== 'undefined' && window.location) {
		return String(window.location.href || '').toLowerCase().includes('ehr')
	}
	// #endif

	return false
}

function getAuthFromCookie(isEnterprise) {
	// // 获取当前页面url
	// const url = window.location.href;
	// // 判断是否包含 ehr（区分大小写，EHR 匹配不到）
	// if (url.includes('ehr')) {
	// 	return {
	// 		EnterpriseId: 19441,
	// 		Token: 't5ysQM_u43dOPnAfrdED'
	// 	}
	// } else {
	// 	return {
	// 		PersonId: 210902,
	// 		Token: 'p8ZfVeGfxp5QsfsNk1eZ'
	// 	}
	// }

	const idField = isEnterprise ? 'EnterpriseId' : 'PersonId'
	const cookieKey = isEnterprise ? AUTH_COOKIE_KEYS.ENTERPRISE : AUTH_COOKIE_KEYS.PERSONAL
	const authCookie = getRawCookie(cookieKey)
	const emptyAuth = {
		[idField]: '',
		Token: ''
	}
	if (!authCookie) return emptyAuth

	return parseAuthCookie(authCookie, idField) || emptyAuth
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
export function createRequestPayload({
	Name,
	Content = '',
	Version = DEFAULT_API_VERSION,
	Ip = ''
}) {
	if (typeof Name !== 'string' || !Name.trim()) {
		throw new Error('Name 不能为空')
	}
	if (typeof Version !== 'string' || !Version.trim()) {
		throw new Error('Version 不能为空')
	}

	const isEnterprise = isEnterprisePage()
	const auth = getAuthFromCookie(isEnterprise)

	return {
		Name: Name.trim(),
		Version: Version.trim(),
		EnterpriseId: isEnterprise ? auth.EnterpriseId : '',
		PersonId: isEnterprise ? '' : auth.PersonId,
		Token: auth.Token,
		Platform: isEnterprise ? 2 : 1,
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
export async function requestApi({
	Name,
	Content = '',
	Version = DEFAULT_API_VERSION
}) {
	// 当前业务不需要客户端 IP，按照接口结构要求保留字段并传空字符串。
	const data = createRequestPayload({
		Name,
		Content,
		Version,
		Ip: ''
	})
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