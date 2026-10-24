# 配置文件字段说明

配置文件只有两个：`config.example.json`（仓库自带模板）和 `config.json`（你复制出来的本地配置）。`config.json` 已被 `.gitignore` 排除，不会被提交。

运行时的合并顺序是：内置默认值 → `defaults` → 当前课程分组 → 环境变量 / 命令行参数。也就是说，写在一门课里的字段会覆盖 `defaults`，而环境变量和命令行参数的优先级最高。

## 1. 顶层字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `activeCourse` | string | `course1` | 默认使用哪个课程分组。可用 `--course course3` 或环境变量 `UNIPUS_PROFILE` 临时覆盖。 |
| `courses` | object | — | 四个课程分组：`course1` ~ `course4`，结构完全相同。 |
| `defaults` | object | — | 四门课共用的设置；课程分组里的同名字段会覆盖它。 |
| `dryRun` | boolean | `true` | 为 `true` 时只读取页面、生成计划，不填写也不提交。建议先用默认值走一遍。 |
| `maxSteps` | number | `1200` | 单次运行最多执行多少个页面动作，防止异常时无限循环。 |
| `responseTimeoutMs` | number | `240000` | 等待 DeepSeek 单次回复的最长时间（毫秒）。 |
| `incorrectChoiceRate` | number | `0.01` | 同一道单选题里改选其他有效选项的概率，取 `0` 表示完全按模型答案。判断题不参与。 |
| `uploadScreenshots` | boolean | `true` | 是否把当前页面截图上传给 DeepSeek。关闭后只发送文本和控件清单。 |
| `muteCourseMedia` | boolean | `true` | 是否把课程视频/音频静音，避免运行期间外放。 |
| `answerPolicy` | object | 见下 | 记录当前答题策略的说明性字段，便于分享时说明取值。 |
| `browserEndpoint` | string | `http://127.0.0.1:9228` | 专用 Edge 的 CDP 调试地址，只允许本机 `127.0.0.1`。 |

## 2. 课程分组字段（`courses.course1` ~ `courses.course4`）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `label` | string | 是 | 课程显示名，例如 `大学英语 1`。日志和报错里用它区分课程。 |
| `textbook` | string | 否 | 教材名，例如 `新视野大学英语（第四版）读写教程 1`，会写进给模型的提示词。 |
| `courseId` | string | 是 | 课程 ID。课程入口 URL 形如 `https://uai.unipus.cn/app/cmgt/resource-detail/<课程ID>`，`<课程ID>` 就是它。 |
| `courseUrl` | string | 是 | 课程目录入口。保留 `{courseId}` 占位符时会自动替换成上面的 `courseId`。 |
| `unitCount` | number | 是 | 这门课有多少个单元，取值 1~30。`--unit` 的上限也来自这里。 |
| `answerSource` | string | 否 | `deepseek-web`（默认，用 DeepSeek 网页产出答案）或 `manual`（只用脚本做学习任务，答题交给你自己）。 |
| `submitTexts` | string[] | 否 | 提交按钮的文案。默认 `["提交", "提交答案", "Submit"]`。元素以 `^` 开头时按正则匹配，其余按包含匹配。 |
| `manualTaskTypes` | string[] | 否 | 需要你手动完成、脚本只跳过不代做的题型，默认 `["项目作品上传", "复习自评"]`。 |
| `skipTaskTypes` | string[] | 否 | 额外跳过、且不写进队列的题型，默认空数组。 |
| `listeningKeywords` | string[] | 否 | 判断“听力任务”的关键词。听力任务会套用固定规则：填空全填 `1`，单选选每组第一项。默认 `["听力", "听写", "listening", "dictation"]`。 |
| `referencePathAlias` | string | 否 | 教材原文所在目录的名字，用于把原文作为答案校对参考。默认 `Reading the text`。 |
| `typeRules` | object | 否 | 覆盖题型识别规则，见第 4 节。 |
| `uiTexts` | object | 否 | 覆盖页面文案，见第 3 节。 |
| `network` / `throttle` / `answerLoop` / `learningPolicy` | object | 否 | 在单门课里覆盖 `defaults` 的同名配置。 |

