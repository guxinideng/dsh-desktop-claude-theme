# deploy/ — VPS + Mac 部署配置快照

这套配置是「手机 → VPS → SSH 反向隧道 → Mac → dsh」链路的完整部署快照，
把 VPS 和 Mac 上手工调出来的配置收进仓库，防止换机器/重装后丢失。

## 链路架构

```
手机 (大陆, Shadowrocket)
  │  https://deepseek.jiecaisongai.shop:443
  ▼
VPS 38.150.33.206 nginx stream (SNI 分流, stream-conf.d/sni-443.conf)
  │  SNI=deepseek.jiecaisongai.shop -> 127.0.0.1:4445 (vhost, TLS + HTTP/2)
  ▼
vhost: conf.d/deepseek.jiecaisongai.shop.conf
  │  静态 /assets/ 缓存 30d、/__ds_theme/ 缓存 1h、首页 HTML 缓存 60s
  │  上游 = SSH 反向隧道 127.0.0.1:8443
  ▼
SSH 反向隧道 (Mac autossh -R 127.0.0.1:8443:127.0.0.1:3090, dsh-vps 别名)
  ▼
Mac: remote-gateway.js :3090 (注入 theme/mobile.css/mobile.js, GATEWAY_TOKEN 鉴权)
  ▼
Mac: dsh 本体 :3080
```

## 文件清单

### VPS (root@38.150.33.206, 对应路径 = 仓库路径去掉 deploy/vps/)
| 仓库文件 | VPS 实际位置 | 作用 |
|---|---|---|
| `vps/nginx.conf` | `/etc/nginx/nginx.conf` | gzip、keepalive 1000、worker 调优、stream 块 |
| `vps/nginx-cache.conf` | `/etc/nginx/nginx-cache.conf` | `dsh_cache` 缓存区 (50m/200m/30d) |
| `vps/deepseek.jiecaisongai.shop.conf` | `/etc/nginx/conf.d/deepseek.jiecaisongai.shop.conf` | dsh vhost: TLS/HTTP2/缓存/preload/Link 头 |
| `vps/sni-443.conf` | `/etc/nginx/stream-conf.d/sni-443.conf` | 443 SNI 分流 (go/deepseek/xray) |
| `vps/99-dsh-tune.conf` | `/etc/sysctl.d/99-dsh-tune.conf` | TCP 大缓冲/fastopen/mtu_probing 等 |

### Mac (launchd, 对应路径 = 仓库路径去掉 deploy/mac/)
| 仓库文件 | Mac 实际位置 | 作用 |
|---|---|---|
| `mac/com.secondcomputer.dsh-remote-gateway.plist` | `~/Library/LaunchAgents/` | 启动 remote-gateway.js (:3090) |
| `mac/com.secondcomputer.dsh-remote-tunnel.plist` | `~/Library/LaunchAgents/` | autossh 反向隧道 (-C -c aes128-gcm, 保活) |
| `mac/ssh-config-dsh-vps.example` | `~/.ssh/config` 的 `Host dsh-vps` | 隧道用 SSH 别名 (密钥登录) |

## 部署/恢复步骤

VPS:
```bash
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-$(date +%Y%m%d-%H%M%S)   # 先备份
# 依次放回 5 个文件到对应路径, 然后:
nginx -t && systemctl reload nginx
sysctl --system   # 应用 99-dsh-tune.conf
```

Mac:
```bash
# 恢复 plist 后 (注意把 GATEWAY_TOKEN 改回真实值)
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.secondcomputer.dsh-remote-gateway.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.secondcomputer.dsh-remote-gateway.plist
launchctl kickstart -k gui/$(id -u)/com.secondcomputer.dsh-remote-gateway
```

## 注意事项

- **GATEWAY_TOKEN 已打码** (`CHANGE_ME`)：真实 token 只存在于 Mac 本机
  `~/Library/LaunchAgents/com.secondcomputer.dsh-remote-gateway.plist`，请勿提交真实值。
- VPS 登录用密钥 (`~/.ssh/dsh_remote_gateway_vps`)，不是密码；密码也从未进过仓库。
- `/__ds_theme/` 缓存 1h：改 mobile.js/css 后手机最多 1h 内看到新版
  （页面 URL 的 `?v=<mtime>` 会自动换号，实际立刻生效，因为 URL 变了不会命中旧缓存）。
- 想手动清 VPS 缓存：`rm -rf /var/cache/nginx/dsh/* && systemctl reload nginx`。
- SSL 必须是 Full (strict)：Flexible 会 80 端口回环死循环；CF 橙色云实测更慢，建议灰云。
