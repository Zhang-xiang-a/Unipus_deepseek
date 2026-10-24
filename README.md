# 大学英语 1–4 通用的 U 校园浏览器运行器

一个基于 Playwright + DeepSeek 网页的**本地课程辅助工具**：复用你自己的 Edge 登录状态，读取课程目录里标为必修的任务，把页面截图和控件清单发给 DeepSeek，按它返回的 JSON 操作计划在页面上填写，并核验提交结果。

它不是刷课成品，也不承诺任何分数。它的定位是：把重复的“打开任务 → 抄答案 → 点提交”流程变得省事，同时把每一步都留在你自己的浏览器会话里，可随时暂停、停止、从任意任务续跑。

课程差异全部收敛在配置文件里。**大学英语 1、2、3、4 四门课共用同一套代码，切换课程只改 `config.json`。**

---

## 1. 课程范围

| 分组 | 课程 | 需要填写 |
|---|---|---|
| `course1` | 大学英语 1 | 课程 ID（`courseId`） |
| `course2` | 大学英语 2 | 课程 ID |
| `course3` | 大学英语 3 | 课程 ID |
| `course4` | 大学英语 4 | 课程 ID |

四门课的配置结构完全一致，都包含：课程 ID、章节入口 URL、单元数量、提交按钮文案、手动任务清单、听力关键词、题型识别规则。默认按“大学英语 1–4 / 新视野大学英语（第四版）读写教程 1–4”填写，教材名只用于提示词，不影响运行逻辑。

平台页面文案或域名变化时，改配置即可，不需要动代码：

- 提交按钮叫法不同 → `submitTexts`
- 课程 / 登录域名不同 → `login.courseHosts`、`login.ssoHost`
- 弹窗、答题小结、词汇卡片按钮文案不同 → `uiTexts`
- 题型识别关键词不同 → `typeRules`
- 单元数不是 6 → `unitCount`

字段逐项说明见 [docs/CONFIG.md](docs/CONFIG.md)。

---

## 2. 工作原理

1. **复用登录**：`npm run browser` 用独立的 Edge 用户目录（`browser-profile/`）启动浏览器，监听本机 `127.0.0.1:9228`。你在这里登录课程平台和 DeepSeek，脚本通过 CDP 连上去操作，不保存账号密码。
2. **采集必修清单**：`npm run crawl` 逐单元读取目录里带“必修”标记的任务，保存任务路径、题干和控件快照，不答题、不提交。
3. **生成操作计划**：答题时截取课程主内容区，连同控件清单发给 DeepSeek 网页，要求返回带 nonce 的受限 JSON（`actions` 数组，最多 64 个动作）。JSON 会做结构、控件 ID、链接域名三重校验。
4. **执行与核验**：按计划点击 / 填写 / 选择 / 拖拽，动作之间带随机等待；提交后等待“答题小结”出现才算成功。单个任务失败会记录原因并继续下一个，控制类错误（停止命令、登录失效、标签关闭）则立即中断。

学习类任务不走 DeepSeek：视频静音正常播放到结束，阅读停留 10 秒（暂停不计时），词汇卡片逐张点“下一个”。

---

## 3. 环境依赖

- **Windows 10/11**（脚本按 Windows 路径与 Edge 安装位置编写）
- **Node.js ≥ 20**（开发与验证使用 Node 24）
- **Microsoft Edge**（脚本会按常见安装路径查找 `msedge.exe`）
- **Playwright**（`npm install` 自动安装，`^1.56.0`）
- 可正常访问的 U 校园账号与 DeepSeek 网页账号

无需安装 Python、数据库或额外浏览器。

---

## 4. 安装

```powershell
git clone <本仓库地址>
cd unipus-runner
npm install
Copy-Item config.example.json config.json
```

然后编辑 `config.json`，把目标课程的 `courseId` 填进去（见下一节）。

先运行一次语法检查和测试，确认环境正常：

```powershell
npm run check
npm test
```

---

## 5. 配置