### 怎么找到课程 ID

1. 在浏览器里登录 U 校园，进入目标课程的学习页。
2. 地址栏形如 `https://uai.unipus.cn/app/cmgt/resource-detail/12345678901`。
3. 最后那串数字就是 `courseId`，把它填进对应课程分组即可。

四门课如果都选了，就分别填进 `course1` ~ `course4`；`activeCourse` 决定默认用哪一门。

## 3. `defaults` 通用字段

### `defaults.deepseek`

| 字段 | 默认值 | 说明 |
|---|---|---|
| `url` | `https://chat.deepseek.com/` | DeepSeek 网页地址。 |
| `composer` | `textarea` | 输入框选择器。 |
| `fileInput` | `input[type=file]` | 上传截图的文件输入框。 |
| `uploadButton` | 空字符串 | 需要先点“上传”才能出现文件输入框时，填这个按钮的选择器。 |

### `defaults.login`

| 字段 | 默认值 | 说明 |
|---|---|---|
| `ssoHost` | `sso.unipus.cn` | 登录页域名；页面停在这里时脚本判定登录态失效并提示重新登录。 |
| `courseHosts` | `["uai.unipus.cn", "ucontent.unipus.cn"]` | 课程目录页与课件页的域名。平台域名变化时改这里。 |

### `defaults.uiTexts`

页面文案因平台版本而变时，只改这里，不用改代码。

| 字段 | 默认值 | 用途 |
|---|---|---|
| `submitConfirm` | `确定提交吗` | 提交确认弹窗的标志文案 |
| `answerSummary` | `答题小结` | 提交后结果页的标志文案 |
| `answerSummaryEntry` | `查看答题小结` | 打开结果页的入口按钮文案 |
| `dismiss` | `我知道了` | 提示弹窗的关闭按钮文案 |
| `startLearning` | `开始学习` | 目录页进入课件的按钮 |
| `continueLearning` | `继续学习` | 已开始过的课程入口按钮 |
| `newChat` | `开启新对话` | DeepSeek 新建对话按钮 |
| `vocabularyNext` | `下一个` | 词汇卡片的“下一个”按钮 |

### `defaults.network`

| 字段 | 默认值 | 说明 |
|---|---|---|
| `connectTimeoutMs` | `15000` | 连接专用 Edge 的超时时间。 |
| `gotoTimeoutMs` | `30000` | 页面导航与重新加载的超时时间。 |
| `retries` | `2` | 连接浏览器、打开页面失败时的重试次数。 |
| `retryDelayMs` | `1500` | 每次重试之间的等待时间。 |

### `defaults.throttle`

页面动作之间的随机等待区间（毫秒），用于把操作节奏放慢到接近人工点击。

| 字段 | 默认值 | 适用动作 |
|---|---|---|
| `actionDelayMs` | `[1800, 4500]` | 点击、拖拽、切换页签 |
| `fillDelayMs` | `[250, 600]` | 文本框填写、下拉选择 |
| `choiceDelayMs` | `[150, 350]` | 选择题选项点击 |

### `defaults.logging`

| 字段 | 默认值 | 说明 |
|---|---|---|
| `dir` | `logs` | 日志目录，相对项目根目录。 |
| `level` | `info` | `debug` / `info` / `warn` / `error`。 |

### `defaults.answerLoop`

| 字段 | 默认值 | 说明 |
|---|---|---|
| `maxStallRounds` | `3` | 连续多少轮页面没有新进展就判定卡住，改为脚本兜底提交或带原因停止。 |
| `maxRoundsPerTask` | `12` | 单个任务最多问多少轮 DeepSeek。 |
| `newChatEveryRounds` | `8` | 每多少轮自动在 DeepSeek 新建一个对话，避免历史过长导致回复变慢。 |

### `defaults.runnerPolicy`

