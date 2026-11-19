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
const CHAT_LIMITS_API = 'Chat.MyChat.Limits'
// 只在当前运行期间记录；普通 Limits 请求始终访问接口，切换职位前才复用记录。
const chatLimitsRequests = new Map()

const SPECIAL_CODE_MESSAGES = Object.freeze({
	'9000002': '登录失效',
	'4000020': '数据逻辑错误',
	'4100001': '账户不存在',
	'9000004': '您的账户已在其他设备登录，如非本人操作，请联系400-672-6607'
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

function redirectToLoginForSpecialCode(responseData) {
	if (!responseData || responseData.Code === undefined || responseData.Code === null) return

	if (!SPECIAL_CODE_MESSAGES[String(responseData.Code)]) return

	// #ifdef H5
	// 登录态已失效，跳转完成前隐藏页面及可能由后续回调弹出的提示。
	if (typeof document !== 'undefined' && document.body) {
		document.body.style.display = 'none'
	}
	if (typeof window !== 'undefined' && window.location) {
		const loginUrl = isEnterprisePage() ?
			'http://www.texhr.cn/ehr/login.html' :
			'http://www.texhr.cn/person/login.html'
		const returnUrl = encodeURIComponent(window.location.href)
		window.location.replace(`${loginUrl}?return_url=${returnUrl}`)
	}
	// #endif
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
		return String(window.location.pathname || '').toLowerCase().includes('ehr')
	}
	// #endif

	return false
}

function getAuthFromCookie(isEnterprise) {
	// // 获取当前页面url
	const url = window.location.pathname;
	// 判断是否包含 ehr（区分大小写，EHR 匹配不到）
	if (url.includes('ehr')) {
		return {
			EnterpriseId: 198267,
			Token: 'GBWeSdyeq9Uw7Yl98H8c',
			// EnterpriseId: 19441,
			// Token: 'eEMtSa06xYFoOBHsZyq2',
		}
	} else {
		return {
			PersonId: 272490,
			Token: 'C4jZuy5Rvwo5TSWaaiI0',
			// PersonId: 210902,
			// Token: 'oTG1n2RixCcqdduU1Rgm',
		}
	}

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

function chatLimitsKey(payload) {
	const content = JSON.parse(payload.Content)
	const jobId = String(content.JobId === undefined || content.JobId === null ? '' : content.JobId).trim()
	const resumeId = String(content.ResumeId === undefined || content.ResumeId === null ? '' : content.ResumeId).trim()
	if (!jobId || (payload.Platform === 2 && !resumeId)) return ''
	// 个人身份已确定自己的简历；企业端必须按简历隔离，不能复用其他人才的记录。
	return JSON.stringify([requestConfig.apiUrl, payload.Platform, payload.PersonId, payload.EnterpriseId,
		payload.Token, payload.Version, jobId, payload.Platform === 2 ? resumeId : ''])
}

function chatLimitsData(response) {
	if (!response || response.Code === undefined || Number(response.Code) !== 0) {
		const code = response && response.Code !== undefined ? response.Code : 'unknown'
		throw new Error(response && response.ErrorMessage || `获取沟通状态失败，业务错误码：${code}`)
	}
	let data = response.Data
	if (data === undefined || data === null || data === '') data = {}
	else if (typeof data === 'string') {
		try { data = JSON.parse(data) } catch (error) {
			throw new Error('沟通限制接口返回的数据格式不正确')
		}
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('沟通限制接口返回的数据格式不正确')
	}
	if (data.Code !== undefined && Number(data.Code) !== 0) {
		throw new Error(`获取沟通状态失败，数据错误码：${data.Code}`)
	}
	return data
}

/** 切换职位前补齐 Limits；共用进行中的请求，失败和 SuccessStep 不保留成功记录。 */
export async function ensureChatLimitsBeforeChangeJob(jobId, resumeId) {
	const job = String(jobId === undefined || jobId === null ? '' : jobId).trim()
	const resume = String(resumeId === undefined || resumeId === null ? '' : resumeId).trim()
	if (!job) throw new Error('缺少沟通职位信息')
	const content = { JobId: job, ...(resume ? { ResumeId: resume } : {}) }
	const payload = createRequestPayload({ Name: CHAT_LIMITS_API, Content: content })
	if (payload.Platform === 2 && !resume) throw new Error('缺少沟通简历信息')
	const previous = chatLimitsRequests.get(chatLimitsKey(payload))
	const response = await (previous ? previous.promise : requestApi({ Name: CHAT_LIMITS_API, Content: content }))
	const data = chatLimitsData(response)
	const successStep = data.SuccessStep || response.SuccessStep
	if (successStep) {
		const error = new Error(successStep.Tips || '请先完成沟通权限操作')
		// 页面沿用各端已有的 SuccessStep 操作，不能继续执行 ChangeJob。
		error.chatLimitsSuccessStep = successStep
		error.chatLimitsResponse = response
		error.chatLimitsJobId = job
		throw error
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
	if (data.Name !== CHAT_LIMITS_API) return sendApiRequest(data)
	let key = ''
	try { key = chatLimitsKey(data) } catch (error) { /* 无效参数仍由接口按原流程返回。 */ }
	const record = {}
	record.promise = sendApiRequest(data).then(response => {
		let canReuse = false
		try {
			const limits = chatLimitsData(response)
			canReuse = !(limits.SuccessStep || response.SuccessStep)
		} catch (error) { /* 业务失败和格式错误不能作为成功记录。 */ }
		if (!canReuse && chatLimitsRequests.get(key) === record) chatLimitsRequests.delete(key)
		return response
	}, error => {
		if (chatLimitsRequests.get(key) === record) chatLimitsRequests.delete(key)
		throw error
	})
	if (key) chatLimitsRequests.set(key, record)
	return record.promise
}

async function sendApiRequest(data) {
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

	redirectToLoginForSpecialCode(response.data)

	return response.data
}
