import { getNimInstance, isNimLoggedIn } from './nim'
import { requestApi } from './request'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const CONVERSATION_PAGE_SIZE = 100
const HISTORY_CONVERSATION_MAX_PAGES = 1000
const HISTORY_REPEAT_PAGE_LIMIT = 2
const DEFAULT_AVATAR = '/static/default_avatar.png'

export const NIM_GET_ALL_SESSIONS_API = 'Chat.Chat.GetAllSessions'

const MESSAGE_TYPE_TEXT = 0
const MESSAGE_STATE_REVOKED = 1
const MESSAGE_STATE_BACKFILL = 2

const MESSAGE_TYPE_PREVIEW = Object.freeze({
	1: '[图片]',
	2: '[语音]',
	3: '[视频]',
	4: '[位置]',
	5: '[通知消息]',
	6: '[文件]',
	7: '[音视频通话]',
	10: '[提示消息]',
	11: '[机器人消息]',
	12: '[通话消息]',
	100: '[自定义消息]'
})

function toTimestamp(value) {
	const timestamp = Number(value)
	return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0
}

/** 最近消息时间用于会话排序和时间文案，避免置顶操作改变 updateTime 后扰乱排序。 */
export function getConversationActivityTime(conversation) {
	const normalizedActivityTime = toTimestamp(conversation && conversation.activityTime)
	if (normalizedActivityTime) return normalizedActivityTime

	const messageRefer = conversation && conversation.lastMessage
		? conversation.lastMessage.messageRefer
		: null

	return toTimestamp(messageRefer && messageRefer.createTime)
		|| toTimestamp(conversation && conversation.createTime)
		|| toTimestamp(conversation && conversation.updateTime)
}

/**
 * 分页拉完 SDK 本地会话缓存，避免只展示第一页会话。
 * 结果按 conversationId 去重，兼容同步期间页面重复刷新。
 */
export async function getAllNimConversations() {
	if (!isNimLoggedIn()) {
		throw new Error('网易云信尚未登录')
	}

	const nim = getNimInstance()
	const conversationService = nim.V2NIMLocalConversationService
	if (!conversationService) {
		throw new Error('当前网易云信 SDK 不支持本地会话服务')
	}

	const conversationMap = new Map()
	let offset = 0
	let finished = false

	while (!finished) {
		const result = await conversationService.getConversationList(offset, CONVERSATION_PAGE_SIZE)
		const conversationList = result && Array.isArray(result.conversationList)
			? result.conversationList
			: []

		conversationList.forEach(conversation => {
			if (conversation && conversation.conversationId) {
				conversationMap.set(conversation.conversationId, conversation)
			}
		})

		finished = Boolean(result && result.finished)
		if (finished) break

		const nextOffset = Number(result && result.offset)
		if (!Number.isFinite(nextOffset) || nextOffset === offset) {
			throw new Error('拉取网易云信会话列表失败：分页偏移量无效')
		}
		offset = nextOffset
	}

	return Array.from(conversationMap.values())
}

function parseResponseData(data) {
	if (typeof data !== 'string') return data || {}
	if (!data.trim()) return {}

	try {
		return JSON.parse(data)
	} catch (error) {
		throw new Error('获取历史会话失败：接口 Data 不是有效 JSON')
	}
}

function assertHistoryResponse(response) {
	if (!response || Number(response.Code) !== 0) {
		const code = response && response.Code !== undefined ? response.Code : 'unknown'
		throw new Error(`获取历史会话失败，业务错误码：${code}`)
	}

	const data = parseResponseData(response.Data)
	if (data.Code !== undefined && Number(data.Code) !== 0) {
		throw new Error(`获取历史会话失败，数据错误码：${data.Code}`)
	}

	return Array.isArray(data.Sessions) ? data.Sessions : []
}

function createP2pConversationId(accountId) {
	try {
		return getNimInstance().V2NIMConversationIdUtil.p2pConversationId(accountId)
	} catch (error) {
		// SDK 工具不可用时仍保留目标账号，避免整条历史会话无法展示。
		return accountId
	}
}

/** 将 texhr 会话库返回结构转换成 index.vue 共用的聊天列表结构。 */
export function normalizeHistoryConversation(session) {
	const targetId = session && session.Accid !== undefined && session.Accid !== null
		? String(session.Accid).trim()
		: ''
	if (!targetId) return null

	const conversationId = createP2pConversationId(targetId)
	return {
		id: conversationId,
		conversationId,
		targetId,
		type: 1,
		name: session.Name || targetId,
		avatar: session.Icon || DEFAULT_AVATAR,
		message: session.LastMsg || '暂无消息',
		// 接口已提供用于会话列表展示的 ShowTime，保持服务端格式，不再二次转换。
		time: session.ShowTime || '',
		stickTop: false,
		mute: false,
		unreadCount: 0,
		unreadText: '0',
		isHistory: true
	}
}

/**
 * 根据接口文档分页获取 texhr 数据库中的所有会话。
 *
 * 首次请求不传可选 start，使用服务端默认首页；随后从 start=1 递增。
 * 兼容默认首页与 start=1 指向同一页的情况，按 Accid 去重，并在连续重复页时停止。
 */
