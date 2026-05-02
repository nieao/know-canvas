# GitHub Actions 自动部署 — 一次性配置指南

> **配完之后**: 任何人 push 到 `main` 分支 → GitHub Actions 自动 SSH 到 VPS → git pull + build + 重启 → 1-2 分钟内上线
> **谁配**: lichang333 配 VPS 一次 + boss 配 GitHub Secrets 一次, **总共 5 分钟**

---

## 第一步: 在 VPS 上加 deploy 用的 SSH 公钥

ssh 上 VPS (lichang333 自己的方式, 我们 [meta-cc] 上不去):

```bash
ssh root@64.176.62.85
```

把下面整段公钥追加到 `/root/.ssh/authorized_keys`:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINm+ZFZc99HRra9uR84nwwkZdr4h2Ax8oO5L/E8QaTNh nieao@hermes-agent-hackathon-2026-05-02
```

一行命令搞定:

```bash
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINm+ZFZc99HRra9uR84nwwkZdr4h2Ax8oO5L/E8QaTNh nieao@hermes-agent-hackathon-2026-05-02" | sudo tee -a /root/.ssh/authorized_keys
sudo chmod 600 /root/.ssh/authorized_keys
sudo chmod 700 /root/.ssh
```

(可选) 验证 GitHub Actions 出口 IP 不被 fail2ban ban:

```bash
sudo fail2ban-client status sshd
```

如果有大量 banned IP, 暂时禁用 fail2ban 让首次部署通过:

```bash
sudo systemctl stop fail2ban
# 部署成功后再开
sudo systemctl start fail2ban
```

---

## 第二步: 把 SSH 私钥配成 GitHub Secret

### 2.1 拿到私钥内容

从 [meta-cc] 的本地机 (boss 你想猫的电脑) 拿:

```bash
cat ~/.ssh/hermes_agent_vps
```

会输出类似:

```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ...
... 多行 base64 ...
-----END OPENSSH PRIVATE KEY-----
```

**整段复制** (包括 BEGIN / END 行).

### 2.2 配 GitHub Secret

打开浏览器:

`https://github.com/nieao/know-canvas/settings/secrets/actions`

(如果没看到 settings, 说明账号不是仓库 owner — 需要 nieao 自己操作)

点 **"New repository secret"**, 加 3 个:

| Secret 名 | 值 | 说明 |
|----------|---|------|
| `DEPLOY_SSH_KEY` | 上面 cat 的私钥**整段** (含 BEGIN/END 行) | SSH 私钥 |
| `DEPLOY_HOST` | `64.176.62.85` | VPS IP (或域名 `ha2.digitalvio.shop` 也行) |
| `DEPLOY_USER` | `root` | SSH 用户名 (新建 deploy 用户的话改这个) |

(可选) 第 4 个:

| `DEPLOY_PORT` | `22` | SSH 端口 — 默认 22, 不用配 |

---

## 第三步: 触发首次部署

### 方式 A: 手动触发 (推荐第一次)

`https://github.com/nieao/know-canvas/actions/workflows/deploy.yml`

点 **"Run workflow"** → Branch `main` → **"Run workflow"** 按钮.

约 1-3 分钟跑完, 看绿色勾就是成功. 如果红色叉, 点进去看哪一步失败.

### 方式 B: 推一个 commit 测试

```bash
cd "/e/claude code/know-canvas"
git commit --allow-empty -m "trigger first deploy"
git push origin main
```

GitHub Actions 自动跑.

---

## 第四步: 一次性 Caddy 配置 (无法自动化)

**重要**: 部署脚本不会自动改 `/etc/caddy/Caddyfile` (避免破坏 Hermes 现有配置). 第一次部署后必须手动追加.

ssh 上 VPS:

```bash
sudo nano /etc/caddy/Caddyfile
```

找到 `ha2.digitalvio.shop {` 这一段, 在它的 `}` 之前插入:

```caddy
    # Know Canvas 前端 (静态文件)
    handle_path /canvas/* {
        root * /var/www/know-canvas
        try_files {path} /index.html
        file_server
    }

    # Yjs WebSocket 反代
    handle_path /yws/* {
        reverse_proxy localhost:1234 {
            header_up Host {host}
            header_up X-Real-IP {remote}
        }
    }
```

应用:

```bash
sudo caddy validate /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

验证:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ha2.digitalvio.shop/canvas/
# 期望: 200
```

---

