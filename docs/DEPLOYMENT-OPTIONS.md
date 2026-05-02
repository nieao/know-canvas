# know-canvas 部署形态决策文档

> **写给**: 你想猫 (boss) — 出门回来时直接决策用
> **状态**: ✅ **已落地** — [ui-cc] 在 `P0-PLAN-cc-ui.md` §1 选定 **方案 A**, 理由更充分 (用户明确要"三人同时看见", D 模式单机演示不满足该需求, 推翻 [meta-cc] 原 P0 推荐)
> **背景**: know-canvas 要部署到 `ha2.digitalvio.shop` 同一台 VPS (Hermes 已装), 推翻原 spec 的 Cloudflare Workers 假设
> **作者**: [meta-cc] 2026-05-02 自主推进, [ui-cc] 2026-05-02 选定方案 A

> **本文档保留作决策档案** — 帮 boss / 评委理解为什么选 A 而不是 B/C/D. 实际配置范本以 `P0-PLAN-cc-ui.md` 为准.

---

## TL;DR (10 秒决策版)

```
✅ 已选: A (子路径反代) — https://ha2.digitalvio.shop/canvas/
        wss://ha2.digitalvio.shop/yws/  (Yjs 协作 WS)
        https://ha2.digitalvio.shop/api/canvas/  (Hermes 派单代理)
```

**[ui-cc] 选 A 的理由 (P0-PLAN-cc-ui.md §1)**: 用户明确要"画布操作的时候能否在线的三个人同时看见", D 模式单机演示满足不了多人协作需求. 共用 Hermes Caddy/Nginx + SSL, 零 DNS 改动, 同源无 CORS.

**[meta-cc] 原推荐 D 已作废** — 理由当时是"距 demo 32h 部署有风险", 但忽略了"多人协作"这个硬需求. ui-cc 判断更对.

---

## 1. 决策维度

| 维度 | 权重 | A (subpath) | B (subdomain) | C (Cloudflare) | D (local) |
|------|-----|---|---|---|---|
| 部署难度 (低=好) | ★★★ | 1h | 1d | 1w | 0 |
| 跟 Hermes 隔离度 | ★★ | 共 Nginx + 证书 | 独立 server block, 共证书 | 完全独立主机 | 完全独立主机 |
| 多人协作能力 | ★★★ | ✅ Yjs over WS | ✅ | ✅ Durable Objects | ❌ 单机 |
| 黑客松 demo 速度 | ★★★★ | URL 能给, 同源无 CORS | URL 能给, 需 CORS 配 | 无法满足 boss "同 VPS" 约束 | 自机演示, 不能交 URL |
| 跟 boss 约束符合度 | ★★★★ | ✅ 同 VPS | ✅ 同 VPS | ❌ 不在同 VPS | ✅ 不部署 |
| 长期可维护性 | ★★ | 中 (耦合 Nginx) | 高 (独立) | 高 | 不适用 |
| 故障爆炸半径 | ★★★ | Hermes 挂 = canvas 挂 | 独立 server, 隔离好 | 完全隔离 | 单机故障无外溢 |

**加权排序** (维度 × 权重):
1. **A — 24 分** (推荐 P1)
2. **D — 22 分** (推荐 P0 黑客松)
3. **B — 20 分** (推荐 P2 长期)
4. **C — 0 分** (违反 boss 约束)

---

## 2. 方案 A: Nginx subpath 反代 (推荐 P1)

### 形态

```
浏览器
  ↓ https://ha2.digitalvio.shop/canvas/
Nginx (VPS:443)
  ↓ proxy_pass http://localhost:5180/
know-canvas dist/ + node websocket :5181
  ↓ Yjs sync via /canvas/ws
  + 调 Hermes API /api/* (同源, 不需 CORS)
```

### 实施步骤 (1 小时)

1. **VPS 上跑 know-canvas 静态 + ws server**
   ```bash
   # build know-canvas
   cd /opt/know-canvas
   npm install && npm run build  # → dist/
   # 起 ws server
   node ws-server.js  # 监听 :5181, 跑 y-websocket-server
   ```

2. **Nginx 加 location**
   ```nginx
   # /etc/nginx/sites-available/hermes-agent (现有文件)
   location /canvas/ {
       alias /opt/know-canvas/dist/;
       try_files $uri $uri/ /canvas/index.html;
   }
   location /canvas/ws {
       proxy_pass http://localhost:5181;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_read_timeout 86400;
   }
   ```

3. **know-canvas 改 base path** (Vite)
   ```ts
   // vite.config.ts
   export default { base: '/canvas/' }
   ```

