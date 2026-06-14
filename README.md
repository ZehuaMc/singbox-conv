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
- `SUBSCRIPTION_CACHE_DIR`：保存已拉取上游订阅内容的目录，默认 `./data/subscription-cache`；上游拉取失败时会使用同 URL 上次成功拉取的缓存

如果没有设置 `SUB_TOKEN`，程序会在首次启动时自动生成一个随机令牌，并写入 `data/token.txt`。

## 服务器部署

下面示例以 Debian/Ubuntu 服务器为例，默认把服务部署到 `/opt/sing-box-conv`，用 systemd 常驻运行，并可选通过 Nginx 反向代理到公网域名。命令里的域名、密码和令牌请替换成你自己的值。

### 1. 准备运行环境

安装 Node.js 20 或更新版本、Git 和 Nginx：

```bash
sudo apt update
sudo apt install -y git curl nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

如果服务器已经有 Node.js 20+，可以跳过 NodeSource 安装步骤。

### 2. 克隆项目

```bash
sudo mkdir -p /opt/sing-box-conv
sudo chown "$USER:$USER" /opt/sing-box-conv
git clone git@github.com:ZehuaMc/singbox-conv.git /opt/sing-box-conv
cd /opt/sing-box-conv
```

当前项目没有生产依赖，克隆后可以直接运行。以后如果 `package.json` 增加了 `dependencies`，部署时再执行：

```bash
npm install --omit=dev
```

### 3. 准备配置和环境变量

复制模板配置，并按需修改你的 sing-box 基础配置：

```bash
cd /opt/sing-box-conv
cp config.example.json config.json
nano config.json
```

创建 systemd 使用的环境变量文件：

```bash
sudo tee /etc/sing-box-conv.env >/dev/null <<'EOF'
HOST=127.0.0.1
PORT=3000
ADMIN_PASSWORD=change-this-admin-password
SUB_TOKEN=change-this-subscription-token
EOF
sudo chmod 600 /etc/sing-box-conv.env
```

建议在服务器上显式设置 `SUB_TOKEN`，这样重建 `data/` 或迁移服务器后订阅地址不会变化。如果不设置，程序会自动生成令牌并保存到 `data/token.txt`。

### 4. 配置 systemd 服务

创建 `/etc/systemd/system/sing-box-conv.service`：

```bash
sudo tee /etc/systemd/system/sing-box-conv.service >/dev/null <<'EOF'
[Unit]
Description=sing-box-conv subscription converter
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/sing-box-conv
EnvironmentFile=/etc/sing-box-conv.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
User=singboxconv
Group=singboxconv

[Install]
WantedBy=multi-user.target
EOF
```

创建服务用户，把项目目录交给该用户，然后启动服务：

```bash
sudo useradd --system --home /opt/sing-box-conv --shell /usr/sbin/nologin singboxconv
sudo chown -R singboxconv:singboxconv /opt/sing-box-conv
sudo systemctl daemon-reload
sudo systemctl enable --now sing-box-conv
sudo systemctl status sing-box-conv
```

本机检查：

```bash
curl http://127.0.0.1:3000/healthz
```

返回 `{"ok":true}` 说明服务已经启动。

### 5. 可选：配置 Nginx 反向代理

如果要通过域名访问，例如 `https://sub.example.com`，可以让 Node 服务只监听 `127.0.0.1:3000`，再用 Nginx 对外提供 HTTPS。

创建 Nginx 站点配置：

```bash
sudo tee /etc/nginx/sites-available/sing-box-conv >/dev/null <<'EOF'
server {
    listen 80;
    server_name sub.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/sing-box-conv /etc/nginx/sites-enabled/sing-box-conv
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS 可以用 Certbot 配置：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sub.example.com
```

然后访问：

- 管理页：`https://sub.example.com/`
- 订阅地址：`https://sub.example.com/sub/<SUB_TOKEN>/config.json`

### 6. 更新部署

```bash
cd /opt/sing-box-conv
git pull
sudo chown -R singboxconv:singboxconv /opt/sing-box-conv
sudo systemctl restart sing-box-conv
sudo journalctl -u sing-box-conv -n 100 --no-pager
```

## 使用

1. 打开 `http://localhost:3000/`
2. 使用 `ADMIN_PASSWORD` 登录
3. 添加一个或多个上游订阅地址
4. 按需添加手动出站
5. 复制生成的订阅链接
6. 用下面的方式拉取：

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

每个上游订阅的节点会按名称分为 `香港`、`日本`、`其他` 三类，并只生成地区选择器，标签格式为 `订阅名 / 地区`，例如 `机场A / 日本`。美国、亚太等节点会归入 `其他`，不会再额外生成订阅源总选择器或跨订阅总选择器。

每个订阅源可以设置两条节点正则过滤。过滤会在解析上游订阅之后、生成最终节点标签之前执行，匹配目标是原始节点名称；留空表示跳过对应步骤。系统会先应用“保留匹配正则”，只留下匹配的节点；再应用“移除匹配正则”，删除匹配的节点。普通写法会按大小写不敏感匹配，例如 `香港|日本`；也可以使用 JavaScript 正则字面量，例如 `/hk|jp/i`。

手动出站需要填写完整的 sing-box outbound JSON，并至少包含 `type` 和 `tag`。启用的手动出站会直接加入 `🚀 手动选择` 的候选，和 `订阅名 / 地区` 分组同层。默认生成配置时，每个手动出站都会自动生成一个独立 selector，标签格式为 `🧭 手动出站名 Detour`，并把该手动出站的 `detour` 指向它；在 sing-box 配置里通过这个 selector 选择 `订阅名 / 地区` 分组、直连手动出站或 `direct-out`。如果在网页勾选“直连”，该手动出站不会生成或使用自己的 Detour selector，并且会作为其他手动出站 Detour selector 的候选节点。

模板中 `dns`、`route` 和 `experimental` 引用的标签会继续保留为可选选择器，包括 `🚀 手动选择`、`🏠 家宽`、`📠 电报`、`🚨 Block` 和 `🔦 Google`。

## 测试

```bash
npm test
```
