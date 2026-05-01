# sing-box-conv

一个私有的 sing-box 订阅转换服务。

它以本地 `config.json` 作为模板，只重建 `outbounds` 部分。生成后的订阅接口返回纯 JSON，既可以直接给 `curl` 用，也可以给 sing-box 客户端拉取。

## 运行

首次使用建议先复制一份本地模板配置：

```bash
cp config.example.json config.json
```

`config.json` 用来放你自己的 sing-box 模板配置，默认不会提交到 git。

```bash
ADMIN_PASSWORD='change-me' npm start
```

可选环境变量：

- `PORT`：HTTP 端口，默认 `3000`
- `HOST`：绑定地址，默认 `0.0.0.0`
- `ADMIN_PASSWORD`：后台管理页密码
- `SUB_TOKEN`：固定的订阅令牌，对应 `/sub/<token>/config.json`
- `TEMPLATE_PATH`：基础 sing-box 配置路径，默认 `./config.json`；如果文件不存在，会回退到 `./config.example.json`
- `SOURCES_PATH`：保存上游订阅源的路径，默认 `./data/sources.json`

如果没有设置 `SUB_TOKEN`，程序会在首次启动时自动生成一个随机令牌，并写入 `data/token.txt`。

## 使用

1. 打开 `http://localhost:3000/`
2. 使用 `ADMIN_PASSWORD` 登录
3. 添加一个或多个上游订阅地址
4. 复制生成的订阅链接
5. 用下面的方式拉取：

```bash
curl 'http://localhost:3000/sub/<token>/config.json'
```

## 支持的分享链接

当前版本支持常见的明文或 base64 订阅内容：

- `ss://`
- `vmess://`
- `trojan://`
- `vless://`
- `hysteria2://` 和 `hy2://`
- `tuic://`

不支持或不完整的节点会被跳过，其余可用节点仍然会继续生成配置。

## 分组规则

每个上游订阅会生成一个源选择器，源内节点会按名称分到以下分组：

- 香港
- 日本
- 亚太
- 美国
- 其他

模板中 `dns`、`route` 和 `experimental` 引用的标签会继续保留为可选选择器，包括 `🚀 手动选择`、`🏠 家宽`、`📠 电报`、`🚨 Block` 和 `🔦 Google`。

## 测试

```bash
npm test
```
