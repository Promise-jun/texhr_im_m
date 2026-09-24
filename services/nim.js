import NIM from 'nim-web-sdk-ng/dist/v2/NIM_UNIAPP_SDK'
import { requestApi } from './request'

export const NIM_APP_KEY = 'cfa8e6f3733c34b9dbd7bef547226d71'
export const NIM_CREATE_USER_API = 'Chat.Chat.CreateUser'

export const NIM_EVENT = Object.freeze({
	LOGIN_STATUS: 'nim:login-status',
	CONNECT_STATUS: 'nim:connect-status',
	LOGIN_FAILED: 'nim:login-failed',
	DISCONNECTED: 'nim:disconnected',
	KICKED_OFFLINE: 'nim:kicked-offline',
	CONVERSATION_SYNC_STARTED: 'nim:conversation-sync-started',
	CONVERSATION_SYNC_FINISHED: 'nim:conversation-sync-finished',
	CONVERSATION_SYNC_FAILED: 'nim:conversation-sync-failed',
	CONVERSATION_CREATED: 'nim:conversation-created',
	CONVERSATION_CHANGED: 'nim:conversation-changed',
	CONVERSATION_DELETED: 'nim:conversation-deleted',
	TOTAL_UNREAD_COUNT_CHANGED: 'nim:total-unread-count-changed',
	// SDK 收到一批新消息后统一转发给页面，避免每个页面重复直接绑定 SDK。
	MESSAGE_RECEIVED: 'nim:message-received'
})

let nimInstance = null
let loginPromise = null
let lastLoginError = null
// 当前前台聊天会话 ID；消息列表页据此避免给正在查看的会话重复显示红点。
let activeConversationId = ''

function emit(eventName, payload) {
	if (typeof uni !== 'undefined' && typeof uni.$emit === 'function') {
		uni.$emit(eventName, payload)
	}
}

function bindLoginListeners(nim) {
	const loginService = nim.V2NIMLoginService

	loginService.on('onLoginStatus', status => {
		if (status === 1) lastLoginError = null
		console.log('[NIM] 登录成功', status)
		emit(NIM_EVENT.LOGIN_STATUS, status)
	})
	loginService.on('onConnectStatus', status => {
		console.log('[NIM] 连接成功', status)
		emit(NIM_EVENT.CONNECT_STATUS, status)
	})
	loginService.on('onLoginFailed', error => {
		lastLoginError = error
		console.error('[NIM] 登录失败', error)
		emit(NIM_EVENT.LOGIN_FAILED, error)
	})
	loginService.on('onDisconnected', error => {
		console.warn('[NIM] 连接已断开', error)
		emit(NIM_EVENT.DISCONNECTED, error)
	})
	loginService.on('onKickedOffline', detail => {
		console.warn('[NIM] 当前账号被踢下线', detail)
		emit(NIM_EVENT.KICKED_OFFLINE, detail)
	})
}

/**
 * 统一监听本地会话模块，并转换为 uni 全局事件供页面消费。
 *
 * 监听放在 SDK 单例初始化阶段，避免页面进入较晚而漏掉登录后的首次同步事件；
 * 页面仍需在卸载时解绑自己注册的 uni 事件，防止重复刷新。
 */
function bindConversationListeners(nim) {
	const conversationService = nim.V2NIMLocalConversationService
	if (!conversationService) {
		console.warn('[NIM] 当前 SDK 不支持本地会话服务')
		return
	}

	conversationService.on('onSyncStarted', () => {
		emit(NIM_EVENT.CONVERSATION_SYNC_STARTED)
	})
	conversationService.on('onSyncFinished', () => {
		emit(NIM_EVENT.CONVERSATION_SYNC_FINISHED)
	})
	conversationService.on('onSyncFailed', error => {
		console.error('[NIM] 会话同步失败', error)
		emit(NIM_EVENT.CONVERSATION_SYNC_FAILED, error)
	})
	conversationService.on('onConversationCreated', conversation => {
		emit(NIM_EVENT.CONVERSATION_CREATED, conversation)
	})
	conversationService.on('onConversationChanged', conversationList => {
		emit(NIM_EVENT.CONVERSATION_CHANGED, conversationList)
	})
	conversationService.on('onConversationDeleted', conversationIds => {
		emit(NIM_EVENT.CONVERSATION_DELETED, conversationIds)
	})
	conversationService.on('onTotalUnreadCountChanged', unreadCount => {
		emit(NIM_EVENT.TOTAL_UNREAD_COUNT_CHANGED, unreadCount)
	})
}

/**
 * 在 SDK 单例层监听新消息，并转成 uni 全局事件。
 *
 * 监听必须早于页面打开，才能覆盖 App 登录后的离线消息同步以及页面切换期间的实时消息。
 * 页面只负责按自己的场景过滤消息，不再直接操作 V2NIMMessageService 监听器。
 */
