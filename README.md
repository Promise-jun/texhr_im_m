# texhr-im-mobile

## 网易云信 IM

项目已接入 `nim-web-sdk-ng >= 10`，使用适配 uni-app 的 V2 SDK。应用启动后会初始化 SDK，调用 `Chat.Chat.CreateUser` 获取 `Account` 和 `WangYiYunToken`，再自动登录云信。

如需切换账号或手动重新登录，可调用：

```js
import { loginNim } from '@/services/nim'

await loginNim(account, token)
```

其他页面需要调用 SDK 时，可取得同一个实例：

```js
import { getNimInstance } from '@/services/nim'

const nim = getNimInstance()
```

注意：云信 token 应由业务服务端生成并下发，不应在前端代码中硬编码。登录状态、连接状态和异常会分别通过 `uni.$emit` 发布，事件名可从 `NIM_EVENT` 导入。

## CFW OpenAPI 请求

所有业务接口通过 `services/request.js` 统一请求。调用方传入接口名称与主体参数，`Version` 默认使用 `V1.0.0`：

```js
import { requestApi } from '@/services/request'

const result = await requestApi({
	Name: 'Person.Account.GetPersonalInformation',
	Content: {},
	Version: 'V1.0.0'
})
```

封装会向网关发起 POST 请求，外层 `Ip` 字段当前固定传空字符串。`Content` 传入对象时会自动转换为 JSON 字符串。`PersonId` 和 `Token` 从 `persontokeninfotexhr` Cookie 读取；新版 Cookie 内容格式为 `personId=...&token=...`，同时兼容旧的 JSON 格式。Cookie 不存在、无法被页面脚本读取或内容无效时传空字符串。

H5 本地开发已在 `manifest.json` 配置反向代理：`/proxy/cfw-openapi` 转发到 `https://openapi.cfw.cn`。修改代理配置后需要停止并重新运行 H5。生产部署时仍需由站点服务端配置同域反向代理，也可通过 `configureRequest({ apiUrl })` 切换地址。App 端不受浏览器 CORS 限制。

## H5 测试环境调试

H5 端已接入 `vconsole`。本地开发模式会自动显示 VConsole；测试环境构建时设置 `VUE_APP_ENV=test` 即可启用。未设置测试标识的生产构建不会初始化 VConsole。
