import NIM from 'nim-web-sdk-ng/dist/v2/NIM_UNIAPP_SDK'
import { requestApi } from './request'

export const NIM_APP_KEY = 'cfa8e6f3733c34b9dbd7bef547226d71'
export const NIM_CREATE_USER_API = 'Chat.Chat.CreateUser'

export const NIM_EVENT = Object.freeze({
	LOGIN_STATUS: 'nim:login-status',
	CONNECT_STATUS: 'nim:connect-status',
	LOGIN_FAILED: 'nim:login-failed',
	DISCONNECTED: 'nim:disconnected',
	KICKED_OFFLINE: 'nim:kicked-offline'
})

let nimInstance = null
let loginPromise = null

function emit(eventName, payload) {
	if (typeof uni !== 'undefined' && typeof uni.$emit === 'function') {
		uni.$emit(eventName, payload)
	}
}

function bindLoginListeners(nim) {
	const loginService = nim.V2NIMLoginService

	loginService.on('onLoginStatus', status => {
		emit(NIM_EVENT.LOGIN_STATUS, status)
	})
	loginService.on('onConnectStatus', status => {
		emit(NIM_EVENT.CONNECT_STATUS, status)
	})
	loginService.on('onLoginFailed', error => {
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
	return nimInstance
}

/**
 * 初始化云信 SDK，向业务接口获取云信账号凭证，然后完成云信登录。
 */
export async function initAndLoginNim() {
	// 第一步：使用 AppKey 创建云信 SDK 单例，确保后续可以调用登录服务。
	const nim = initNim()

	// 第二步：通过用户态接口获取或创建当前用户的云信账号与密码。
	const response = await requestApi({
		Name: NIM_CREATE_USER_API,
		Content: {}
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

export async function destroyNim() {
	if (!nimInstance) return

	await nimInstance.destroy()
	nimInstance = null
	loginPromise = null
}