### 5.1 复制模板

`config.example.json` 里四门课都是占位符（`<COURSE_ID_1>` 等），可以直接公开。实际使用的 `config.json` 已被 `.gitignore` 排除。

### 5.2 找到课程 ID

1. 在浏览器登录 U 校园，进入目标课程的学习页。
2. 地址栏形如 `https://uai.unipus.cn/app/cmgt/resource-detail/12345678901`。
3. 最后那串数字就是 `courseId`，填进对应分组：

```json
{
  "activeCourse": "course3",
  "courses": {
    "course3": {
      "label": "大学英语 3",
      "textbook": "新视野大学英语（第四版）读写教程 3",
      "courseId": "12345678901",
      "courseUrl": "https://uai.unipus.cn/app/cmgt/resource-detail/{courseId}",
      "unitCount": 6
    }
  }
}
```

`courseUrl` 里的 `{courseId}` 会自动替换，不用手改。

### 5.3 切换课程

三选一：

```powershell
# 改 config.json 的 activeCourse
# 或命令行
npm start -- --course course2
# 或环境变量
$env:UNIPUS_PROFILE = 'course4'; npm start
```

不确定哪门课填好了，运行：

```powershell
npm run courses
```

四门课的采集数据、答题进度、日志分别存放在 `artifacts/course1/` ~ `artifacts/course4/`，互不覆盖。**新课程第一次使用必须重新跑一次 `npm run crawl`**，否则队列还是旧课程的。

### 5.4 常用配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `dryRun` | `true` | 只预览，不填写、不提交。确认流程无误后再改成 `false` 或加 `--execute`。 |
| `incorrectChoiceRate` | `0.01` | 单选题改选其他有效选项的概率；设为 `0` 表示完全照模型答案。判断题不参与。 |
| `throttle.actionDelayMs` | `[1800, 4500]` | 点击 / 拖拽 / 切页签之间的随机等待（毫秒）。 |
| `throttle.fillDelayMs` | `[250, 600]` | 文本填写、下拉选择之间的随机等待。 |
| `network.retries` | `2` | 连接浏览器、打开页面失败时的重试次数。 |
| `answerLoop.maxStallRounds` | `3` | 连续无进展多少轮后判定卡住。 |
| `answerLoop.maxRoundsPerTask` | `12` | 单个任务最多问多少轮。 |
| `runnerPolicy.taskFailure` | `continue` | 单任务出错后继续；改成 `stop` 恢复整体中断。 |
| `learningPolicy.readingSeconds` | `10` | 阅读停留秒数。 |
| `uiTexts` | 见模板 | 页面文案；平台改版时优先改这里。 |

完整字段表、环境变量、`typeRules` 识别规则见 [docs/CONFIG.md](docs/CONFIG.md)。

### 5.5 敏感信息

- 账号、密码、cookie、token **一律不写进配置文件**，登录由专用 Edge 窗口完成。
- 登录态只保存在本机 `browser-profile/`，已被 `.gitignore` 排除。
- `artifacts/` 含课程题干、截图和 DeepSeek 对话，`logs/` 含运行记录，同样不要提交或打包分享。
- `config.example.json` 不含任何真实课程 ID 或凭据。

---

## 6. 使用

### 6.1 首次运行

```powershell
npm run browser     # 打开专用 Edge，登录课程平台和 DeepSeek
npm run setup       # 自动检测登录状态并保存会话
npm run courses     # 确认目标课程已填写
npm run crawl       # 采集必修任务清单（不答题、不提交）
npm run inventory   # 生成题型报告
npm run list -- --unit 1 --skip-banked-cloze   # 查看队列
npm start -- --unit 1 --skip-banked-cloze      # 预览：只生成计划，不执行
```

`npm run setup` 会一直等你在浏览器里完成登录，检测到课程页和 DeepSeek 都就绪后自动保存，不需要回终端按回车。

### 6.2 正式答题

```powershell
npm start -- --answer --execute --unit 1 --skip-banked-cloze --text-only --steps 100
```

