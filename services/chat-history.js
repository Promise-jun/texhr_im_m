import { requestApi } from './request'
import { parseNimEmojiText } from './nim-emoji'

export const CHAT_GET_SINGLE_API = 'Chat.Chat.GetSingleChat'
export const CHAT_GET_SESSION_CONTENT_API = 'Chat.Chat.GetSessionContent'
export const CHAT_GET_JOB_STATE_API = 'Chat.Person.GetJobState'
export const CHAT_GET_BUTTON_API = 'Chat.ChatButton.Get'
export const CHAT_CHANGE_JOB_API = 'Chat.Chat.ChangeJob'
export const CHAT_GET_JOB_LIST_API = 'Chat.Chat.GetJobList'
const DEFAULT_AVATAR = '/static/default_avatar.png'

function accountId(value) {
	return value === undefined || value === null ? '' : String(value).trim()
}

function responseData(response, title) {
	if (!response || response.Code === undefined || Number(response.Code) !== 0) {
		throw new Error(`${title}失败，业务错误码：${response && response.Code !== undefined ? response.Code : 'unknown'}`)
	}
	let data = response.Data
	if (typeof data === 'string') {
		try {
			data = JSON.parse(data)
		} catch (error) {
			throw new Error(`${title}失败：接口 Data 不是有效 JSON`)
		}
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error(`${title}失败：接口数据格式不正确`)
	}
	if (data.Code !== undefined && Number(data.Code) !== 0) {
		throw new Error(`${title}失败，数据错误码：${data.Code}`)
	}
	return data
}

/** 文档 2266：通过双方网易云账号取得职位、简历及继续聊天所需的会话信息。 */
export async function getHistoryChatDetail(personAccId, enterpriseAccId) {
	const person = accountId(personAccId)
	const enterprise = accountId(enterpriseAccId)
	if (!person || !enterprise) throw new Error('未获取到会话账号信息')
	const response = await requestApi({
		Name: CHAT_GET_SINGLE_API,
		Content: { PersonAccId: person, EnterpriseAccId: enterprise }
	})
	const data = responseData(response, '获取会话信息')
	const jobId = accountId(data.JobId !== undefined ? data.JobId : response.JobId)
	const resumeId = accountId(data.ResumeId !== undefined ? data.ResumeId : response.ResumeId)
	if (!jobId || !resumeId) throw new Error('获取会话信息失败：未返回 JobId 或 ResumeId')
	return {
		...data,
		JobId: jobId,
		ResumeId: resumeId,
		PersonAccId: accountId(data.PersonAccId) || person,
		EnterpriseAccId: accountId(data.EnterpriseAccId) || enterprise
	}
}

/** 文档 2263：继续聊天前查询该会话职位的最新状态，1 正常、2 失效、3 已招满。 */
export async function getHistoryChatJobState(jobId) {
	const id = accountId(jobId)
	if (!id) throw new Error('未获取到职位信息')
	const response = await requestApi({
		Name: CHAT_GET_JOB_STATE_API,
		Content: { JobId: id }
	})
	const data = responseData(response, '获取职位状态')
	const state = Number(data.State)
	if (![1, 2, 3].includes(state)) throw new Error('获取职位状态失败：接口 State 格式不正确')
	return state
}

/** 文档 2259：查询当前会话的职位，供历史详情页与页面 JobId 比较。 */
export async function getHistoryChatButton(jobId, resumeId) {
	const job = accountId(jobId)
	const resume = accountId(resumeId)
	if (!job || !resume) throw new Error('未获取到职位或简历信息')
	const response = await requestApi({
		Name: CHAT_GET_BUTTON_API,
		Content: { JobId: job, ResumeId: resume }
	})
	const data = responseData(response, '获取聊天职位')
	const returnedJobId = accountId(data.JobId !== undefined ? data.JobId : response.JobId)
	if (!returnedJobId) throw new Error('获取聊天职位失败：未返回 JobId')
	return { ...data, JobId: returnedJobId, ToAccId: accountId(data.ToAccId) }
}

/** 文档 2264：切换到详情页或列表选中的目标职位，IsMessage=true 返回 Enterprise 卡片。 */
export async function changeHistoryChatJob(personAccId, enterpriseAccId, jobId) {
	const person = accountId(personAccId)
	const enterprise = accountId(enterpriseAccId)
	const job = accountId(jobId)
	if (!person || !enterprise || !job) throw new Error('缺少切换聊天职位所需信息')
	const response = await requestApi({
		Name: CHAT_CHANGE_JOB_API,
		Content: { PersonAccId: person, EnterpriseAccId: enterprise, JobId: job, IsMessage: true }
	})
	const data = responseData(response, '切换聊天职位')
	const card = data.Enterprise !== undefined ? data.Enterprise : response.Enterprise
	if (!card || typeof card !== 'object' || Array.isArray(card)) {
		throw new Error('切换聊天职位失败：未返回 Enterprise')
	}
	return card
}

