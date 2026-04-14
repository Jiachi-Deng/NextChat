# NextChat 交接说明：部署、域名、手机 PWA 与常见坑

本文档给后续接手的 Claude / 新人使用。目标不是解释所有前端概念，而是把这次真实遇到的问题、已经确认的结论、以及后续最稳的操作路径讲清楚。

## 1. 当前代码与部署状态

### 已经合入并推送的提交

- `42cc842c` `feat: add telegram-style mobile chat header`
- `b8b21a2a` `feat: add streaming response setting`
- `c607081c` `chore: add redacted openai proxy diagnostics`
- `7878697a` `chore: surface proxy diagnostics in logs`
- `ff9b17fb` `chore: remove noisy openai route log`
- `b608e94f` `feat: add api health status panel`
- `deb0283a` `fix: harden api health tracking and password input a11y`

### 当前应该使用的固定 Vercel 项目

- 项目名：`nextchat-manual-baseurl-diag-final-1776129883`
- Project ID：`prj_i0A60imY7aYN5YvY4qQWTp3mWjgJ`
- Team：`jiachideng99-5438s-projects`
- Team ID：`team_d2270KJ7SSGyP3hJP2bTOg4S`

### 当前固定入口

- 固定 Vercel alias：
  - `https://nextchat-manual-baseurl-diag-final.vercel.app`
- 最新生产 deployment：
  - `https://nextchat-manual-baseurl-diag-final-1776129883-3hi2vri5p.vercel.app`
- 自定义域名：
  - `https://topologic.hk`
  - `https://www.topologic.hk`

注意：后续验收和 PWA 安装都不要再用随机 deployment URL。只用固定 alias 或正式域名。

## 2. 这次改了什么

### 2.1 API health status panel

新增了一个“当前状态”入口，放在设置页 `Base URL / API Key / Model` 区域下方。

功能口径：

- 只统计主聊天请求
- 不统计自动标题/摘要请求
- 只按当前 URL 单独统计
- 换 URL 后重新积累

相关文件：

- `app/store/api-health.ts`
- `app/store/chat.ts`
- `app/store/index.ts`
- `app/components/settings.tsx`
- `app/components/settings.module.scss`
- `app/locales/cn.ts`
- `app/locales/en.ts`

### 2.2 流式响应开关

给设置增加了“流式响应”开关，目的是让用户在遇到第三方中转站不稳定时，可以手动关闭流式，而不是代码里硬编码强制非流式。

### 2.3 Telegram 风格移动端聊天头部

移动端顶部 bar 按 Telegram 风格做了贴近实现，包括：

- 更轻的返回箭头
- 中间胶囊标题
- 右侧头像入口
- 资料卡从右侧滑出

注意：只改了移动端聊天头部，不应该影响聊天正文里的头像样式。

## 3. 这次确认并修掉的两个真实 bug

### 3.1 客户端运行时崩溃：`Cannot read properties of undefined (reading 'ok')`

#### 现象

- 手机上出现 `Application error: a client-side exception has occurred`
- 本地开发环境曾明确出现：
  - `TypeError: Cannot read properties of undefined (reading 'ok')`

#### 根因

在 `API health status panel` 首版里，`app/store/chat.ts` 的 `onFinish` 里直接读了：

- `responseRes.ok`
- `responseRes.status`

但底层聊天逻辑在流式 / 中断 / abort 场景下，`onFinish` 可能没有 `responseRes`。

这在手机上更容易触发，因为手机 Safari / PWA 更容易出现：

- 流式连接被中断
- 切后台后恢复
- 网络切换
- 触发 abort

#### 修复

- `app/client/api.ts`
  - `onFinish` 签名从必须有 `responseRes` 改为可选
- `app/store/chat.ts`
  - 对 `responseRes` 做可选兜底
  - `success` 回退为基于 `message` 和 `botMessage.isError` 判断

这部分修复已经在 `deb0283a` 中。

### 3.2 React `aria` 告警

#### 现象

浏览器控制台报：

- `The aria attribute is reserved for future use in React`

#### 根因

`PasswordInput` 组件把自定义的 `aria` prop 传递到了不该传的地方，形成了非法 DOM 属性链路。

根源文件：

- `app/components/ui-lib.tsx`

#### 修复

把 `PasswordInput` 的通用 `aria` 改成只给显隐按钮使用的 `toggleAriaLabel`，并同步修改调用点：

- `app/components/ui-lib.tsx`
- `app/components/auth.tsx`
- `app/components/realtime-chat/realtime-config.tsx`
- `app/components/settings.tsx`

这部分修复也在 `deb0283a` 中。

## 4. 这次遇到但暂时没处理的 warning / 非主阻塞问题

