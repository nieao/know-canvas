# Hermes Bootstrap — 给 lichang333 的配置清单

> **目的**: 让 know-canvas 的 auto 派单从 mock 模式切到真 Hermes worker
> **谁读**: lichang333（Hermes Agent 维护者）
> **写于**: 2026-05-02 22:50 by [ui-cc]
> **预计耗时**: 15-30 分钟

---

## ⛔ 千万不要做的事 (重要!)

**不要执行 `hermes gateway start/restart/install`**.

`hermes gateway` 是 **messaging gateway** (Telegram / Discord / WhatsApp), **不是 LLM gateway**.
know-canvas 的 auto 派单 / Aletheia 拆解 / Hermes worker 跑 task **完全不依赖它**.

如果你看到这个错误:

```
⚠ Cannot restart gateway as a service — linger is not enabled.
  Run:  sudo loginctl enable-linger root
  Then restart the gateway: hermes gateway restart
```

**直接忽略**. 不要 enable-linger, 不要 restart gateway. 这跟我们的系统无关.

`/api/status` 返回 `gateway_running=false` 是正常状态 — Hermes worker 跑 task **不依赖** gateway 状态.

---

---

## 当前状态

VPS (ha2.digitalvio.shop) 上 4 个 know-canvas 服务全跑：

| systemd unit | 端口 | 状态 |
|---|---|---|
| `know-canvas-yws` | 1234 | ✓ Yjs sync |
| `know-canvas-llm-proxy` | 17082 | ✓ DeepSeek (浏览器 Aletheia 用) |
| `know-canvas-conductor` | 17083 | ✓ orchestra (现 mock) |
| `hermes-dashboard` | 9119 | ✓ Hermes 主站 |

`hermes-dashboard.service` 已经活着, 但 **没配任何 LLM 凭据**, 也 **没创建任何 worker profile**, 所以:
- `gateway_running=false` (不影响 task — gateway 是 messaging gateway, 不是 LLM gateway)
- 任何 POST 到 `/api/plugins/kanban/tasks` 的 task 永远停在 `ready` 列, 因为没人接

---

## 你要做的 3 件事

### 1️⃣ 配 LLM provider key 到 `/root/.hermes/.env`

**推荐方案 A — OpenRouter (最简单, 1 行)**:

```bash
# SSH 到 VPS
ssh root@64.176.62.85

# 在 .env 末尾加 (假设你有 OpenRouter key)
echo 'OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxx' >> /root/.hermes/.env
```

OpenRouter 默认走 `anthropic/claude-opus-4.6` (跟 hermes config.yaml `model.default` 对齐), 不用改任何配置.

**方案 B — 复用 boss 的 DeepSeek key (走 custom provider)**:

```bash
# /root/.hermes/.env 末尾加 4 行
cat >> /root/.hermes/.env << 'EOF'
LLM_PROVIDER=custom
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-8725424dd4d84ec4b3f733712ddee5f5
LLM_MODEL=deepseek-chat
EOF

# 同时 config.yaml 里把 model.default 从 anthropic/claude-opus-4.6
# 改成 deepseek-chat, model.provider 从 auto 改成 custom, base_url 改成
# https://api.deepseek.com/v1
# (改文件即可, 不要用 hermes model — 那个是 interactive 不能 SSH 跑)
sed -i 's|^  default: "anthropic/claude-opus-4.6"|  default: "deepseek-chat"|' /root/.hermes/config.yaml
sed -i 's|^  provider: "auto"|  provider: "custom"|' /root/.hermes/config.yaml
sed -i 's|^  base_url: "https://openrouter.ai/api/v1"|  base_url: "https://api.deepseek.com/v1"|' /root/.hermes/config.yaml
```

**方案 C — 你账号已有的任意 provider** (Anthropic / Gemini / GLM / Kimi 等):
看 `/root/.hermes/.env` 模板, 找到对应 provider 段, 取消注释 + 填 key. config.yaml 默认 `provider: "auto"` 会自动检测.

### 2️⃣ 创建至少 1 个 worker profile

```bash
# 写一个 profile (人格文件)
mkdir -p /root/.hermes/profiles/aletheia-worker
cat > /root/.hermes/profiles/aletheia-worker/SOUL.md << 'EOF'
# Aletheia Worker

你是 Aletheia 决策引擎的执行 agent, 负责接画布上派给你的调研 / 分析 / 反驳任务.

## 行为原则
- 收到 task 时, 仔细读 title + body 理解用户真实意图
- 输出 markdown 格式, 直接写结论, 不要前言客套
- 不确定的事项明确标 "[需 boss 确认]"
- 任何调研/数据类请求, 给出来源 (URL / 出处)
- 反驳类请求, 按 Devil's Advocate 6 角度 (资源/外部/逻辑/反例/逆向/二阶) 找最锋利的攻击

## 输出格式
- 简短结论 (3-5 句)
- 关键数据/引用 (如有)
- 不超过 500 字
EOF
```