/** 文档 2262：个人端通过企业 accid 获取首批 50 个发布中的职位。 */
export async function getHistoryChatJobList(enterpriseAccId) {
	const enterprise = accountId(enterpriseAccId)
	if (!enterprise) throw new Error('未获取到企业会话账号')
	const response = await requestApi({
		Name: CHAT_GET_JOB_LIST_API,
		Content: { accid: enterprise, Start: 0, pageSize: 50 }
	})
	const data = responseData(response, '获取职位列表')
	if (!Array.isArray(data.Rows)) throw new Error('获取职位列表失败：接口 Rows 格式不正确')
	return data.Rows.map((row, index) => {
		if (!row || typeof row !== 'object' || Array.isArray(row)) return null
		const jobId = accountId(row.JobId)
		if (!jobId) return null
		return { ...row, JobId: jobId, key: `job-${jobId}-${index}`,
			JobName: accountId(row.JobName) || '未命名职位',
			Location: accountId(row.Location) || '-', Salary: accountId(row.Salary) || '-' }
	}).filter(Boolean)
}

/** PC 实时聊天的职位切换列表：登录企业已由网关识别，不额外传 accid。 */
export async function getPcHistoryChatJobList() {
	const response = await requestApi({
		Name: CHAT_GET_JOB_LIST_API,
		Content: { Start: 0, pageSize: 50 }
	})
	if (!response || response.Code === undefined || Number(response.Code) !== 0) {
		throw new Error(`获取职位列表失败，业务错误码：${response && response.Code !== undefined ? response.Code : 'unknown'}`)
	}
	let data = response.Data
	if (typeof data === 'string') {
		try { data = JSON.parse(data) } catch (error) { throw new Error('获取职位列表失败：接口 Data 不是有效 JSON') }
	}
	if (Array.isArray(data)) data = { Rows: data }
	if (!data || typeof data !== 'object') data = response
	if (data.Code !== undefined && Number(data.Code) !== 0) throw new Error('获取职位列表失败')
	const rows = Array.isArray(data.Rows) ? data.Rows : Array.isArray(data.List) ? data.List
		: Array.isArray(response.Rows) ? response.Rows : []
	return rows.map((row, index) => {
		if (!row || typeof row !== 'object' || Array.isArray(row)) return null
		const jobId = accountId(row.JobId !== undefined ? row.JobId : row.Id !== undefined ? row.Id : row.ID)
		if (!jobId) return null
		return {
			...row,
			JobId: jobId,
			key: `job-${jobId}-${index}`,
			JobName: accountId(row.JobName !== undefined ? row.JobName : row.Name !== undefined ? row.Name
				: row.PositionName !== undefined ? row.PositionName : row.Title) || '未命名职位',
			Location: accountId(row.Location !== undefined ? row.Location : row.JobLocation !== undefined ? row.JobLocation
				: row.WorkLocation !== undefined ? row.WorkLocation : row.Address !== undefined ? row.Address : row.Area) || '-',
			Salary: accountId(row.Salary !== undefined ? row.Salary : row.SalaryText !== undefined ? row.SalaryText : row.Pay) || '-'
		}
	}).filter(Boolean)
}

function parseMessageData(value) {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value
	if (typeof value !== 'string') return null
	try {
		const parsed = JSON.parse(value)
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
	} catch (error) {
		// 普通文本和直接返回的媒体 URL 不是 JSON，保持原值展示即可。
		return null
	}
}

function mediaData(value) {
	const parsed = parseMessageData(value)
	const attachment = parsed && parseMessageData(parsed.attachment)
	return attachment || parsed || { url: typeof value === 'string' ? value : '' }
}

/** 历史库 MsgType=4/5 可能包含云信自定义消息的 type/data 外壳。 */
function businessMessageData(value) {
	let parsed = parseMessageData(value)
	if (parsed && parsed.data !== undefined) parsed = parseMessageData(parsed.data)
	return parsed
}

function jobData(value) {
	let parsed = businessMessageData(value)
	if (parsed && parsed.Enterprise !== undefined) parsed = parseMessageData(parsed.Enterprise)
	return parsed && (parsed.JobId || parsed.JobName) ? parsed : null
}