### 4.1 `apple-mobile-web-app-capable` 弃用提示

现象：

- 控制台警告：
  - `<meta name="apple-mobile-web-app-capable" content="yes"> is deprecated`

来源：

- `app/layout.tsx`

结论：

- 低优先级
- 不影响当前功能
- 后续可补 `mobile-web-app-capable`

### 4.2 `ERR_CONNECTION_CLOSED`

现象：

- 控制台会看到几条 `Failed to load resource: net::ERR_CONNECTION_CLOSED`

根因：

- 远程插件 schema 通过 `ghp.ci -> raw.githubusercontent.com` 拉取失败
- 来源于 `public/plugins.json`

结论：

- 不影响主聊天链路
- 影响的是插件 schema 加载
- 暂时不必把它误判成站点主功能故障

### 4.3 表单 `id/name` issue

现象：

- 浏览器 issue：`A form field element should have an id or name attribute`

结论：

- 真实但不是当前主阻塞
- 可后续专项清理

### 4.4 构建 warning：`rt-client`

Vercel 构建会持续出现：

- `bufferutil` 未解析
- `utf-8-validate` 未解析

还有：

- `unused-imports/no-unused-imports` 在 `app/constant.ts:1` 会导致 ESLint 插件崩溃

结论：

- 这些是仓库当前已有问题
- 构建虽然有 warning / lint error 日志，但最终 production deploy 仍然能成功完成
- 不要把它们误判成“本次改动引入的新问题”

## 5. 第三方中转站 API 的真实结论

这次花了很多时间排查聊天不稳定，最后基本确认主因是第三方中转站，而不是 UI 或手机本身。

### 关键结论

- `api.nengpa.com` + `MiniMax-M2.7` 链路明显不稳定
- 表现包括：
  - `400`
  - `504`
  - `Load failed`
  - `empty response from server`
- 改用 `DeepSeek 官方 API` 后，体验恢复正常，且日志连续返回 `200`

### 产品层处理

- 增加了流式响应开关
- 增加了 API health status panel

### 给后续接手者的判断原则

如果用户说：

- 电脑偶尔能回
- 手机经常不回
- 同一套 Base URL / API Key 昨天行今天不行

先不要急着怀疑前端 UI。先看：

- 是否是第三方中转站
- 是否是流式响应不稳
- 是否有 `400/504` 混合出现

## 6. Vercel / Git / 项目绑定方面踩过的坑

### 6.1 `.vercel/project.json` 曾经指向了错误项目

本地仓库原本的 `.vercel/project.json` 指向：

- `nextchat-shell-clean`
- Project ID：`prj_HolG7oB9DSxWWZAteObxjWgocxWU`

这个项目后来已经不再是正确目标，导致最开始部署、读取项目信息时混乱。

### 6.2 正确做法

重新 link 到固定项目：

```bash
cd /Users/jachi/Desktop/letta-workspace/vendor/NextChat
vercel link --yes --team team_d2270KJ7SSGyP3hJP2bTOg4S --project prj_i0A60imY7aYN5YvY4qQWTp3mWjgJ
```

CLI 会提示 `--team` 已废弃，后续也可以改用：

```bash
vercel link --yes --scope jiachideng99-5438s-projects --project prj_i0A60imY7aYN5YvY4qQWTp3mWjgJ
```

### 6.3 当前标准部署命令

```bash
cd /Users/jachi/Desktop/letta-workspace/vendor/NextChat
vercel deploy --prod --yes --scope jiachideng99-5438s-projects
```

### 6.4 这次真实部署流程

- 先装 CLI：`npm install -g vercel@51.2.0`
- 登录态可用：`vercel whoami`
- 重新 link 正确项目
- 再发 production deploy

## 7. 自定义域名与 DNS：这次到底做了什么

### 当前域名

- `topologic.hk`
- 域名注册商 / 当前 DNS 管理：阿里云

### 已在 Vercel 项目中添加的域名

- `topologic.hk`
- `www.topologic.hk`

### 当前采用的方案

没有把 nameserver 切到 Vercel，也没有迁去 Cloudflare。

选择的是更稳、更适合新手的方案：

- 保持阿里云做 DNS 托管
- 在阿里云里添加 A 记录

### 当前应存在的 DNS 记录

- `A @ 76.76.21.21`
- `A www 76.76.21.21`

### 为什么不推荐这时候切 nameserver

Vercel 当时给了两种方案：

- 加 A 记录
- 或把 nameserver 改成 `ns1.vercel-dns.com` / `ns2.vercel-dns.com`

最终没有选 nameserver 迁移，原因：

- 新手更容易误操作
- 当前场景只需要简单绑定，不需要整套 DNS 接管
- 用阿里云现有 DNS 已经足够