| 字段 | 默认值 | 可选值 | 说明 |
|---|---|---|---|
| `skippedTasks` | `remember` | `retry` / `remember` | `remember` 表示跳过的任务下次继续跳过；`retry` 表示下次重新尝试。 |
| `listeningChoices` | `first` | `deepseek` / `first` / `manual` | 听力单选题的处理方式：按模型答案 / 固定选第一项 / 留给你手动。 |
| `deepseekFailure` | `continue` | `stop` / `continue` | DeepSeek 连续失败后是继续下一个任务还是整体停止。 |
| `taskFailure` | `continue` | `stop` / `continue` | 单个任务执行出错时是否继续。停止命令、登录失效、标签关闭永远会中断，不受此项影响。 |

### `defaults.learningPolicy`

| 字段 | 默认值 | 说明 |
|---|---|---|
| `readingSeconds` | `10` | 阅读类任务停留的秒数（暂停不计时）。 |
| `video` | `normal_play_until_ended` | 视频按正常速度播放到结束，不改进度。 |
| `vocabulary` | `next_until_last_then_quiz` | 词汇卡片逐张点“下一个”，完成后进入练习。 |
| `subtasks` | `track_full_unit_section_tab_task_path` | 任务进度按“单元/栏目/页签/子任务”完整路径记录。 |

## 4. `defaults.typeRules`

题型识别规则。值是正则片段或关键词，脚本按顺序匹配任务的名称与题干。

| 键 | 匹配目标 | 默认值 |
|---|---|---|
| `manual` | 数组，直接判定为手动任务 | `["项目作品上传", "复习自评"]` |
| `projectUpload` | 对象：`task` 匹配任务名、`text` 匹配题干 | `{"task": "^Unit project$", "text": "upload your work"}` |
| `review` | 对象：`task` 匹配任务名 | `{"task": "^Review & check$"}` |
| `choiceCaption` | 选项题干形如 `A` 的单选题 | `^[A-Z]$` |
| `trueFalseText` | 判断题题干 | `True\.|False\.|Not given\.` |
| `bankedCloze` | 选词完形 | `Banked cloze` |
| `sentenceStructure` | 句型改写 | `Sentence structure` |
| `translation` | 翻译 | `Translat` |
| `writing` | 写作 | `Structured writing|Unit project` |
| `vocabulary` | 词汇题 | `^Vocabulary$` |
| `media` | 音视频类 | `Preview|Viewing|Critical thinking skill` |
| `fallback` | 无法归类时的默认类型 | `阅读或尚未识别的交互` |

题型名称（如 `翻译`、`Banked cloze`）是脚本内部枚举，用于选择处理分支；识别关键词在上表里可改。

## 5. 环境变量

环境变量优先级高于配置文件，适合临时切换而不改文件。

| 变量 | 作用 | 示例 |
|---|---|---|
| `UNIPUS_PROFILE` | 指定当前课程分组 | `course2` |
| `UNIPUS_COURSE_ID` | 覆盖当前课程的 `courseId` | `12345678901` |
| `UNIPUS_BROWSER_ENDPOINT` | 覆盖 CDP 地址（必须是 127.0.0.1） | `http://127.0.0.1:9228` |
| `DEEPSEEK_URL` | 覆盖 DeepSeek 地址 | `https://chat.deepseek.com/` |
| `UNIPUS_DRY_RUN` | `1` 强制只预览，`0` 允许执行 | `1` |

PowerShell 里临时用法：

```powershell
$env:UNIPUS_PROFILE = 'course2'; npm run list
```

## 6. 切换四门课

三种方式，任选其一：

```powershell
# 1. 改 config.json 的 activeCourse
# 2. 命令行
npm run list -- --course course2
npm start -- --course course2

# 3. 环境变量
$env:UNIPUS_PROFILE = 'course4'; npm start
```

先运行 `npm run courses` 查看四门课是否已填写：

```
course1  大学英语 1  （未填写）  可运行：否
course2  大学英语 2  20001277965  可运行：是
...
```

只有 `courseId` 已填且 `courseUrl` 不含 `{courseId}` 的课程才会显示“可运行：是”。

## 7. 安全约定

- 配置文件里不存账号、密码、cookie、token；登录态只存在于本机 `browser-profile/`。
- `config.example.json` 全部是占位符，可以直接公开。
- `config.json`、`browser-profile/`、`artifacts/`、`logs/` 都已被 `.gitignore` 排除，不要手动提交或打包分享。