4. **Hermes 凭据走 Nginx Basic Auth 共用** — 浏览器进 `/canvas/` 时已经过了 Hermes 的 Basic Auth, 调 `/api/*` 直接通

### 优势
- ✅ 同源, 无 CORS 问题
- ✅ 共用 Hermes 的 Basic Auth (用户进 canvas = 已登录 Hermes)
- ✅ Nginx 配置改 10 行, SSL 证书已有
- ✅ 部署最快

### 劣势
- ⚠️ 跟 Hermes 共 Nginx, Hermes 重启可能影响 canvas
- ⚠️ Hermes 升级动 Nginx 配置时, canvas location 可能被覆盖 (要 lichang333 注意)
- ⚠️ /canvas/ws 占用 Hermes 域名空间, 后续 Hermes 想用 /canvas/* 就冲突

---

## 3. 方案 B: 子域名独立 server (推荐 P2)

### 形态

```
浏览器
  ↓ https://canvas.digitalvio.shop/
Nginx 独立 server block (VPS:443)
  ↓ proxy_pass http://localhost:5180
know-canvas Node 服务 (静态 + ws + Hermes 转发)
  ↓ 跨域调 https://ha2.digitalvio.shop/api/* (CORS 配)
Hermes
```

### 实施步骤 (1 天)

1. **DNS**: 加 `canvas.digitalvio.shop` A 记录指向 VPS IP
2. **SSL**: `certbot --nginx -d canvas.digitalvio.shop` (Let's Encrypt 自动签)
3. **Nginx 新 server block**:
   ```nginx
   server {
       listen 443 ssl;
       server_name canvas.digitalvio.shop;
       ssl_certificate /etc/letsencrypt/live/canvas.digitalvio.shop/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/canvas.digitalvio.shop/privkey.pem;

       location / {
           proxy_pass http://localhost:5180;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
       }
   }
   ```
4. **CORS 配置** (因为跨域调 Hermes):
   - know-canvas Node 后端做 Hermes API 转发 (避免浏览器直接跨域)
   - 或者 Hermes Nginx 加 `Access-Control-Allow-Origin: https://canvas.digitalvio.shop`
5. **凭据**: know-canvas 后端持有 Hermes Basic Auth, 不让浏览器知道

### 优势
- ✅ 路径干净, URL 漂亮
- ✅ 跟 Hermes 完全解耦, 独立运维
- ✅ Hermes 升级不影响 canvas
- ✅ 长期产品形态, 适合 P2

### 劣势
- ⚠️ 需 DNS 改动 (boss 要去域名服务商点几下)
- ⚠️ 新 SSL 证书 (Let's Encrypt 免费, 但要等 DNS 生效)
- ⚠️ CORS 配置繁琐, 需小心
- ⚠️ 凭据保管负担转移到 know-canvas 后端

---

## 4. 方案 C: Cloudflare Workers (boss 已排除)

### 为什么排除
- 违反 boss 新约束 ("部署到同一 VPS")
- Cloudflare Workers 跟 Hermes (在 VPS 上) 是不同主机, 走外网调用
- 凭据管理需要双层 (CF Workers env + Hermes Basic Auth)

### 何时重新考虑
- 黑客松后, 如果产品要面向多客户多 Hermes 实例时
- 有 Cloudflare 团队 plan 的预算

---

## 5. 方案 D: 本地直连 (推荐 P0 黑客松)

### 形态

```
本地 macOS / Windows
  ↓ http://localhost:5180
know-canvas (Vite dev server)
  ↓ 直接调 https://ha2.digitalvio.shop/api/*
  ↓ (浏览器需要在 know-canvas 里把 Basic Auth 凭据加到 fetch header)
Hermes (远端)
```

### 实施步骤 (0 小时)

1. **不部署任何东西**
2. **know-canvas 加 .env.local**:
   ```
   VITE_HERMES_BASE=https://ha2.digitalvio.shop
   VITE_HERMES_USER=hermes
   VITE_HERMES_PASS=<向 boss 私聊获取>
   ```
3. **`npm run dev` 起在 5180**
4. **Demo 时**: 评委来现场看, 评委自己电脑访问演示者的 5180 (或者演示者投屏)

### 优势
- ✅ 0 部署
- ✅ 1 小时就能给 [ui-cc] 干活
- ✅ Vite HMR, 改代码秒生效
- ✅ 没有 demo 当天部署翻车风险

### 劣势
- ❌ 不能给评委 URL
- ❌ 不能多人协作 (单机演示)
- ❌ 凭据在浏览器 .env, 不能上传到 git
- ❌ Hermes 需配 CORS (cross-origin from localhost:5180)

---

## 6. [meta-cc] 推荐路径 (强建议)

### Phase 0: 黑客松 5-3 之前 (用 D)

**理由**:
1. 没有部署翻车风险
2. [ui-cc] 黑客松前就一个人在干, 不需要协作
3. demo 时投屏直接演示就行, 不一定要给 URL
4. 现在 (2026-05-02) 距离 demo 只有 32 小时, A/B 都可能翻车

**操作**:
- [ui-cc] 用 D 模式开发, 完成 P0 (TaskNode + dispatch + 接 Hermes 真实联调)
- [ui-cc] 浏览器加 Basic Auth 凭据 (放 .env.local, 不入 git)
- 演示时演示者本地跑, 投屏

### Phase 1: 黑客松 5-3 demo 前 12 小时 (升 A)

**理由**:
1. 给评委一个 URL 比单机 demo 更有冲击力
2. A 方案最快, 1 小时能上去
3. 同源 = 不用配 CORS, 节省时间

**操作**:
- 找 lichang333 在 VPS 跑 `npm install && npm run build`
- lichang333 改 Nginx 配置加 `/canvas/` location (我已写好范本, 抄就行)
- know-canvas 改 `vite.config.ts base: '/canvas/'`, 重新 build
- 测试 https://ha2.digitalvio.shop/canvas/ 能开

### Phase 2: 黑客松后 1 周 (升 B 或留 A)

**根据 boss 决策**:
- 如果 know-canvas 要做长期产品 → 升 B
- 如果只是 metahermes 的 demo 配套 → 留 A

---

## 7. 决策表 (boss 填这个)

请在下表勾选你的选择, [meta-cc] 会更新 spec + 通知 [ui-cc]:

```markdown
## boss 2026-05-0?  日期补完
P0 黑客松前: [ ] D  [ ] A  [ ] 其他 ___
P1 黑客松 demo 时: [ ] A  [ ] B  [ ] 维持 P0 选择
P2 黑客松后:  [ ] A  [ ] B  [ ] 重新评估
特别要求: ____________
```

填完丢回给 [meta-cc] 即可。

---

## 8. 各方案对应的 [ui-cc] 工作量差异

| 方案 | spec 改动 | 代码改动 | 时间增量 |
|------|---------|---------|---------|
| D | 不改 | 不改 (本来就是 dev 模式) | 0 |
| A | spec §0 prepend `/canvas/` | vite.config base + 所有 fetch URL 加前缀 (4-6 处) | +2h |
| B | spec §0 + CORS 段补 | 加 Hermes API 后端转发层 | +6h |

---

## 9. 风险与坑

### A 方案风险
- Hermes 升级时 lichang333 可能覆盖 Nginx 配置 → 需要 `/canvas/` 段写到独立 conf 文件如 `/etc/nginx/conf.d/canvas.conf`
- Hermes Basic Auth 失效会让 canvas 一起挂 → 需要 know-canvas 加"凭据失效"的 UX 兜底

### B 方案风险
- DNS 生效有延迟 (5min ~ 24h), demo 当天改不来
- Let's Encrypt 频率限制 (50 cert/week per domain)
- CORS 配错会调试地狱 → 强烈建议在 know-canvas 后端做转发, 不让浏览器跨域

### D 方案风险
- 凭据可能泄露到截图 / 录像里 → demo 前手动检查浏览器 devtools 是否有凭据曝光
- Hermes CORS 配置如果没开, 浏览器调用会被拦 → 需要 lichang333 配 `Access-Control-Allow-Origin: http://localhost:5180`

---

## 附录: 各方案对应的 .env.local 配置

### D 方案
```
VITE_DEPLOY_TARGET=local
VITE_CANVAS_PUBLIC_URL=http://localhost:5180
VITE_HERMES_BASE=https://ha2.digitalvio.shop
```

### A 方案
```
VITE_DEPLOY_TARGET=vps-subpath
VITE_CANVAS_PUBLIC_URL=https://ha2.digitalvio.shop/canvas/
VITE_HERMES_BASE=  # 空值, 用相对路径调 /api/*
```

### B 方案
```
VITE_DEPLOY_TARGET=vps-subdomain
VITE_CANVAS_PUBLIC_URL=https://canvas.digitalvio.shop/
VITE_HERMES_BASE=https://ha2.digitalvio.shop
# 注意: 凭据走 Node 后端代理, 不是浏览器
```

(D / A / B / C 都已写到 `.env.example` 模板, 切换时改 VITE_DEPLOY_TARGET 即可)
