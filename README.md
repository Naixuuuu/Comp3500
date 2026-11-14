# Election Management and Voting System

> COMP 3500SEF / COMP 8500SEF Software Engineering — group project (Team B)
> Node.js + Vue 3 · Node `node:sqlite` · only one runtime dependency (`express`)

## 这个项目是什么

一个可运行的**选举管理与投票系统**：选民注册在名册上，管理员开关投票期，选民凭**双因子认证**
（密码 + 一次性密码）进入，投出**一票**，拿到收据；审计员可以查看计票结果与不可篡改的审计日志。

设计上只有三个真正重要的约束，其它都是围绕它们展开的：

| 约束 | 含义 | 在代码里落在哪 |
|---|---|---|
| **一人一票 / 每场选举** | 同一选民在同一场选举中只能投一次 | `voter_roll(election_id, user_id, has_voted)` + `castBallot` 里的单个事务 |
| **选票保密** | 数据库被拖走也读不出谁投了谁 | AES-256-GCM 加密后入库；选票表**没有** `user_id` 列 |
| **可审计** | 每一次认证、投票、看结果都有记录 | `audit_log` 只插入，服务层没有 update/delete |

---

## 快速开始

需要 **Node.js ≥ 22.5**（用到内置的 `node:sqlite`）。本机实测 v24.20.0。

```bash
# 1) 装依赖
cd server && npm install
cd ../web && npm install

# 2) 构建前端（产物 web/dist 会被后端直接托管）
cd ../web && npm run build

# 3) 启动
cd ../server && npm start
```

打开 <http://localhost:3000> 即可。首次启动会自动建表并写入演示数据。

### 演示账号

密码全部是 `password123`。

| 角色 | 账号 | 能做什么 |
|---|---|---|
| Voter | `V1001` `V1002` `V1003` | 投票、查收据 |
| Presiding Officer | `O2001` | 把某个选民标记为"已投票"（纸质票路径） |
| Administrator | `A3001` | 与审计员相同 + 可看未结束选举的实时计票 |
| Auditor | `U4001` | 看结果、看审计日志 |

演示数据里有两场选举：

- **Student Union President 2026** — `open`，可以投票
- **Faculty Representative 2026** — `closed`，已经有 3 张预置选票，用来展示结果页

---

## 目录结构

```
project_election/
├── README.md                  ← 你在这里
├── docs/                      ← 五份文档（英文正文 + 中文摘要）
│   ├── 01-requirements.md        需求工程（L4）
│   ├── 02-system-modeling.md     系统建模（L5）
│   ├── 03-architecture.md        架构设计（L6）
│   ├── 04-testing.md             验证与测试（L8）
│   ├── 05-evolution.md           软件演化（L9）
│   ├── diagrams/                 8 张图的 PNG + 生成脚本 build_figures.py
│   └── screenshots/              6 张真实界面截图（由 ui-check.js 生成）
├── server/                    ← Express + node:sqlite，只有 1 个依赖
│   ├── src/
│   │   ├── config.js             端口、密钥、TTL
│   │   ├── crypto.js             密码哈希、AES-256-GCM、voterHash、收据码
│   │   ├── db.js                 建表、种子数据、事务封装
│   │   ├── errors.js             HttpError 与工厂函数
│   │   ├── middleware/auth.js    requireAuth / requireRole
│   │   ├── services/             业务规则与事务边界都在这一层
│   │   │   └── electionService.js 新建选举 / 加候选人 / 开关投票期
│   │   ├── routes/               只做 HTTP ↔ service 的转换
│   │   │   └── admin.js           管理员路由（整个 router 挂了 requireRole('admin')）
│   │   └── index.js              组装 app、托管前端产物
│   ├── test/api.test.js          17 个测试（node:test）
│   ├── test/admin.test.js        7 个测试（新建选举 / 权限 / 状态流转）
│   ├── scripts/smoke.js             黑盒发布测试
│   └── scripts/ui-check.js       用无头浏览器真实跑一遍 UI
└── web/                       ← Vue 3 + Vite，无 router
    └── src/
        ├── App.vue               登录态 + 标签页切换
        ├── api.js                唯一的 fetch 封装（token 放内存，不落 localStorage）
        └── views/                Login / Ballot / Receipt / Results / Admin / Audit
```

---

## 运行测试

```bash
cd server
npm test                 # 24 个测试（17 + 7 管理员），用内存库，跑完不留文件
```

需要对着真实服务验证时：

```bash
npm start                          # 终端 A
node scripts/smoke.js                 # 终端 B：黑盒发布测试
node scripts/ui-check.js           # 终端 B：驱动真实浏览器并截图到 docs/screenshots/
```

`ui-check.js` 会自己拉起无头 Edge，填表、登录、投票、切换审计员看结果，**任何模板错误都会让它失败** ——
这是单元测试查不到的东西。

---