- `--answer`：走答题队列
- `--execute`：真正填写和提交（去掉就是预览）
- `--text-only`：不上传截图，只发文本和控件（更快；首次建议先带截图跑一遍确认）
- `--steps`：本次最多执行多少步

### 6.3 从指定任务继续

先看队列序号：

```powershell
npm run list -- --course course3 --unit 3 --skip-banked-cloze
```

再从第 12 个任务开始，或按路径片段开始：

```powershell
npm start -- --answer --execute --course course3 --unit 3 --skip-banked-cloze --text-only --from 12
npm start -- --answer --execute --course course3 --unit 3 --skip-banked-cloze --text-only --from "Section C/Translation/Task 1"
```

`--from` 只决定起点，不覆盖已有状态；要让之前跳过的任务重新执行，加 `--retry-skipped`。

### 6.4 暂停、恢复、停止、跳过

另开一个 PowerShell 窗口：

```powershell
npm run pause
npm run resume
npm run stop
npm run skip
```

暂停会阻止后续动作，已发出的单次点击无法撤回。`stop` 之后重新运行前先执行 `npm run resume`。

### 6.5 核验课程侧状态

```powershell
npm run verify -- --unit 3 --skip-banked-cloze --tasks 33,35,39
npm run audit -- 3 --skip-banked-cloze
```

`verify` 复用原课件标签重新加载，读取页面正常请求的课程进度响应，按任务 URL 末端 ID 逐项核对，报告写入 `artifacts/<courseKey>/task-verification.json`。它不答题、不提交。

全部命令与参数见 [docs/COMMANDS.md](docs/COMMANDS.md)。

---

## 7. 目录结构

```
unipus-runner/
├─ config.example.json     # 四门课模板（占位符，可公开）
├─ config.json             # 你的本地配置（gitignore）
├─ package.json
├─ src/
│  ├─ runner.mjs           # 主入口：连接、计划、执行、队列
│  ├─ config.mjs           # 配置加载、合并、校验
│  ├─ paths.mjs            # 统一路径
│  ├─ net.mjs              # 超时、重试、随机延迟
│  ├─ log.mjs              # 日志文件
│  ├─ browser.mjs          # 启动 / 复用专用 Edge
│  ├─ browser-session.mjs  # 标签选择、登录态检测
│  ├─ crawl.mjs            # 必修目录采集
│  ├─ answer.mjs           # 答题队列与提交核验
│  ├─ learning.mjs         # 视频 / 阅读 / 词汇学习
│  ├─ core.mjs             # 计划校验、提交控件识别
│  ├─ choice.mjs           # 选择题执行
│  ├─ policy.mjs           # 运行策略
│  ├─ queue.mjs            # 任务筛选
│  ├─ result.mjs           # 答题小结解析
│  ├─ inventory-report.mjs # 题型报告
│  ├─ verify-tasks.mjs     # 课程侧核验
│  ├─ audit-unit.mjs       # 单元审计
│  ├─ control.mjs          # 暂停 / 恢复 / 停止 / 跳过
│  └─ ...
├─ test/                   # node:test 单元测试
├─ docs/
│  ├─ CONFIG.md            # 配置字段说明
│  └─ COMMANDS.md          # 命令与参数
├─ artifacts/              # 运行产物（gitignore）
├─ logs/                   # 日志（gitignore）
└─ browser-profile/        # 专用 Edge 用户数据（gitignore）
```

---

## 8. 日志与产物

| 路径 | 内容 |
|---|---|
| `logs/run-YYYY-MM-DD.log` | 运行日志：课程、连接、重试、失败原因 |
| `artifacts/<courseKey>/inventory/` | 该课程的必修清单、题干、控件快照、题型报告 |
| `artifacts/<courseKey>/answer-progress.json` | 每任务状态：`submitted` / `learned` / `skipped` / `failed` |
| `artifacts/<courseKey>/checkpoint.json` | 断点与最近动作历史 |
| `artifacts/<courseKey>/events.jsonl` | 步骤级事件 |
| `artifacts/<courseKey>/answer-rounds.jsonl` | 每轮答题诊断（轮次、是否卡住、提交） |
| `artifacts/<courseKey>/last-run-summary.json` | 本次结束时仍未完成的任务 |
| `artifacts/<courseKey>/failure*.json` | 出错时的现场快照 |