### 3️⃣ 重启 + 验证

```bash
# 重启 hermes-dashboard 让它重读 .env + 加载 profile
systemctl restart hermes-dashboard
sleep 5

# 验证 1: hermes 状态
curl -s -u "hermes:bdegDr5w4GfIqwEFH5+ZYMYK" \
     -H "User-Agent: Mozilla/5.0 (compatible; check/0.1)" \
     https://ha2.digitalvio.shop/api/status | python3 -m json.tool

# 验证 2: profile 列表 (token-protected, 我们看不到, 你在 dashboard UI 看)
# 浏览器开 https://ha2.digitalvio.shop/ → Profiles 页 → 应该看到 aletheia-worker

# 验证 3: 派一个测试 task
curl -s -X POST -u "hermes:bdegDr5w4GfIqwEFH5+ZYMYK" \
     -H "Content-Type: application/json" \
     -H "User-Agent: Mozilla/5.0 (compatible; check/0.1)" \
     -d '{
       "title": "测试 task",
       "body": "请回复 OK 即可",
       "assignee": "aletheia-worker",
       "priority": 3,
       "idempotency_key": "test-bootstrap-001",
       "max_runtime_seconds": 60
     }' \
     https://ha2.digitalvio.shop/api/plugins/kanban/tasks

# 拿到 task id (例 t_abc12345), 几秒后查状态
TASK_ID=t_xxxxxxxx  # 替换
sleep 10
curl -s -u "hermes:bdegDr5w4GfIqwEFH5+ZYMYK" \
     -H "User-Agent: Mozilla/5.0 (compatible; check/0.1)" \
     https://ha2.digitalvio.shop/api/plugins/kanban/tasks/$TASK_ID | python3 -m json.tool
```

期望: `status` 从 `ready` → `running` → `done` (10-60 秒内). 如果 `done`, profile + LLM 都通了.

---

## 配完之后通知我 (ui-cc), 我做这 3 件事

1. **改 `know-canvas-conductor.service`** 加 HERMES_USER + HERMES_PASS 环境变量, 重启 conductor — worker 从 mock 自动切真模式
2. **改 `OntologyNode.jsx`** 让"派 Hermes →"按钮默认创建 `agentMode=auto, assignedTo=hermes` 的 TaskNode (现在是 manual)
3. **跑 Playwright E2E** 验证浏览器画 OntologyNode → 派 Hermes → 真 LLM 输出涌现 ResultNode

---

## 排错速查

| 现象 | 原因 | 解决 |
|---|---|---|
| `hermes auth` / `hermes model` 报 "requires interactive terminal" | hermes CLI 是 TUI, 不能 SSH 一行调 | 直接编辑 `/root/.hermes/.env` + `config.yaml` 文件 |
| dashboard 看不到 profile | hermes 没扫到 / 没重启 | `systemctl restart hermes-dashboard` 后等 10 秒 |
| Task 一直 `ready` 不动 | (a) 没 LLM key (b) profile 名拼错 (c) hermes 没 reload | `journalctl -u hermes-dashboard -n 50` 看错误 |
| Task `running` 后变 `failed` 带 401 | LLM provider 凭据错或没充值 | `journalctl -u hermes-dashboard -f` 实时看 worker 调用 |
| Task `running` 卡住超 5 分钟 | LLM 调用 hang / 超时太短 | task body 加 `"max_runtime_seconds": 600` |

---

## 已知坑 (CC-HANDOFF §G 黄金清单复述)

1. **反爬 UA**: 任何 HTTP 请求必须自定义 `User-Agent`, 不然 Nginx 层 403
2. **idempotency_key 必传**: 防重试创建多次
3. **profile 必须先创建**: dashboard API 是 token-protected, 自动化只能写文件系统 (`/root/.hermes/profiles/`)
4. **PowerShell 5.1 中文乱码是渲染问题, 字节是 OK 的**: 直接 SSH 写文件不会有这问题

---

## 不做也没关系 (会 graceful degrade 到当前 mock 模式)

如果 1-3 任意一步卡住, **当前 mock 模式 demo 仍然能演示**:
- 浏览器画 AUTO TaskNode → conductor 4 秒后回假 done + 假 ResultNode
- 视觉效果 100% (节点变色, 三人同步, 边连线)
- 内容是占位文本 `[mock] hermes 已模拟完成: <title>`

黑客松 demo 时可以选择只演 mock (视觉够炸), 或等你配好真 Hermes 再切.

---

**配置完成后**, 在 CC-HANDOFF.md 末尾签一行:
```
## 2026-05-02 23:XX [lichang333] Hermes 配置完成
- LLM provider: openrouter / deepseek-custom / 等
- profile: aletheia-worker
- 测试 task 真返回内容: ...
- 通知 [ui-cc]: 可以改 conductor + OntologyNode 按钮切真模式
```