## 接口一览

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/api/auth/login` | — | 第一步：验密码，发 OTP 挑战 |
| POST | `/api/auth/verify` | — | 第二步：验 OTP，发会话令牌 |
| POST | `/api/auth/logout` | 已登录 | 注销 |
| GET | `/api/auth/me` | 已登录 | 当前用户 |
| GET | `/api/elections` | 已登录 | 选举列表 |
| GET | `/api/elections/:id/ballot` | 已登录 | 候选人列表 + 是否可投 |
| POST | `/api/elections/:id/vote` | 已登录 | 投票（核心） |
| POST | `/api/elections/:id/mark-voted` | officer / admin | 纸质票路径 |
| GET | `/api/receipt/:code` | 公开 | 查收据（不泄露选项） |
| GET | `/api/admin/elections/:id` | admin | 选举详情（候选人 + 名册统计） |
| POST | `/api/admin/elections` | admin | **新建选举**（草稿状态，自动建名册） |
| POST | `/api/admin/elections/:id/candidates` | admin | **添加候选人**（仅草稿期） |
| POST | `/api/admin/elections/:id/open` | admin | **开启投票期**（草稿 → 开放） |
| POST | `/api/admin/elections/:id/close` | admin | **结束投票期**（开放 → 关闭） |
| GET | `/api/results/:id` | 已登录 | 计票结果 |
| GET | `/api/audit` | auditor / admin | 审计日志 |

---

## 几个实现上的取舍（答辩时可能被问）

**1. 为什么不用 JWT？**
不透明令牌存在 `sessions` 表里，注销就是删一行。JWT 要处理吊销和密钥轮换，对"选举"这种必须能
即时踢人的场景反而更麻烦。代价是每个请求多一次索引查询。

**2. 为什么选票表里没有 `user_id`？**
有的话，"匿名"只是口头承诺。现在存的是 `voterHash = HMAC(voterId, electionId, key)`：
能判断"这个人这场投过没有"，不能反推"这票是谁投的"。真正的"已投"判断用的是 `voter_roll`。

**3. 为什么计票要在 JS 里解密，而不是 SQL `GROUP BY`？**
选项是密文，SQL 分不了组。而且第一次写的是 `LEFT JOIN ballots ON b.election_id = c.election_id`，
**每个候选人都会拿到全部票数** —— 这个 bug 是测试抓出来的，不是靠读代码看出来的。

**4. 一人一票怎么保证？**
`castBallot` 整个函数跑在一个 `BEGIN IMMEDIATE` 事务里：重查选举状态 → 重查名册 → 加密 → 写选票 →
更新 `voter_roll` → 写审计 → 提交。加上 `ballots(election_id, voter_hash)` 的唯一索引作为第二道防线。

**5. 管理员权限为什么挂在 router 上而不是每个路由上？**

`routes/admin.js` 里是 `r.use(requireAuth, requireRole('admin'))`，这样以后有人往这个文件加路由，
**不可能忘记加守卫**。如果每条路由各写一次，忘记一次就是漏洞。

**6. 为什么开关投票期要查候选人数量？**

一场没有候选人的选举"开启"了也没有意义，选票页会是空的。所以 `open` 之前要求至少 1 个候选人，
返回 `409 no_candidates`。这是领域规则，不是技术限制。

**7. 为什么把 `users.has_voted` 改成 `voter_roll` 表？**
D1 说的是"**每场选举**各一票"。单列标志在两场选举时就是错的。这是自查发现的建模缺陷，
`04-testing.md` §4.5 有记录。

---

## 本次实现了什么 / 没实现什么

**已实现（可跑通）**

- UC2 认证（密码 + OTP）、UC3 资格检查、UC4 查看选票、UC5 投票、UC6 查收据
- UC7 开关投票期、UC10 新建选举、UC11 添加候选人 —— 管理员在 **Admin** 标签页操作
- UC8 纸质票标记（officer）、UC9 计票与查看结果、UC10 查看审计日志
- 角色隔离：voter / officer / admin / auditor 各自能做什么由 `requireRole` 决定

**仍未实现**（见 `05-evolution.md` §5.4）

- 名册编辑（目前新建选举时自动把**所有已注册用户**加入名册，无法单独增删）
- UC1 注册选民（账号靠种子数据）
- 真正的并发压力测试、阈值加密、可验证公告板

### 完整流程（无需种子数据）

1. 用 `A3001` 登录 → **Admin** 标签
2. 输入标题 → **Create election**（状态 `draft`）
3. 填候选人姓名与政党 → **Add**（可加多个；开票后锁定）
4. **Open voting session**（`draft` → `open`）
5. 用任意账号 → **Ballot** 标签 → 选中新选举 → 投票
6. 管理员 **Close voting session** → **Results** 标签看计票

状态机只允许 `draft → open → closed`，没有任何回退边。所以关闭后不可能再收到选票 ——
这是图 6 的状态图和 `VALID_TRANSITIONS` 表共同保证的。

---

## 文档阅读顺序

如果只读一份，读 `02-system-modeling.md` —— 里面有那张**发现问题**的顺序图（§2.8）。
五份文档对应课程的五个阶段：

```
L4 需求 → 01-requirements.md
L5 建模 → 02-system-modeling.md
L6 架构 → 03-architecture.md
L8 测试 → 04-testing.md
L9 演化 → 05-evolution.md
```

---

## 备注

- 密钥默认值是**硬编码的演示值**（`config.js`），生产环境必须用 `APP_KEY_HEX` 环境变量覆盖。
- 数据库文件生成在 `server/data/election.db`，删掉就重新播种。
- 前端不引入 vue-router：五个视图、一条线性流程，多一个依赖不值得。