/** 企业 PC 端与实时聊天一致，从 type=4 的 Person 中读取人才信息，不补造简历字段。 */
function historyPersonData(payload) {
	const person = payload && parseMessageData(payload.Person)
	if (!person) return null
	const value = keys => {
		for (const key of keys) {
			const text = accountId(person[key])
			if (text) return text
		}
		return ''
	}
	const gender = value(['Gender', 'GenderName', 'Sex', 'SexName']).toLowerCase()
	const age = value(['Age', 'PersonAge'])
	const name = value(['PersonName', 'RealName', 'Name', 'NickName', 'UserName'])
	const meta = [
		['1', '男', 'male', 'm'].includes(gender) ? '男' : ['2', '女', 'female', 'f'].includes(gender) ? '女' : '',
		/^\d+$/.test(age) ? `${age}岁` : age,
		value(['Education', 'EducationName', 'EducationalBackground', 'Degree', 'EduName']),
		value(['Experience', 'WorkExperience', 'WorkYears', 'WorkingYears', 'WorkYear', 'WorkExperienceName'])
	].filter(Boolean)
	const jobName = value(['Post', 'JobName', 'Job', 'ExpectedJob', 'ExpectJob', 'Position', 'PositionName',
		'IntentionalPosition', 'IntendedPosition', 'JobIntention', 'IntentionJob'])
	const location = value(['Location', 'City', 'Address', 'AddressName', 'ExpectedLocation', 'ExpectLocation',
		'JobLocation', 'WorkLocation', 'WorkCity', 'Area', 'IntentionCity'])
	return name || meta.length || jobName || location ? { name: name || '人才信息', meta, jobName, location } : null
}

function formatHistoryTime(value) {
	const text = value === undefined || value === null ? '' : String(value)
	// 接口可能返回 ISO 时间，也可能已经是“昨天 10:00”等展示文案；只格式化前者。
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text
	const date = new Date(text)
	if (Number.isNaN(date.getTime())) return text
	const now = new Date()
	const pad = number => String(number).padStart(2, '0')
	const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
	if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return time
	const day = `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${time}`
	return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}年${day}`
}

export function normalizeHistoryMessage(row, index, perspective = 'person') {
	if (!row || typeof row !== 'object' || Array.isArray(row)) return null
	const messageType = Number(row.MsgType)
	const base = {
		id: `history-${index}`,
		// IsMySend 决定左右布局，不能把字符串 "false" 直接转换为 true。
		direction: row.IsMySend === true || row.IsMySend === 1 || row.IsMySend === '1' || row.IsMySend === 'true'
			? 'self' : 'other',
		avatar: accountId(row.Icon) || DEFAULT_AVATAR,
		name: row.Name || '',
		// 保留每条消息的时间，ISO 日期按 chat.vue 的规则转换为可读文案。
		time: formatHistoryTime(row.ShowTime),
		messageType
	}
	if (messageType === 2 || messageType === 3) {
		const attachment = mediaData(row.Msg)
		const url = accountId(attachment.url || attachment.Url)
		if (url) {
			const duration = Math.max(0, Number(attachment.duration) || 0)
			return {
				...base,
				type: messageType === 2 ? 'image' : 'audio',
				url,
				mimeType: attachment.mimeType || attachment.contentType || attachment.mime || '',
				// 保留媒体附件供 PC 播放器按 ext/name 判断无后缀下载地址的音频格式。
				attachment: { ...attachment, url },
				// 与 chat.vue 一致：网易云语音附件 duration 单位为毫秒。
				durationSeconds: duration ? Math.max(1, Math.ceil(duration / 1000)) : 0
			}
		}
	}
	if (messageType === 4 || messageType === 5) {
		// 个人端仍显示职位卡片；企业 PC 的 Person 卡片和职位切换提示单独解析。
		if (perspective === 'enterprise') {
			const payload = businessMessageData(row.Msg)
			const person = messageType === 4 ? historyPersonData(payload) : null
			if (person) return { ...base, type: 'person-card', person }
			const enterprise = payload && (parseMessageData(payload.Enterprise) || payload)
			if (messageType === 5 && enterprise && accountId(enterprise.Tips)) {
				return { ...base, type: 'system', content: accountId(enterprise.Tips) }
			}
		}
		const job = jobData(row.Msg)
		if (job) return { ...base, type: 'job-card', job, customType: messageType }
	}
	const labels = { 2: '[图片]', 3: '[语音]', 4: '[职位信息]', 5: '[职位变更]' }
	const content = messageType === 1
		? String(row.Msg === undefined || row.Msg === null ? '' : row.Msg)
		: labels[messageType] || '[暂不支持的消息]'
	return { ...base, type: 'text', content, segments: parseNimEmojiText(content) }
}

/** 文档 2247：一次返回该会话全部 Rows，不接入 SDK 分页，也不发送初始化招呼语。 */
export async function getHistoryChatMessages(fromAccid, toAccid, perspective = 'person') {
	const from = accountId(fromAccid)
	const to = accountId(toAccid)
	if (!from || !to) throw new Error('未获取到会话账号信息')
	// 网关请求方式、鉴权与 Content 序列化统一交给项目的 requestApi 封装。
	const response = await requestApi({
		Name: CHAT_GET_SESSION_CONTENT_API,
		Content: { fromAccid: from, toAccid: to }
	})
	const data = responseData(response, '获取历史聊天记录')
	if (!Array.isArray(data.Rows)) throw new Error('获取历史聊天记录失败：接口 Rows 格式不正确')
	// 保留服务端返回的聊天顺序及每条记录的头像，不按 Accid 去重（同一人可发送多条消息）。
	return data.Rows.map((row, index) => normalizeHistoryMessage(row, index, perspective)).filter(Boolean)
}