function bindMessageListeners(nim) {
	const messageService = nim.V2NIMMessageService
	if (!messageService || typeof messageService.on !== 'function') {
		console.warn('[NIM] 当前 SDK 不支持消息服务，无法监听新消息')
		return
	}

	messageService.on('onReceiveMessages', messageList => {
		const receivedMessages = Array.isArray(messageList) ? messageList.filter(Boolean) : []
		if (!receivedMessages.length) return
		// 保留 SDK 原始消息对象，聊天页需要完整消息结构渲染文本、图片和语音。
		emit(NIM_EVENT.MESSAGE_RECEIVED, receivedMessages)
	})
}

/**
 * 创建并返回全局唯一的云信 IM 实例。
 * 初始化只需要 AppKey，不会在没有账号凭证时发起登录。
 */
export function initNim() {
	if (nimInstance) return nimInstance

	nimInstance = NIM.getInstance({
		appkey: NIM_APP_KEY,
		apiVersion: 'v2',
		debugLevel: 'warn'
	})

	bindLoginListeners(nimInstance)
	bindConversationListeners(nimInstance)
	bindMessageListeners(nimInstance)
	return nimInstance
}

/**
 * 初始化云信 SDK，向业务接口获取云信账号凭证，然后完成云信登录。
 */
export async function initAndLoginNim() {
	// 第一步：使用 AppKey 创建云信 SDK 单例，确保后续可以调用登录服务。
	const nim = initNim()
	lastLoginError = null

	try {
		// 第二步：通过用户态接口获取或创建当前用户的云信账号与密码。
		const response = await requestApi({
			Name: NIM_CREATE_USER_API,
			Content: ""
		})

		if (!response || Number(response.Code) !== 0) {
			const code = response && response.Code !== undefined ? response.Code : 'unknown'
			throw new Error(`获取云信账号失败，业务错误码：${code}`)
		}

		const credentials = response.Data || {}
		if (credentials.Code !== undefined && Number(credentials.Code) !== 0) {
			throw new Error(`获取云信账号失败，数据错误码：${credentials.Code}`)
		}

		const account = typeof credentials.Account === 'string' ? credentials.Account.trim() : ''
		const token = typeof credentials.WangYiYunToken === 'string' ? credentials.WangYiYunToken : ''
		if (!account || !token) {
			throw new Error('获取云信账号失败：接口未返回有效的账号或密码')
		}

		// 第三步：使用接口返回的 Account 和 WangYiYunToken 登录网易云信。
		await loginNim(account, token)
		return nim
	} catch (error) {
		// 业务凭证接口失败时 SDK 不会触发 onLoginFailed，这里补发事件给会话页结束加载态。
		if (lastLoginError !== error) {
			lastLoginError = error
			emit(NIM_EVENT.LOGIN_FAILED, error)
		}
		throw error
	}
}

/**
 * 使用业务服务端下发的云信账号和 token 登录。
 */
export function loginNim(account, token) {
	const accountId = typeof account === 'string' ? account.trim() : ''
	if (!accountId || typeof token !== 'string' || !token) {
		return Promise.reject(new Error('登录云信 IM 需要有效的 account 和 token'))
	}

	if (loginPromise) return loginPromise

	const nim = initNim()
	const loginService = nim.V2NIMLoginService

	loginPromise = (async () => {
		const loginStatus = loginService.getLoginStatus()


		if (loginStatus === 1 && loginService.getLoginUser() === accountId) return nim
		if (loginStatus === 1 || loginStatus === 2) await loginService.logout()

		await loginService.login(accountId, token, {
			authType: 0
		})
		return nim
	})().finally(() => {
		loginPromise = null
	})

	return loginPromise
}

export async function logoutNim() {
	if (!nimInstance) return
	const loginStatus = nimInstance.V2NIMLoginService.getLoginStatus()
	if (loginStatus === 1 || loginStatus === 2) {
		await nimInstance.V2NIMLoginService.logout()
	}
}

export function getNimInstance() {
	return nimInstance || initNim()
}

/**
 * 会话页通过该状态判断是否可以读取本地会话缓存。
 * 登录中先等待 LOGIN_STATUS 或 CONVERSATION_SYNC_FINISHED 事件，不提前请求空数据。
 */
export function isNimLoggedIn() {
	return Boolean(
		nimInstance
		&& nimInstance.V2NIMLoginService
		&& nimInstance.V2NIMLoginService.getLoginStatus() === 1
	)
}

export function getNimLoginError() {
	return lastLoginError
}

/** 标记当前正在前台查看的聊天会话，供消息列表页判断是否需要显示红点。 */
export function setActiveConversationId(conversationId) {
	activeConversationId = conversationId ? String(conversationId) : ''
}

export function getActiveConversationId() {
	return activeConversationId
}

/** 仅清除仍属于当前页面的会话，避免旧页面误清理新打开的会话。 */
export function clearActiveConversationId(conversationId) {
	if (!conversationId || activeConversationId === String(conversationId)) {
		activeConversationId = ''
	}
}

export async function destroyNim() {
	if (!nimInstance) {
		activeConversationId = ''
		return
	}

	await nimInstance.destroy()
	nimInstance = null
	loginPromise = null
	lastLoginError = null
	activeConversationId = ''
}