`submitted` 表示已看到答题小结，`learned` 表示学习动作已执行，两者都不等于课程侧已确认完成；需要以 `npm run verify` 或课程页面为准。

---

## 9. 已知限制

1. 题型识别依赖页面结构和文案。平台改版后可能需要更新 `uiTexts` 或 `typeRules`。
2. 自定义单选组件、拖拽题的浏览器实现差异较大，个别题型可能需要在 `--list` 里确认分类后再处理。
3. `finished=true` 只是模型的判断，脚本仍要求答题小结或人工核验，不会仅凭模型声明标记完成。
4. 视频按正常速度播放，长视频会占用与视频时长相当的时间。
5. 脚本不模拟浏览器指纹，也不改动页面之外的任何请求；所有操作都通过页面正常控件完成。
6. 未在所有学校、所有课程版本上验证；第一次用于新课程时，建议先用 `dryRun` 预览。

---

## 10. 常见问题

**Q：提示“无法连接现有 Edge”？**
先运行 `npm run browser`，等窗口出现后再运行其他命令。脚本不会自己拉起浏览器。

**Q：提示登录已过期？**
在专用 Edge 的原课程标签里重新登录，再运行命令。脚本不会自动填写账号密码。

**Q：`npm run courses` 显示“未填写”？**
对应分组的 `courseId` 还是占位符，或 `courseUrl` 里仍留着 `{courseId}` 没被替换。

**Q：换了课程，队列还是旧的？**
每门课的清单在 `artifacts/<courseKey>/inventory/`，新课程要先 `npm run crawl`。

**Q：`npm run list` 说没有任务？**
检查 `--unit` / `--type` / `--from` / `--skip-banked-cloze` 的组合，以及是否已经采集过该课程。

**Q：某道题一直不提交？**
看 `answer-rounds.jsonl` 里的 `stalled` 记录。脚本连续 `maxStallRounds` 轮没有进展时会尝试兜底提交，否则带原因停止。用 `--from` 从该任务重跑即可。

**Q：中途 Ctrl+C 了怎么办？**
进度在 `answer-progress.json` 里，直接重跑；或先 `npm run resume` 清掉停止标记。

**Q：`npm test` 报 `EPERM`？**
个别受限环境不允许测试进程用管道启动子进程。可以逐个文件运行：`node test/core.test.mjs`。

**Q：能不能把 `artifacts/` 发给别人？**
不建议。里面有课程题干、截图和 DeepSeek 对话，属于你的学习数据。

---

## 11. 免责声明

- 本项目仅用于**个人学习辅助**，用于减少重复的页面操作。请遵守所在学校的课程规定、学术诚信要求和平台用户协议。
- 使用者应自行确认使用方式是否被所在课程允许。因使用本工具产生的任何后果（包括但不限于成绩、纪律处分、账号状态），由使用者自行承担。
- 本项目按“现状”提供，不保证答案正确、不保证得分、不保证课程侧一定记录为完成，也不对平台改版后的可用性作任何承诺。
- 本项目不收集、不上传、不存储你的账号密码；登录态和运行数据都留在本机。请勿把 `config.json`、`browser-profile/`、`artifacts/`、`logs/` 提交到公开仓库或分享给他人。
- 作者不对第三方平台（U 校园、DeepSeek 等）的服务变更、封禁或数据丢失负责。

---

## 12. 许可证

本项目基于 [MIT License](LICENSE) 开源。你可以自由使用、修改、分发，但需保留版权声明与许可声明。使用前请把 `LICENSE` 里的 `<YOUR NAME>` 替换为你的名字或组织名。