## 配置完成后的工作流

**[meta-cc] / [ui-cc] / boss 任何人**:

```bash
git push origin main          # → GitHub Actions 自动部署
```

**1-2 分钟内**: VPS 上的 `/var/www/know-canvas/` 自动更新, 浏览器刷新 https://ha2.digitalvio.shop/canvas/ 看到最新版本.

**手动触发** (不 push 也能部署, 比如想 redeploy 一次):

`https://github.com/nieao/know-canvas/actions/workflows/deploy.yml` → Run workflow.

---

## 故障排查

### Actions 显示 "Permission denied (publickey)"

公钥没加到 VPS authorized_keys, 或路径错了. 在 VPS 上:

```bash
sudo cat /root/.ssh/authorized_keys | grep nieao
# 应该看到完整的一行 ssh-ed25519 AAAA... nieao@hermes-agent-hackathon-2026-05-02
```

### Actions 显示 "Connection closed by remote host"

VPS 的 fail2ban 把 GitHub runner IP ban 了. 解决:

```bash
sudo fail2ban-client status sshd            # 看 banned IP
sudo fail2ban-client set sshd unbanip <IP>
```

或者临时禁用:

```bash
sudo systemctl stop fail2ban
# 跑完部署再
sudo systemctl start fail2ban
```

### Actions 显示 "git pull 失败" (合并冲突)

VPS 上 /opt/know-canvas 有未提交改动:

```bash
cd /opt/know-canvas
git status                    # 看哪些文件改了
git stash                     # 暂存掉
# 或 git reset --hard origin/main (慎用, 丢失本地改动)
```

### Actions 部署成功但 https://ha2.digitalvio.shop/canvas/ 返回 404

Caddy 还没追加 `/canvas/*` 段. 见上面"第四步".

---

## 高级: 用专门的 deploy 用户 (更安全)

避免给 GitHub Actions root 权限, 在 VPS 上:

```bash
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /home/deploy/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINm+ZFZc99HRra9uR84nwwkZdr4h2Ax8oO5L/E8QaTNh nieao@hermes-agent-hackathon-2026-05-02" | sudo tee /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chmod 700 /home/deploy/.ssh
sudo chown -R deploy:deploy /home/deploy/.ssh

# deploy 用户能 sudo 跑哪些命令 (最小权限原则)
sudo tee /etc/sudoers.d/deploy-know-canvas <<'EOF'
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart know-canvas-yws
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload caddy
deploy ALL=(ALL) NOPASSWD: /bin/bash /opt/know-canvas/deploy/deploy-on-vps.sh
deploy ALL=(ALL) NOPASSWD: /usr/bin/cp -r /opt/know-canvas/dist /var/www/
EOF
sudo chmod 440 /etc/sudoers.d/deploy-know-canvas

# /opt/know-canvas 给 deploy 写权限
sudo chown -R deploy:deploy /opt/know-canvas
sudo chown -R deploy:deploy /var/www/know-canvas 2>/dev/null || true
```

然后把 GitHub Secret `DEPLOY_USER` 改成 `deploy`.

---

## 关于私钥安全

私钥 `~/.ssh/hermes_agent_vps` **永远不入 git**:

- ✅ 它**只**作为 GitHub Secret 存在 (加密存储, GitHub 内部都看不到)
- ✅ 用完会自动 rm (workflow 末尾 `cleanup` step)
- ❌ 不写到任何文件 / 注释 / 日志里
- ❌ 不发到 Slack / 邮件 / 群聊

如果担心泄露, 任何时候都可以重新生成一对 key:

```bash
# 本机
ssh-keygen -t ed25519 -f ~/.ssh/hermes_agent_vps_v2 -N ""
# 把 .pub 加到 VPS authorized_keys, .pub 旧的删掉
# GitHub Secret DEPLOY_SSH_KEY 换成新私钥内容
```

---

## 配置好后效果预览

```
boss / cc 任何人:
  git push origin main
        ↓ (1 秒内)
  GitHub Actions 触发
        ↓ (10 秒装 SSH key)
  ssh root@64.176.62.85
        ↓ (~30 秒 git pull + npm install + build)
  systemctl restart know-canvas-yws
        ↓ (5 秒 health check)
  完成 ✓ 通知 boss
```

总耗时约 **1-2 分钟**. 期间 yws 重启会让所有协作用户**短暂断开** (Yjs 自动重连, 不丢数据).