### 当前已确认的别名关系

`vercel alias ls` 已确认：

- `topologic.hk -> latest production deployment`
- `www.topologic.hk -> latest production deployment`

### 重要提醒

DNS 生效和 HTTPS 证书 ready 不是同一步。

常见过渡期现象：

- `dig` 已经能解析到 IP
- 但 `https://域名` 仍然暂时不稳定
- 原因通常是证书签发 / 全球缓存传播尚未完全完成

所以域名刚绑定后，如果短时间里 `https://` 还不稳，不代表配置错了。

## 8. 手机 Safari / iPhone PWA / `vercel.app` 的常见坑

这一部分非常重要，后续如果用户再说“手机不稳定”，先看这一章。

### 8.1 iPhone PWA 是按 origin 绑定的

对 iPhone 来说：

- `https://a.vercel.app`
- `https://b.vercel.app`
- `https://topologic.hk`

这是三个完全不同的 app 壳。

它们各自拥有独立的：

- service worker
- localStorage
- indexedDB
- 主屏幕安装壳

### 8.2 为什么随机 deployment URL 是坑

如果用户曾经把某个随机 deployment URL 加到主屏幕，比如：

- `nextchat-manual-baseurl-diag-177612.vercel.app`

那后来就算你又给了：

- `nextchat-manual-baseurl-diag-final.vercel.app`

用户也不一定是在同一个“App”里测试。

这会导致：

- 以为自己在测新版本
- 实际跑的是旧 origin
- 甚至旧 PWA 壳和新认知完全错位

### 8.3 正确做法

后续手机验收只允许用户这样做：

1. 删除旧的主屏幕 PWA 图标
2. 先用 Safari 直接打开固定域名
3. 确认正常后，再“添加到主屏幕”
4. 以后只从固定域名进入

### 8.4 这次关于 `vercel.app` 的真实结论

这次有过一个明显现象：

- 电脑浏览器能打开 `vercel.app`
- 手机 Safari 有时提示：
  - `couldn't establish a secure connection to the server`

对这个现象的结论是：

- 不是 `/#/chat` hash 路由导致的
- 不是页面代码本身导致的
- 更像是手机当前网络 / DNS / TLS 到 `vercel.app` 子域访问不稳定

对中国网络环境尤其要注意：

- `*.vercel.app` 子域在某些网络环境下确实可能不稳定
- 自定义域名通常更适合作为正式手机入口

### 8.5 后续原则

不要再让用户长期使用：

- 随机 deployment URL
- 临时 `vercel.app` 域名

正式入口应该是：

- 固定 alias
- 或更优先：正式自定义域名

## 9. 如何判断“这是代码 bug”还是“这是网络 / 域名 / PWA 问题”

### 更像代码 bug 的信号

- 电脑和手机都能稳定打开站点，但一进入某个页面就白屏
- 本地开发环境能稳定复现 runtime error
- 控制台有明确 JS 报错，例如：
  - `Cannot read properties of undefined`

### 更像网络 / 域名 / PWA 的信号

- 电脑正常，手机 Safari 直接连网页都打不开
- 报错是：
  - `couldn't establish a secure connection`
- 换一个 origin 后表现完全不同
- 删除 PWA 图标、改用 Safari 直开后结果变化很大

## 10. 后续接手建议

### 第一优先级

确认正式域名稳定可用：

- `https://topologic.hk`
- `https://www.topologic.hk`

等 HTTPS 证书完全 ready 后，最好只选一个做主域名，另一个跳转过去。

### 第二优先级

如果用户后面还反馈手机端异常，先排：

1. 是不是还在用旧 PWA 图标
2. 是不是还在用旧 origin
3. 是不是走第三方中转站
4. 流式是不是还开着

### 第三优先级

有空可以继续清理这些非主阻塞项：

- `apple-mobile-web-app-capable` 弃用 meta
- 表单 `id/name` issue
- 插件 schema 远程拉取失败策略
- `rt-client` 构建 warning
- `unused-imports/no-unused-imports` 在 `app/constant.ts` 的 ESLint 崩溃

## 11. 本次最重要的经验总结

### 一句话版

这次真正复杂的地方，不是 UI 本身，而是：

- 第三方 API 中转站不稳定
- 随机 Vercel 域名不适合长期手机入口
- iPhone PWA 会把不同 origin 当成完全不同的 App
- 一个小的空值处理不当，就会在手机流式场景下被放大成生产 runtime error

### 给 Claude 的最终建议

后续如果继续迭代：

- 只在固定项目上部署
- 只让用户从固定域名访问
- 不要把随机 deployment URL 继续当正式入口
- 先把“网络 / 域名 / PWA / 第三方 API”这些外层问题排掉，再怀疑 UI 代码