export async function getAllHistoryConversations() {
	if (!isNimLoggedIn()) throw new Error('网易云信尚未登录')

	const loginService = getNimInstance().V2NIMLoginService
	const accountId = loginService && typeof loginService.getLoginUser === 'function'
		? loginService.getLoginUser()
		: ''
	if (!accountId) throw new Error('获取历史会话失败：未获取到当前网易云账号')

	const conversationMap = new Map()
	let repeatedPageCount = 0
	let paginationFinished = false

	for (let pageIndex = 0; pageIndex < HISTORY_CONVERSATION_MAX_PAGES; pageIndex += 1) {
		const content = { accid: accountId }
		if (pageIndex > 0) content.start = pageIndex

		const response = await requestApi({
			Name: NIM_GET_ALL_SESSIONS_API,
			Content: content
		})
		const sessions = assertHistoryResponse(response)
		if (!sessions.length) {
			paginationFinished = true
			break
		}

		let addedCount = 0
		sessions.forEach(session => {
			const conversation = normalizeHistoryConversation(session)
			if (!conversation) return
			if (!conversationMap.has(conversation.targetId)) addedCount += 1
			conversationMap.set(conversation.targetId, conversation)
		})

		repeatedPageCount = addedCount > 0 ? 0 : repeatedPageCount + 1
		if (repeatedPageCount >= HISTORY_REPEAT_PAGE_LIMIT) {
			paginationFinished = true
			break
		}
	}
	if (!paginationFinished) throw new Error('获取历史会话失败：分页数量超过安全上限')

	return Array.from(conversationMap.values())
}

/** 进入聊天页后清除该会话未读数，SDK 会再通过 onConversationChanged 回推最新会话。 */
export async function markNimConversationRead(conversationId) {
	if (!conversationId || !isNimLoggedIn()) return

	const conversationService = getNimInstance().V2NIMLocalConversationService
	if (!conversationService) return
	await conversationService.clearUnreadCountByIds([conversationId])
}

function padNumber(value) {
	return value < 10 ? `0${value}` : String(value)
}

/** 按聊天列表惯例显示：今天显示时分、昨天显示“昨天”、七天内显示星期。 */
export function formatConversationTime(timestamp, now = Date.now()) {
	if (!timestamp) return ''

	const date = new Date(timestamp)
	const currentDate = new Date(now)
	const todayStart = new Date(
		currentDate.getFullYear(),
		currentDate.getMonth(),
		currentDate.getDate()
	).getTime()
	const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
	const calendarDayDiff = Math.round((todayStart - dateStart) / DAY_IN_MS)

	if (calendarDayDiff === 0) {
		return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`
	}
	if (calendarDayDiff === 1) return '昨天'
	if (timestamp >= now - 7 * DAY_IN_MS) {
		return `周${'日一二三四五六'.charAt(date.getDay())}`
	}
	if (date.getFullYear() === currentDate.getFullYear()) {
		return `${date.getMonth() + 1}月${date.getDate()}日`
	}
	return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function getLastMessagePreview(lastMessage, conversationType) {
	if (!lastMessage) return '暂无消息'
	if (lastMessage.lastMessageState === MESSAGE_STATE_REVOKED) {
		return lastMessage.text || '[消息已撤回]'
	}
	if (lastMessage.lastMessageState === MESSAGE_STATE_BACKFILL) return '[消息已删除]'

	const messageType = Number(lastMessage.messageType)
	const content = messageType === MESSAGE_TYPE_TEXT
		? (lastMessage.text || '[文本消息]')
		: (MESSAGE_TYPE_PREVIEW[messageType] || '[未知消息]')

	// 群聊摘要带上发送者，单聊直接显示内容，符合常见会话列表展示方式。
	if (conversationType !== 1 && lastMessage.senderName) {
		return `${lastMessage.senderName}: ${content}`
	}
	return content
}

function getConversationTargetId(conversationId) {
	try {
		return getNimInstance().V2NIMConversationIdUtil.parseConversationTargetId(conversationId)
	} catch (error) {
		return conversationId
	}
}

export function normalizeConversation(conversation, now = Date.now()) {
	const conversationId = conversation && conversation.conversationId
		? String(conversation.conversationId)
		: ''
	const activityTime = getConversationActivityTime(conversation)
	const unreadCount = Math.max(0, Number(conversation && conversation.unreadCount) || 0)
	const targetId = getConversationTargetId(conversationId)

	return {
		id: conversationId,
		conversationId,
		targetId,
		type: Number(conversation && conversation.type) || 0,
		name: conversation && conversation.name ? conversation.name : targetId || '未知会话',
		avatar: conversation && conversation.avatar ? conversation.avatar : DEFAULT_AVATAR,
		message: getLastMessagePreview(
			conversation && conversation.lastMessage,
			Number(conversation && conversation.type)
		),
		time: formatConversationTime(activityTime, now),
		activityTime,
		stickTop: Boolean(conversation && conversation.stickTop),
		mute: Boolean(conversation && conversation.mute),
		unreadCount,
		unreadText: unreadCount > 99 ? '99+' : String(unreadCount),
		// 页面级新消息监听的兜底标记；SDK 未及时更新 unreadCount 时仍能显示红点。
		hasNewMessage: Boolean(conversation && conversation.hasNewMessage)
	}
}

/** 会话列表排序规则：置顶优先；同一层级按最近消息时间倒序。 */
export function normalizeAndSortConversations(conversationList, now = Date.now()) {
	return (Array.isArray(conversationList) ? conversationList : [])
		.map(conversation => normalizeConversation(conversation, now))
		.filter(conversation => conversation.id)
		.sort((left, right) => {
			if (left.stickTop !== right.stickTop) return left.stickTop ? -1 : 1
			if (left.activityTime !== right.activityTime) return right.activityTime - left.activityTime
			return left.id.localeCompare(right.id)
		})
}
