# 第三方代码说明

本项目以 [MIT 许可](LICENSE) 发布。以下列出所有引用到的第三方代码 ——
包括**移植的工具**与**内置的库**，以及各自的来源、版本、许可与改动。

---

## 一、移植的工具

来源仓库：**[jamalofski/praticulus](https://github.com/jamalofski/praticulus)**
作者：Jamal Tantaoui · [Iris Digital](https://irisdigital.tech/) · MIT 许可 · https://praticulus.com

移植时统一遵循三条：**中文化**、**改用本项目的设计系统与组件类名**、**修复上游缺陷**。
上游的 `css/style.css` 与 `js/common.js` 均未引入。

### 1. JSON 格式化

| | |
|---|---|
| 上游文件 | `json-formatter/index.html`、`js/tools/json-formatter.js` |
| 本项目文件 | `tools/json-formatter/index.html`、`js/tools/json-formatter.js` |

改动：

- 界面文案、状态提示、解析报错全量中文化
- 改用本项目的设计系统与组件类名，去掉原有内联样式
- **重写语法高亮**。上游先调用 `escapeHtml`（会把 `"` 转义成 `&quot;`），
  再执行四条依赖引号匹配的正则，导致键名与字符串值完全没有着色，
  而字符串内部的数字反被误标成数字。改为单遍扫描的记号化，一次成型、不回头重扫。
- **补齐数组元素的着色**。上游的高亮正则都以 `:` 开头，数组元素不着色。
- 报错信息把 `position` 换算成行列号，并翻译成中文说明
- 复制改为带降级的实现；新增结构统计、自动换行开关、`Ctrl+Enter` 快捷键
- 格式化 / 压缩 / 校验的功能划分、缩进选项与「粘贴即格式化」沿用上游设计

### 2. 正则表达式测试

| | |
|---|---|
| 上游文件 | `regex-tester/index.html`、`js/tools/regex-tester.js` |
| 本项目文件 | `tools/regex-tester/index.html`、`js/tools/regex-tester.js` |

改动：

- 界面文案与模式解释器标签全量中文化
- 改用本项目的设计系统与组件类名
- **修复空匹配死循环**。全局正则遇到零长匹配时 `exec` 不推进 `lastIndex`，
  上游仅靠计数上限兜底，会产出上千条重复的空匹配。
- **修复分享链接丢参数**。参数以 base64 编码，末尾的 `=` 填充会让上游
  `split('=')` 解析出的键值对长度不等于 2，该参数被静默丢弃。
- 新增标志快捷开关与统计面板，输入改为防抖执行
- 模式解释算法、界面结构与交互流程沿用上游设计

### 3. Markdown 转 HTML

| | |
|---|---|
| 上游文件 | `markdown-to-html/index.html`、`js/tools/markdown-to-html.js` |
| 本项目文件 | `tools/markdown-to-html/index.html`、`js/tools/markdown-to-html.js` |

改动：

- 界面文案全量中文化
- 改用本项目的设计系统与组件类名；预览区改用本项目自己的 `.md-preview` 样式
- **移除 Prism 依赖**。上游用 Prism 给 HTML 源码着色，需要额外引入
  `prism.min.js` 与上百个语言组件；本项目改为内置的轻量 HTML 记号化着色，
  不引入任何新依赖。
- **本地存储的键名与说明**。上游用 `tp-md2html` 静默保存草稿，
  本项目改用 `toolbox-md2html` 并在页面上明确告知。
- 新增输出结构统计（标题 / 链接 / 图片 / 代码块 / 表格）
- 代码 / 预览双视图、Tailwind 工具类选项、复制 / 下载、编辑器自动保存沿用上游设计

### 4. CSV 查看器

| | |
|---|---|
| 上游文件 | `csv-viewer/index.html`、`js/tools/csv-viewer.js` |
| 本项目文件 | `tools/csv-viewer/index.html`、`js/tools/csv-viewer.js` |

改动：

- 界面文案全量中文化
- 改用本项目的设计系统与组件类名；表格加了行号列、吸顶表头与键盘排序
- **修复 BOM 未剥离**。Excel 导出的 CSV 常带 UTF-8 BOM，上游不处理，
  导致第一列列名多一个不可见字符（U+FEFF），导出的 JSON 键名也随之对不上。
- **修复分隔符探测**。上游直接对首行做 `split` 计数，会把引号内的分隔符也算进去，
  于是「单列但值里含分号」的 CSV 会被误判成多列。改为跳过引号片段后再计数。
- **新增编码探测**。UTF-8 严格解码失败则回退 GBK（中文 Excel 导出的常见编码），
  使用浏览器原生 `TextDecoder`，不引入任何依赖。
- **新增分页**。上游一次性渲染全部行，几十万行的文件会直接卡死页面；
  现在一次只渲染一页（默认 500 行），可切换每页行数。
- 导出 JSON 时处理空表头与重名表头；TSV 导出对制表符 / 换行 / 引号做引号包裹
- 表头排序改用严格数值判断与 `localeCompare({numeric:true})`，
  避免把 `1,234` 当成 1、让 `item2` 排在 `item10` 之后
- RFC 4180 解析器、拖放上传、表头开关、分隔符选择、JSON / TSV 导出沿用上游设计

### 5. Markdown 预览

| | |
|---|---|
| 上游文件 | `markdown-preview/index.html`、`js/tools/markdown-preview.js` |
| 本项目文件 | `tools/markdown-preview/index.html`、`js/tools/markdown-preview.js` |

改动：

- 界面文案全量中文化
- 改用本项目的设计系统与组件类名；预览复用 `.md-preview`
- **修复 localStorage 未容错**。上游直接 `localStorage.getItem(...)`，
  在禁用存储的浏览器环境会抛 `SecurityError`，整个脚本随之挂掉，
  编辑器一起废掉。改为全部包 try/catch，存储不可用时降级为「不保存草稿」。
- **修正按钮语义**。上游的「Clear」实际是恢复默认示例而不是清空，
  标签与行为不符。本项目拆成「清空」与「恢复示例」两个按钮。
- **新增文档大纲**：从渲染结果里抽取标题，生成可点击跳转的目录
- **新增统计面板**：字符 / 标题 / 链接 / 图片 / 代码块 / 阅读时长
- 重新渲染时保留预览的滚动位置，避免写作过程中被弹回顶部
- 复制 / 下载改用带降级的公共实现，并给出操作反馈
- 双栏实时预览、`breaks: true`、草稿自动保存、复制 Markdown / HTML 沿用上游设计

> 大纲锚点（`id="mp-h-N"`）只加在 DOM 上，不写进「复制 HTML」的输出 ——
> 给出去的应该是干净的语义 HTML，而不是带工具内部 id 的片段。

### 6. 取色器（含颜色工具函数）

| | |
|---|---|
| 上游文件 | `color-picker/index.html`、`js/tools/color-picker.js`、`js/color-utils.js` |
| 本项目文件 | `tools/color-picker/index.html`、`js/tools/color-picker.js`、`js/color-utils.js` |

`js/color-utils.js` 是颜色类工具共用的换算模块，挂在 `window.TOOLBOX.color` 上，
后续的调色板生成、渐变生成、对比度检查等工具都会复用它。

改动：

- 界面文案全量中文化
- 改用本项目的设计系统与组件类名；色值做成可点击复制的列表，新增明暗色阶与对比度徽章
- **修复静默失败**。上游的 `hexToRgb` 不做任何校验，非法输入经 `parseInt` 得到 `NaN`，
  `(NaN >> 16) & 255` 变成 `0`，于是**静默返回黑色** —— 用户看不出错在哪里。
  现在校验失败返回 `null`，取色器会把输入框标红并保持原色不变。
- **扩展颜色解析**。上游的 `parseColor` 只认 `#rgb` / `#rrggbb` / `rgb()` / `hsl()`。
  新增浏览器解析兜底：塞进 `style.color` 再读 `getComputedStyle`，
  于是颜色名（`tomato`）、`#rrggbbaa`、CSS Color 4 的 `rgb(255 0 0)` 语法都能解析，
  而且零依赖 —— 不用自己维护颜色名表。
- `rgbToHsl` 把 `360` 归一成 `0`（h 应落在 `[0, 360)`）
- `luminance` 的分段阈值改用 `0.04045`（WCAG 2.2 与 sRGB 规范当前取值；
  上游用的 `0.03928` 是 WCAG 2.0/2.1 的旧值）
- 新增 `wcagLevels()`，把 AA / AAA 四档的阈值集中到一处
- 复制改用带降级的公共实现；新增前后景交换、背景色手动输入、色值行复制反馈
- 系统取色盘、屏幕吸管（`EyeDropper`）、明暗色阶、对比度检查沿用上游设计

### 7. 颜色格式转换

| | |
|---|---|
| 上游文件 | `color-converter/index.html`、`js/tools/color-converter.js` |
| 本项目文件 | `tools/color-converter/index.html`、`js/tools/color-converter.js` |

改动：

- 界面文案全量中文化
- 改用本项目的设计系统与组件类名；五种色值做成可点击复制的列表
- **修复数据错误**。上游自带的 148 项 CSS 命名颜色表里，`mediumpurple` 写成了
  `[147, 111, 219]`，而规范值 `#9370DB` 是 `[147, 112, 219]` —— 绿色分量差 1。
  本项目把整张表逐个交给浏览器解析做了交叉验证，只有这一处对不上，已修正。
  这个校验也留在了测试里，以后改动表会立刻发现。
- **命名颜色表挪进公共模块**。改放在 `js/color-utils.js`，以 `closestName()` /
  `namedToRgb()` 暴露，后续调色板类工具可复用；取色器页面也因此能显示命名颜色。
- 色值解析统一走 `ColorUtils.parseColor`（含浏览器兜底），
  于是 `hwb()`、8 位 HEX、颜色名都能直接输入
- 修复缺陷：上游直接 `hexToRgb(picker.value)` 而不判空，
  解析失败会带着 `null` 继续往下算；现在统一做兜底
- 新增 HWB 换算（`rgbToHwb` / `hwbToRgb`，进 `color-utils.js`）
- 透明度滑杆的轨道会随颜色与透明度实时变化，直观显示当前 alpha
- 输入非法时标红并保持原色
- 五种格式的换算、透明度开关、命名颜色提示沿用上游设计

### 8. 颜色混合

| | |
|---|---|
| 上游文件 | `color-blender/index.html`、`js/tools/color-blender.js` |
| 本项目文件 | `tools/color-blender/index.html`、`js/tools/color-blender.js` |

改动：

- 界面文案全量中文化
- 改用本项目的设计系统与组件类名，去掉上游逐块 `createElement` 与内联样式
- **修复静默失败**。上游的文本框输入非法色值时没有任何反馈 —— `syncTextToPicker`
  解析不出来就直接返回，界面照旧、也不报错，用户分不清是输入错了还是没生效。
  现在把输入框标红，失焦时回退到当前值。
- **修复全局变量污染**。上游把插值结果挂在 `window._blendColors` 上供「复制全部」读取，
  改为模块内变量。
- **修复 HSL 插值的无彩色绕路**。灰色没有色相可言，`rgbToHsl` 一律给 `0`；
  上游直接拿这个 `0` 参与插值，于是灰 → 蓝的过渡会绕经品红（色相走 0 → 300 → 240）。
  现在让无彩色借用另一端的色相 —— 灰跟谁混，就走谁那条路。
- **修复端点色漂移**。HSL 按整数百分比存储，`rgbToHsl → hslToRgb` 的往返有 ±1 误差，
  上游色阶两端的颜色因此和输入值对不上（`#6c5ce7` 变成 `#6b5be6`）。
  现在两个端点直接返回原色，只有中间点才走换算。
- 插值得到的 `h / s / l` 不再预先取整，少一次舍入误差
- 统一分隔符：上游显示色阶用双空格、复制全部用「, 」，两处对不上，现在都用「, 」
- **新增 16 种混合模式**，按 W3C《Compositing and Blending Level 1》§9.1 实现，
  取值与 CSS 的 `mix-blend-mode` 对齐 —— 上游只有线性插值，没有任何混合模式。
  可分离模式（正片叠底、滤色、叠加、变暗、变亮、颜色减淡、颜色加深、强光、柔光、
  差值、排除）逐通道计算；不可分离模式（色相、饱和度、颜色、明度）用规范的
  `SetLum` / `SetSat` / `ClipColor` 三件套，先按明度或饱和度整体平移，
  再把溢出的分量按比例压回合法区间。
- 新增两色交换、插值空间切换（RGB / HSL）、混合结果色值列表与单块复制反馈
- 两色输入、中间点滑杆、HSL 开关、色阶条与「复制全部」沿用上游设计

> 混合模式本身只处理颜色，不做透明度合成（Porter-Duff），上游也没有相关实现。
> 与 CSS 对齐的是 `mix-blend-mode` 的颜色部分，不含 `opacity` 参与的那一层。

### 9. 对比度检查

| | |
|---|---|
| 上游文件 | `contrast-checker/index.html`、`js/tools/contrast-checker.js` |
| 本项目文件 | `tools/contrast-checker/index.html`、`js/tools/contrast-checker.js` |

改动：

- 界面文案全量中文化；预览示例换成中文，并按 WCAG 对「大字」的定义标注字号
  （18pt = 24px，或 14pt = 18.66px 以上粗体）
- 改用本项目的设计系统与组件类名（`badge--pass` / `badge--fail` 等）
- **修复「建议修复」的方向缺陷**（这个工具最有价值的一处）。
  上游只朝一个方向调明度 —— 背景亮度 ≤ 0.5 就一律提亮。但亮度落在 0.18–0.5 之间的
  背景（`#707070` 到 `#bcbcbc` 那一大片灰）往亮调到纯白也只有 3.95:1，而往暗调
  轻松可达 —— **明明有解却报「无法修复」**。现在两个方向同时向外试探，先命中的
  就是改动最小的解；算法放在 `js/color-utils.js` 的 `fixContrast()`，供后续工具复用。
- 上游的循环把明度夹到 `[0, 100]` 之后仍继续空转，越界以后每一轮拿到的都是同一个颜色
- 新增目标级别选择（AA 正文 / AA 大字 / AAA 正文），上游固定按 4.5:1 修
- 新增「距下一档还差多少」；无解时不再只说一句「找不到」，而是给出背景色的
  对比度上限（`maxContrast()`）—— 中灰背景的上限只有 5.32:1，任何颜色都过不了
  AAA 正文的 7:1，这时候该改的是背景色
- 新增「撤销」。上游改完前景色就回不去了，用户原色直接丢失
- 非法输入改为失焦回退。上游只加一个红框，输入框会一直留着非法内容
- 新增批量检查：一次算出一组前景色对当前背景色的达标情况，非法行单独标出
- 前后景交换、四档徽章、预览区、WCAG 判定沿用上游设计

### 10. 调色板生成

| | |
|---|---|
| 上游文件 | `palette-generator/index.html`、`js/tools/palette-generator.js` |
| 本项目文件 | `tools/palette-generator/index.html`、`js/tools/palette-generator.js` |

改动：

- 界面文案全量中文化，六种配色方案都配上中文名与说明
- 改用本项目的设计系统与组件类名，去掉上游逐块 `createElement` 与内联样式
- **修复偏色**。配色里「偏移 0」的那一项本该是主色本身，但上游把它也交给
  `hslToRgb` 重算了一遍 —— `rgbToHsl` 返回的是取整后的 h/s/l，往返换算有 ±1 误差，
  于是主色在结果里偏了一档（`#6c5ce7` 变成 `#6b5be6`）。现在这一项直接返回原值。
- **修复无障碍问题**。上游把空格键绑成「随机」并 `preventDefault()` ——
  键盘用户按空格想滚动页面时，页面不动、颜色却被换掉。改为 `R` 键，
  且焦点在输入框里时不触发。
- **修复全局变量污染**。上游把结果挂在 `window._paletteColors` 上供导出与复制读取，
  改为模块内变量。
- 修复静默失败：文本框输入非法色值时不报错也不标红，现在标红 + 失焦回退
- 统一分隔符：显示配色用双空格、复制用「, 」，现在都用「, 」
- 随机改用 `crypto.getRandomValues`（带 `Math.random` 回退），并在 HSL 空间的
  有彩色区间取值（饱和度 35%–95%、明度 30%–70%）—— 完全随机取 RGB 经常得到
  发灰或过暗过亮的颜色，配出来没法用
- 补上单色方案的说明：上游固定取 20%–80% 五级明度，主色自身的明度不参与，
  界面上不写清楚会让人以为「我的颜色丢了」
- **新增 11 级明暗色阶**。它与「单色」方案不是一回事：单色是配色方案（5 色），
  色阶是给设计令牌用的（11 级、跨度更大）。饱和度按明度做钟形修正，越靠近两端
  收得越多 —— 浅色不至于发荧光、深色不至于发焦
- 新增 JSON 导出；导出改为点击即复制并给出反馈（上游复制后没有任何提示）
- 六种配色方案、导出 CSS / SCSS / Tailwind、色块点击复制沿用上游设计

### 11. 渐变生成器

| | |
|---|---|
| 上游文件 | `gradient-generator/index.html`、`js/tools/gradient-generator.js` |
| 本项目文件 | `tools/gradient-generator/index.html`、`js/tools/gradient-generator.js` |

改动：

- 界面文案全量中文化，10 套预设的名称也改成中文
- 改用本项目的设计系统与组件类名；色标列表由逐行 `createElement` 改为一次性
  `innerHTML` + 事件委托
- **修复缺陷：添加色标落在 100%，与末尾色标完全重合。** 上游算的是
  「最后一个位置 + 到 100 的一半」，默认的 `0% / 100%` 两个色标算出来还是 `100%`
  —— 点完按钮看不到任何变化，用户会以为按钮坏了。现在插在**空隙最大的区间中点**，
  并列时取靠后的那个。
- **修复缺陷：完全随机取 RGB 配不出能用的渐变。** 随机出来的两个色经常是几乎一样的灰，
  渐变糊成一片。现在先取一个基准色相，让各色标沿色相环铺开（跨度 40°–180°），
  饱和度与明度也限制在有彩色的区间里。
- 修复静默失败：文本框输入非法色值时不报错也不标红，现在标红 + 失焦回退
- 修复无障碍：删除按钮只有一个 `×` 字形，没有可读的名字，补上 `aria-label`；
  预览区原来挂 `aria-live` 却没有文本，读屏会念一个空 div，改成 `role="img"`
- **新增色标位置轴**：拖动位置滑杆时能直接看到各色标落在轴的哪儿
- **新增「重复」开关**，生成 `repeating-linear` / `repeating-radial` / `repeating-conic` 渐变
- 去掉上游的 `HAS_COLOR_UTILS` 非阻塞降级。那是为「脚本被拦截器挡掉」设计的，
  本项目是零依赖静态站、`color-utils.js` 就在同一个仓库里，不存在这种情况，
  统一成与其他颜色工具一致的退出方式
- 三种渐变类型、角度、色标增删与位置、10 套预设、点击复制 CSS 沿用上游设计

### 12. 二维码生成

| | |
|---|---|
| 上游文件 | `qr-generator/index.html`、`js/tools/qr-generator.js`、`js/vendor/qrcode.min.js` |
| 本项目文件 | `tools/qr-generator/index.html`、`js/tools/qr-generator.js`、`js/vendor/qrcode.umd.js` |

改动：

- 界面文案全量中文化；默认示例换成中性的 `https://example.com/`
- 改用本项目的设计系统与组件类名
- **预览从 canvas 改成 SVG**。canvas 预览在缩放时会糊，而且拿不到 2d 上下文的环境
  （无头浏览器、装了隐私插件的浏览器）整个工具会白屏。SVG 是矢量的，放到多大都清晰。
  只有导出 PNG 时才临时建一个离屏 canvas，并在拿不到上下文时明确提示用户改用 SVG。
- **修复缺陷：上游自己写了一份相对亮度 `relLum`**，分段阈值用的还是 `0.03928`
  （WCAG 2.0 / 2.1 的旧值）。现在直接用 `js/color-utils.js` 的 `luminance` 与
  `contrastRatio`，不再重复实现。
- **修复缺陷：iCalendar 与 vCard 的文本字段没有转义。** 标题里带个逗号或分号，
  生成的 ICS / VCF 结构就坏了。按 RFC 5545 / RFC 6350 补上转义。
- **修复缺陷：canvas 上那次 `imageRendering` 赋值是无效代码** ——
  两个分支的取值效果完全相同，等于什么都没做。改成在 SVG 上按样式选
  `shape-rendering`：方块用 `crispEdges`、圆点与圆角用 `geometricPrecision`。
- 导出 SVG 的 `<image>` 同时写 `href` 与 `xlink:href` —— 前者是 SVG 2 的写法，
  后者兼容老工具，只写一个总有一边不认。
- 新增内容字节数与「反色 / 低对比度」提示；新增前后景对调按钮
- 去掉上游的 `HAS_QR` 非阻塞降级，统一成与其他颜色 / 生成器工具一致的退出方式
- **内置库换成 npm 官方产物**，理由见下面「二、内置的第三方库」
- 九种内容类型、纠错等级、三种模块样式、尺寸、配色、中心 Logo、PNG / SVG 导出沿用上游设计

### 13. 密码生成器

| | |
|---|---|
| 上游文件 | `password-generator/index.html`、`js/tools/password-generator.js`、`js/wordlist.js` |
| 本项目文件 | `tools/password-generator/index.html`、`js/tools/password-generator.js`、`js/vendor/eff-large-wordlist.js` |

改动：

- 界面文案全量中文化；上游的 `js/common.js`（`copyToClipboard` / `showToast` /
  `escapeHtml`）未引入，复制改用本项目的 `T.util.copy` 与全局代理
- 改用本项目的设计系统与组件类名，去掉上游的内联样式与 `card` 结构
- **修复模偏差**。上游用 `cs[v % cs.length]` 取字符 —— 字符集长度不整除 2^32 时，
  靠前的字符出现概率会略高（`%` 的经典缺陷）。改为拒绝采样，与随机字符串共用
  `js/random-utils.js`。
- **修复字符集为空时的静默降级**。上游 `getCharset()` 在四个类别都没勾时返回小写字母，
  用户看到的是「我明明只勾了符号，怎么出来一串小写字母」。现在直接报错并说明原因。
- **修复复制没有降级**。上游裸调 `navigator.clipboard.writeText`：非安全上下文
  （http、部分内嵌浏览器）下 `navigator.clipboard` 是 `undefined`，会直接抛 TypeError；
  即使存在，Promise 失败也没有任何处理，用户会以为复制成功了。
- **修复清空自定义分隔符后无法恢复**。上游只在输入非空时赋值，把输入框清空后仍旧
  沿用上一个值。现在「填了就用自定义，清空即回到胶囊选中的那个」。
- **修复非法数值不校验**。上游直接 `parseInt`，输入框清空得到 `NaN`，
  `new Uint32Array(NaN)` 会**静默产出一个空密码**。现在非法输入标红 + 失焦回退。
- **修复批量条数被静默截断**。上游 `Math.min(..., 100)`，填 500 只给 100，
  界面上没有任何提示。现在输入框直接限定 1–100，超界标红回退。
- **修复爆破时间的分档上限**。上游的分档表最高只到「Billions of years」，
  而 `Math.pow(2, entropy)` 在熵值大时要么溢出成 `Infinity`、要么落到 10^241 秒
  这种量级 —— 一个 128 字符的密码会被告知「约数十亿年」，实际是 10^233 年，
  差了两百多个数量级。现在全程在对数空间计算，按 年 / 万年 / 亿年 / 万亿年 /
  `10^N 年` 分档，不会溢出也不会被压档。
- **替换词表**。上游自带的 `js/wordlist.js` 只有 529 个词，按字母序排到 `faculty`
  就断了（首字母分布 a:100 b:98 c:152 d:91 e:85 f:3），是一份被截断的列表。
  换成 EFF 官方 7776 词长词表，见下面「二、内置的第三方资源」。
- 新增「每类至少出现一次」，应付「必须含大小写和数字」这类校验规则
- 新增熵值、四段强度条与离线爆破时间；熵值按强度分三档上色
- 双模式（随机密码 / 口令短语）、长度滑杆、字符类别开关、分隔符胶囊、批量生成
  沿用上游设计

> 「每类至少出现一次」会让分布不再完全均匀，所以界面显示的熵是**上界**，
> 状态行会明确写出这一点。上游没有这个功能，也就没有这个问题。

### 14. 占位文本生成

| | |
|---|---|
| 上游文件 | `lorem-ipsum/index.html`、`js/tools/lorem-ipsum.js`、`js/cicero.js` |
| 本项目文件 | `tools/lorem-ipsum/index.html`、`js/tools/lorem-ipsum.js`、`js/lorem-corpus.js` |

改动：

- 界面文案全量中文化；上游的 `js/common.js`（`copyToClipboard` / `downloadText`）未引入，
  复制改用本项目的全局代理，下载改用本次新抽出的 `T.util.download`
- 改用本项目的设计系统与组件类名；结果区换成正文字体（`.output--prose`）——
  占位文本的用途就是看排版，等宽字体看不出行距与整体灰度
- **修复后行断言导致整个脚本加载失败**（可观察）。上游用
  `p.split(/(?<=[.?!])\s+/)` 切句。正则里的后行断言在 Safari 16.4 之前是
  **语法错误**（不是运行时异常），整个文件解析不过去，工具直接白屏。
  改成不依赖 lookbehind 的扫描式切分。
- **修复「包一层 HTML 标签」在「单词」单位下静默失效**（可观察）。
  上游那个分支根本没读这个开关，勾了等于没勾。现在四种单位都会包。
- **修复数量超过语料长度时的整块重复**（可观察）。上游 `pool[i % pool.length]`
  让第 2 轮与第 1 轮**逐字相同** —— 要 20 个段落、语料只有 8 段时，
  后 12 段就是前 8 段的逐字复制。现在每一轮重新打乱。
- **修复数量输入不校验**（可观察）。上游 `Math.min(parseInt(v) || 3, 100)`：
  清空输入框静默变回 3、填 500 静默变 100，界面上没有任何提示。
  改用 `T.util.readInt`（标红 + 失焦回退）。
- **修复复制没有降级**（可观察）。上游裸调 `navigator.clipboard.writeText`，
  非安全上下文（http、部分内嵌浏览器）下会直接抛 TypeError。
- **修正语料标注**（可观察）。上游把 8 段语料一起标成 Cicero
  《De Finibus Bonorum et Malorum》1.10.32–1.10.33 原文，但**后 2 段不是** ——
  它们是网络模板里流传的另一套拉丁填充句（`pellentesque` / `accumsan` /
  `scelerisque` 这些词来自别处），第 7、8 段里连一个 `lorem` 都没有。
  本次把标注改准，数据原样保留。
- 顺手改直两处**隐患**（当前语料下看不出问题，但会随语料变化暴露）：
  词池用 `if (w)` 判断的是清洗**前**的 token，纯标点 token 会以空串进池子，
  产出多余空格；「以经典开头」从下标 1 开始取，`pool[0]` 在 count 较小时
  永远取不到 —— 因为池子每次生成都会重新打乱，各段落长期看仍然均匀，
  所以这一条**不算可观察缺陷**，只是意图明显是「取满池子」而代码没做到。
- 字符数改用码点数（上游用 `result.length`，那是 UTF-16 码元数）
- **新增中文语料与中文界面** —— 上游只有拉丁文
- 四种单位、以经典开头、HTML 包裹、复制 / 下载沿用上游设计

> **拉丁语料的出处。** `js/lorem-corpus.js` 里的 8 段中，前 6 段出自 Cicero
> 《De Finibus Bonorum et Malorum》1.10.32–1.10.33（公元前 45 年，早已进入
> 公有领域），也就是 Lorem ipsum 的标准出处；后 2 段是网络模板里流传的另一套
> 拉丁填充句，出处已不可考。拉丁文本身不涉及版权，所以数据原样沿用，
> 只把标注改准。这一点同时写在 `js/lorem-corpus.js` 的文件头和工具页的说明区。

> **中文语料是本项目自撰的**（随本仓库以 MIT 发布，可自由使用），不是从别处抄的：
> 内容是围绕排版与阅读的中性叙述，看起来是正常的现代汉语散文，实际不含任何信息，
> 也不引用任何受版权保护的作品。中文没有天然的词边界，所以中文下不提供
> 「单词」这一档，也不提供「以经典开头」（拉丁文的经典开头对中文没有意义）。

### 15. UUID 生成器

| | |
|---|---|
| 上游文件 | `uuid-generator/index.html`、`js/tools/uuid-generator.js`、`js/tools/uuid-generator-bigint.js` |
| 本项目文件 | `tools/uuid-generator/index.html`、`js/tools/uuid-generator.js` |

改动：

- 界面文案全量中文化；上游的 `js/common.js`（`copyToClipboard` / `downloadText`）未引入，
  复制改用本项目的全局代理，下载改用 `T.util.download`
- 改用本项目的设计系统与组件类名
- **修复 v1 的节点标识没有设单播/多播位（违反规范的 MUST）**。
  RFC 9562 §6.10 原文：

  > "After generating the 48-bit fully randomized node value, implementations
  > **MUST** set the least significant bit of the first octet of the Node ID to 1.
  > This bit is the unicast or multicast bit, which will never be set in IEEE 802
  > addresses obtained from network cards."

  上游直接拿随机 6 字节当节点，首字节最低位有一半概率是 0 ——
  那就有可能和真实网卡的 MAC 地址撞上，而这条规范存在的唯一目的就是防这个。
- **修复 v7 在同一毫秒内没有顺序**。RFC 9562 §6.2 专门点名了批量场景：

  > "Take care to ensure UUIDs generated in batches are also monotonic. That is,
  > if one thousand UUIDs are generated for the same timestamp, there should be
  > sufficient logic for organizing the creation order of those one thousand UUIDs."

  上游一种方法都没用，所以一次批量生成的 1000 条 v7 在同一毫秒内**排序是随机的** ——
  而「可按时间排序」正是 v7 相对于 v4 的全部意义。本工具改用 §6.2 的
  **Method 1（固定位长专用计数器）**：把 `rand_a` 的 12 位当计数器，同一毫秒内每生成
  一条就加一（时间戳一变就用随机值重新起头），写满 4096 条则把时间戳往前推 1 毫秒
  （§6.2 允许这么做）。代价是每条只有 62 位真随机而不是 74 位，界面上写明了这一点。
- **修复校验器放行错位的横线**。上游的正则把 `-?` 逐段可选，于是
  `123456781234-1234-1234-123456789012` 这种**不是合法 UUID 表示**的串也会被判为合法。
  现在只接受「五组标准位置」或「32 位连写」两种写法。
- **修复批量数量不校验**。上游 `Math.min(parseInt(v) || 10, 1000)`：
  清空输入框静默变回 10、填 5000 静默变 1000，界面上没有任何提示。
  改用 `T.util.readInt`（标红 + 失焦回退）。
- **修复复制没有降级**。上游裸调 `navigator.clipboard.writeText`，
  非安全上下文下会直接抛 TypeError。
- **不写 BigInt 字面量**。上游把 v1 单独拆成一个文件，理由是「用了 `10000n` 这样的字面量，
  老引擎**解析**这个文件就会失败，会连累 `uuid-generator.js`」。其实只要改用
  `BigInt(10000)` 调用形式就没有这个问题 —— 文件在任何引擎上都能解析，
  缺 BigInt 时只是运行时不可用，可以优雅降级。本项目因此把两个文件收成一个。
- 顺手把 `substr`（Annex B 的遗留 API）换成 `slice`
- 新增版本 / 变体的中文名、nil 与 max UUID 的识别、`urn:uuid:` 前缀与花括号的归一化、
  以及 v7 单调性说明
- v1 / v4 / v7 三个版本、大写 / 去横线 / 花括号三个格式开关、批量生成、校验器
  沿用上游设计

> 三处改动都写在**现行规范**上：RFC 9562（2024 年 5 月发布）取代了 RFC 4122。
> 上游的实现基本是按 RFC 4122 的习惯写的，§6.2 与 §6.10 这两条在 4122 时代
> 措辞不同，换成 9562 之后就是明确的 MUST / SHOULD。

### 16. 时间戳转换

| | |
|---|---|
| 上游文件 | `timestamp-converter/index.html`、`js/tools/timestamp-converter.js` |
| 本项目文件 | `tools/timestamp-converter/index.html`、`js/tools/timestamp-converter.js` |

改动：

- 界面文案全量中文化；上游的 `js/common.js`（`copyToClipboard` / `showToast`）未引入，
  复制改用本项目的 `data-copy-target` 全局代理，提示改用 `T.util.toast`
- 改用本项目的设计系统与组件类名，删掉上游的 CSS 依赖与内联样式

#### 修复的缺陷

判定依据是把上游的三个纯函数（`parseInput` / `relative` / `inZone`）抽出来跑边界用例，
探针脚本见 `.temporary/timestamp/probe-upstream.mjs`。下面每条都有可复现的输入。

- **19 位纳秒时间戳被当成微秒，会算出公元 56385 年。**
  上游按「位数」分档：`digits <= 11` 秒、`<= 14` 毫秒、否则一律当微秒 —— 没有纳秒档。
  实测 `1717200000000000000`（Go 的 `UnixNano()`、Rust 的 `SystemTime`、
  ClickHouse 的 `DateTime64(9)` 都是这一档）得到 `+056385-11-26T00:00:00.000Z`，
  **而且不报任何错**，用户完全看不出问题。本工具按数量级分四档，补上纳秒。
- **带小数的秒级时间戳解析不了。** 上游用 `/^-?\d+$/` 判数字，`1717200000.5`
  落到 `new Date('1717200000.5')` → Invalid Date → 报「无法解析」。
  而**同样形态**的 `1.5` 却被 V8 当日期解析成 `2001-01-04` —— 同一个写法，
  长的失败、短的给出毫无意义的结果。本工具一条正则同时接受整数与小数。
- **`+` 开头的数字解析不了。** `/^-?\d+$/` 不接受 `+1717200000`，落到 Date 解析后返回 null。
- **裸日期的时区口径没有告知。** 按 ECMAScript 规定，`2026-01-01`（只有日期）是
  **UTC 零点**，而 `2026-01-01T00:00:00`（带时间不带时区）是**本地零点**、
  `2026/01/01` 又是本地零点 —— 三个看起来差不多的写法给出两个不同的结果，
  在 UTC+8 下相差 8 小时。上游既不提示也没有开关，用户只会以为工具算错了。
  本工具在状态行标注实际采用的口径并附上对应的本地时间，另给一个
  「裸日期按本地零点解释」的开关。
- **自动判定单位的结果不告诉用户、也不允许覆盖。** 位数启发式在边界上必然有歧义
  （14 位既可能是毫秒也可能是微秒），上游既不说明也不能改。
  本工具把判定结果写进状态行（「按 19 位数字判定为「纳秒」」），
  并允许手动指定单位（自动 / 秒 / 毫秒 / 微秒 / 纳秒）。
- **清空时抹掉了 URL 末尾的斜杠。** 上游 `history.replaceState(null, '', location.pathname)`，
  而站点用的是目录式 URL（`/tools/timestamp-converter/`），这会把末尾斜杠去掉、
  多触发一次重定向。改用 `location.pathname + location.search`。
- **批量没有行数上限。** 上游一次性渲染全部行，贴几千行会卡住页面。
  本工具上限 500 行，超出时在状态行说明「输入 N 行，只处理前 500 行」。

#### 不算缺陷，但口径要写清楚

- `relative()` 用 365 天当年、30 天当月。上游没写这个口径，本工具在说明区写明了。
- 上游的 `hour12: false` 曾怀疑会在午夜产出 `24:00:00`（ICU 的 `h24` 行为）。
  **实测本机 ICU 给的是 `h23`，复现不出来，因此不列为缺陷。**
  本工具仍改用 `formatToParts` 自己拼字符串，顺带解决另一个问题：
  上游的时区行格式受 locale 影响（`en-GB` 产出 `Thu, 01 Jan 2026, 00:00:00 UTC`），
  拼接方式不可控；换成 `formatToParts` 后 `h23` / `h24` 的差异从根上不存在。

#### 新增

- 单位可手动指定，「自动」的判定结果实时可见
- 时区对照表：本地时区 + 13 个常用时区，可再加一个自定义时区
  （用 `<datalist>` 补全而不是上游那个 400 多项的 `<select>`）
- 结果行与时区行都可点复制；时区表与批量表可复制成 TSV
- `Intl.DateTimeFormat` 按时区缓存（批量转换一次要格式化几百行 × 十几个时区）

---

### 17. 文本大小写转换

| | |
|---|---|
| 上游文件 | `text-case/index.html`、`js/tools/text-case.js` |
| 本项目文件 | `tools/text-case/index.html`、`js/tools/text-case.js` |

改动：

- 界面文案全量中文化；上游的 `js/common.js`（`copyToClipboard`）未引入，
  复制改用本项目的 `data-copy-target` 全局代理（整行可点）
- 改用本项目的设计系统与组件类名（`.panel` / `.value-list` / `.value-row` / `.tool-notes`），
  10 种风格按用途拆成「命名风格」（5 种，输出单个标识符）与
  「整段文本大小写」（5 种，保留换行）两块

#### 修复的缺陷

判定依据是把上游的 `tokens` / `alternating` 与 `CASES` 里的纯函数抽出来跑边界用例，
探针脚本见 `.temporary/text-case/probe-upstream.mjs`。下面每条都有可复现的输入。

- **驼峰边界不认缩写词的尾巴（算法错误）。** 上游只做 `([a-z0-9])([A-Z])` 一遍替换，
  也就是只在「小写或数字 → 大写」处切分；缩写词内部的大写连排后面接单词时切不开：

  | 输入 | 上游结果 | 应为 |
  |---|---|---|
  | `getHTTPResponse` | `get_httpresponse` | `get_http_response` |
  | `XMLHttpRequest` | `xmlhttp_request` | `xml_http_request` |
  | `HTTPServer` | `httpserver` | `http_server` |
  | `parseHTMLString` | `parse_htmlstring` | `parse_html_string` |

  缩写混排是变量名里最常见的写法之一，转出来的标识符读不懂。本工具在它前面补一遍
  `([A-Z]+)([A-Z][a-z])` 先切缩写词的尾巴，两遍下来 `getHTTPResponse` →
  `get` + `http` + `response`。

- **非拉丁字母被静默丢弃（静默失败）。** 上游的词元字符是 `[^A-Za-z0-9]` 取反，
  其余一律当分隔符，于是 `café` → `caf`（重音字母没了）、
  `用户姓名` → 空串、`привет мир` → 空串。
  输入中文时十行结果全是空的，**界面上没有任何提示**。
  本工具保留常见非拉丁字母（拉丁扩展 / 希腊 / 西里尔 / 希伯来 / 阿拉伯 / 假名 / CJK / 韩文）
  作为词元的一部分：中文没有大小写，转出来还是原样，但不会被悄悄删掉。
  同时刻意排除 `U+00D7`（×）与 `U+00F7`（÷）—— 它们夹在拉丁扩展的码位区间里但不是字母。

- **Title Case 把撇号当成词边界。** 上游用 `/\b\w/g` 找词首，`'` 不是 `\w`，
  于是 `don't stop` → `Don'T Stop`。本工具改成扫描式，
  撇号（`'` 与 `’`）夹在字母之间时不算边界，得到 `Don't Stop`。

- **Sentence case 只认 ASCII 的 `.!?`，且首字符是引号或括号时不大写。**
  上游用 `(^\s*\w|[.!?]\s+\w)`：`^\s*\w` 要求首字符必须是 `\w`，
  所以 `"hello world"` 的首字母不会被大写。本工具改成扫描式，补上中文的 `。！？`
  与省略号 `…`，并区分中英标点 —— 英文的 `. ! ?` 要求后面有空白才算换句
  （`hello!world` 不会被拆成两句），中文标点后面通常不加空格，直接生效。

- **`aLtErNaTiNg` 的字母判断漏掉带重音的字母。** 上游用 `/[a-z]/i` 判断，
  `é` 不匹配（JS 的 ignoreCase 不会把 `[a-z]` 扩到带重音的码位），
  于是 `café` → `cAfé`（`é` 不参与交替计数）。
  本工具改成「有大小写概念的字符」才计数 —— `é` 算（`É`），中文不算，
  这样一段中文插在中间也不会把交替的节奏打乱。

- **空输入时给出十行空白结果。** 上游没有空状态，输入框为空时右侧是十行空行。
  本工具给出空状态提示；文本里只剩标点、切不出词元时，
  命名风格区单独提示「这段文本里没有可以组成标识符的字符」。

#### 不算缺陷，但口径要写清楚

- **下划线算不算词边界。** 上游用 `\b\w` 找词首，而 `_` 属于 `\w`，
  所以 `snake_case here` → `Snake_case Here`。本工具把 `_` 当分隔符
  （与 `hello-world` → `Hello-World` 的处理保持一致），得到 `Snake_Case Here`。
  两种写法都说得通，这是口径选择，不是缺陷。
- **Title Case 会先整体小写。** 所以 `HTTP` → `Http`、`iPhone` → `Iphone`。
  这是 Title Case 的通行做法（每个词首字母大写、其余小写），
  本工具在说明区写明「专有名词需要手动调回来」。

#### 新增

- 点任意一行即复制（上游是每行配一个 Copy 按钮）
- 状态行显示切出了几个词元；输入是多行时提示「已把 N 行合并成一个标识符」
- 整段大小写那组保留换行与段落结构

---

> 上游另有一套 `js/umd-guard.js` / `js/umd-unguard.js`，在加载内置库时临时屏蔽
> `define` / `module` / `exports` 全局变量，防止 UMD 加载被劫持。本项目有严格 CSP
> 且不加载任何内联脚本，未引入这套防护。

---

## 二、内置的第三方资源

包括第三方库与第三方数据文件，均自托管在 `js/vendor/`，不通过 CDN 加载。
版本、来源与校验和记录在 `js/vendor/vendor.json`。

### marked

| | |
|---|---|
| 版本 | 18.0.13 |
| 用途 | Markdown 解析（CommonMark + GFM） |
| 许可 | MIT |
| 版权 | Copyright (c) 2018-2026, MarkedJS<br>Copyright (c) 2011-2018, Christopher Jeffrey |
| 来源 | npm `marked@18.0.13` → `package/lib/marked.umd.js`<br>https://github.com/markedjs/marked |
| 文件 | `js/vendor/marked.umd.js` |
| sha256 | `b147274a9ce27d17276587167e49483d719f6893eeca3a3667a59797661d3556` |

原样使用，未做修改。文件头保留了上游的版权声明。

> 上游仓库把它存为 `marked.min.js`，但它其实是未压缩的 UMD 构建
> （npm 包里的 `lib/marked.umd.js`，45843 字节）。本项目按实际内容改名为
> `marked.umd.js`，避免误导。

### DOMPurify

| | |
|---|---|
| 版本 | 3.4.15 |
| 用途 | 净化 marked 输出的 HTML，移除脚本与事件处理器 |
| 许可 | Apache License 2.0 或 Mozilla Public License 2.0（双许可） |
| 版权 | Copyright (c) Cure53 and other contributors |
| 来源 | npm `dompurify@3.4.15` → `package/dist/purify.min.js`<br>https://github.com/cure53/DOMPurify |
| 文件 | `js/vendor/purify.min.js` |
| sha256 | `f263b05369e050fa175d4ecb9c9358eb4253602d510297adfb31df48b2f1c4d5` |

原样使用，未做修改。文件头保留了上游的许可声明。

> 注意：DOMPurify 不是 MIT 许可。若你要再分发本项目，
> 需同时遵守 Apache-2.0 / MPL-2.0 的条款（保留许可与版权声明）。

### qrcode-generator

| | |
|---|---|
| 版本 | 2.0.4 |
| 用途 | 二维码编码（九种内容类型共用） |
| 许可 | MIT |
| 版权 | Copyright (c) 2009 Kazuhiko Arase |
| 来源 | npm `qrcode-generator@2.0.4` → `package/dist/qrcode.js`<br>https://github.com/kazuhikoarase/qrcode-generator |
| 文件 | `js/vendor/qrcode.umd.js` |
| sha256 | `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c` |

原样使用，未做修改。文件头保留了上游的版权声明。

> **没有沿用上游仓库里的那份 `qrcode.min.js`（20433 字节）。** 两个原因：
>
> 1. **它删掉了 MIT 版权声明。** MIT 许可要求「在软件的所有副本中保留上述版权声明
>    和许可声明」，而那份文件被压缩到只剩一行代码，版权头一并没了。本项目的其他
>    内置库都完整保留了版权声明，这里不应该破例。
> 2. **它无法用哈希校验。** 它不是 npm 包里的任何一个文件，而是别人二次打包的产物，
>    拿不到可对比的官方校验和 —— 只能证明「两次下载结果相同」，证明不了完整性。
>
> 换成 npm 官方产物后，**逐格比对了两个版本生成的模块矩阵**：用 8 组输入
> （英文网址、中文、日文、300 字符长文本、指定版本号、纯数字、空串、不同纠错等级）
> 分别生成二维码，把两个版本输出的模块矩阵逐格对比，**8 组全部完全一致**，
> 确认上游那份只是压缩形式、逻辑没有改动。这个比对是一次性的取证，
> 结论记录在此；项目里只保留官方产物一份。

### EFF 长词表

| | |
|---|---|
| 版本 | 2016-07-18 发布的版本（内容自发布后未变） |
| 用途 | 口令短语的单词来源（密码生成器） |
| 许可 | **CC BY 3.0 US** |
| 作者 | Electronic Frontier Foundation（EFF），基于 Arnold G. Reinhold 的 Diceware 方法 |
| 来源 | https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt<br>https://www.eff.org/dice |
| 文件 | `js/vendor/eff-large-wordlist.js` |
| 原始文件 sha256 | `addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e` |
| 词列 sha256 | `6d557f0693958fb5e650b68b5bee585eb82cf4da32965505c789e924743bc522` |
| 本项目文件 sha256 | `8e5b244d4f483dff937858a68e6b35944a2507ff956d2ae1c152bb9df584c82d` |

**这是一份加工过的文件，不是原样复制。** 官方文件是 7776 行「五位掷骰编号 + TAB + 词」，
本项目只取第二列，按原顺序每行一个词放进 JS 模板字符串，再挂到
`window.TOOLBOX.wordlists.effLarge`。**没有增删、没有改序、没有改写任何一个词** ——
所以词数仍是 6⁵ = 7776，每词熵仍是 `log2(7776)` = 12.9248 比特。
逐词比对的办法见下面「三」。

> **`drop-down`、`felt-tip`、`t-shirt`、`yo-yo` 这 4 个词自带连字符**，这是官方词表的
> 既有情况，**原样保留** —— 换掉任何一个词，词数就不再是 6⁵，「每词 12.92 比特」
> 这个数也就对不上了。选连字符当分隔符时，这 4 个词会和分隔符混在一起，
> 这是这套词表固有的取舍，界面上没有掩饰。
>
> **CC BY 3.0 要求署名。** 本项目在工具页的「来源与致谢」、本文件与 `README.md` 里
> 都注明了出处与许可。若你要再分发本项目，请保留这些署名。

> 为什么不用上游自带的 `js/wordlist.js`：那份只有 529 个词，按字母序排到 `faculty`
> 就断了（首字母分布 a:100 b:98 c:152 d:91 e:85 f:3），是一份被截断的列表。
> 它的熵值算法本身没错（`log2(529)` = 9.05 比特/词），但词表不完整 ——
> 生成出来的词组全以 a–f 开头，而且「约 530 个常见英文单词」这个说明也不成立。

---

### Unihan 拼音数据

| | |
|---|---|
| 版本 | Unicode 18.0.0（`Unihan_Readings.txt` 头部标注：Date 2026-07-31、Unicode Version 18.0.0） |
| 用途 | 中文转拼音（Slug 生成工具） |
| 许可 | **Unicode License v3.0** |
| 版权 | © 2026 Unicode®, Inc. |
| 来源 | https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip<br>字段说明：https://www.unicode.org/reports/tr38/ |
| 文件 | `js/vendor/pinyin-common.js` |
| 原始文件 sha256 | `4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e` |
| 本项目文件 sha256 | `6af7da0e920944eb528c8f9644927ed7ada8c6abd3e206337135909e09bbb53d` |

**这是一份加工过的文件，不是原样复制。** 加工脚本：`.temporary/slug-generator/build-pinyin.py`。
五步：

1. 只取 `Unihan_Readings.txt` 里的 `kMandarin` 行，该文件的其他字段一概不用
2. 只保留 GB2312 能编码的汉字 —— 这是「常用汉字」的现成判据，不必自己维护字表。
   Unihan 的 kMandarin 收 44355 个码位，GB2312 范围内命中 **6763 个**（复算过：一个都没缺）
3. 去声调：`ā á ǎ à` → `a`、`ǖ ǘ ǚ ǜ` 与 `ü` → `v`（slug 惯例：绿 → `lv`）
4. 多音字取 kMandarin 的第一个读音（Unihan 按常用度排序）
5. 按拼音分组输出「拼音 汉字们」的行，共 **403 个音节**，拼音只写一次

结果 23758 字节。逐字写「字:拼音」的话约 60 KB，分组写法省了一半以上。

**许可说明**：Unicode 数据文件采用 [Unicode License v3.0](https://www.unicode.org/license.txt)，
允许使用、复制、修改与分发，要求保留版权声明。本项目在生成的文件头保留了来源与许可说明。

**Unicode 官方不发布 `Unihan.zip` 的校验和文件**（`Unihan.zip.sha256` 与 `.md5` 都返回 404），
所以完整性改用三条独立证据确认，见下面「三」。

---

## 三、如何校验内置资源

三个库都是从 npm 官方包直接提取的，词表来自 EFF 官网，`js/vendor/vendor.json` 里
记录了各自的版本、来源与 sha256。重新下载后可以这样核对：

```bash
# 下载官方包并校验 tarball 完整性（sha1 取自 registry.npmjs.org）
curl -sL https://registry.npmjs.org/marked/-/marked-18.0.13.tgz -o marked.tgz
sha1sum marked.tgz        # 应为 f642286759fcd640b29c1ea7b0d964a63afc01e3

# 取出构建产物并对比
tar -xzf marked.tgz package/lib/marked.umd.js
sha256sum package/lib/marked.umd.js js/vendor/marked.umd.js

# 语法自检（截断或损坏的文件会在这里报错）
node --check js/vendor/marked.umd.js
```

`dompurify` 与 `qrcode-generator` 同理，各自的 sha1 / 产物路径是：

```bash
# dompurify 3.4.15 → package/dist/purify.min.js
#   tarball sha1: 从 registry.npmjs.org/dompurify/3.4.15 的 dist.shasum 读取
# qrcode-generator 2.0.4 → package/dist/qrcode.js
curl -sL https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz -o qr.tgz
sha1sum qr.tgz            # 应为 e8b3f30922577eba52078aa9c0d5a2a74fe1fd94
tar -xzf qr.tgz package/dist/qrcode.js
sha256sum package/dist/qrcode.js js/vendor/qrcode.umd.js
```

### EFF 词表（数据文件，不是 npm 包）

分两步：先核对官方原件的校验和，再核对派生结果**逐词**一致。

```bash
# ① 官方原件
curl -sL https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt -o eff_large.txt
sha256sum eff_large.txt
#   应为 addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e

# ② 只取词列，单独算一次
cut -f2 eff_large.txt | sha256sum
#   应为 6d557f0693958fb5e650b68b5bee585eb82cf4da32965505c789e924743bc522

# ③ 把内置文件里的模板字符串抽出来，和官方词列逐词比对（比哈希更能定位问题）
node -e "
const fs = require('fs');
const off = fs.readFileSync('eff_large.txt', 'utf8').split('\n')
  .filter((l) => l.length).map((l) => l.split('\t')[1]);
const code = fs.readFileSync('js/vendor/eff-large-wordlist.js', 'utf8');
const mine = code.match(/effLarge = \`([\s\S]*?)\`\.split/)[1].split('\n');
console.log('官方', off.length, '内置', mine.length,
            '逐词一致:', JSON.stringify(off) === JSON.stringify(mine));
"
#   应为：官方 7776 内置 7776 逐词一致: true

node --check js/vendor/eff-large-wordlist.js
```

### Unihan 拼音数据（官方不提供校验和）

Unicode 官方**没有**发布 `Unihan.zip` 的校验和文件（`.sha256` / `.md5` 都是 404），
所以「对比官方校验和」这一条在这里走不通。改用三条互相独立的证据：

```bash
# ① 固定版本目录（内容不随 latest 漂移），与 latest 下载结果对比
curl -sL https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip -o Unihan-18.0.0.zip
curl -sL https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip -o Unihan.zip
sha256sum Unihan.zip Unihan-18.0.0.zip
#   两者应完全相同：
#   4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e

# ② ZIP 每个条目自带 CRC-32，解压时逐条校验 —— 这一步能真正排除「截断 / 损坏」
python -c "
import zipfile
with zipfile.ZipFile('Unihan.zip') as z:
    print('CRC 校验:', '全部通过' if z.testzip() is None else z.testzip())
"

# ③ 头部自描述与规模自检：版本号、日期、字段清单都在文件头里
python -c "
import zipfile
with zipfile.ZipFile('Unihan.zip') as z:
    head = z.read('Unihan_Readings.txt').decode('utf-8').splitlines()[:8]
print('\n'.join(head))
"
#   应为 Unicode Version 18.0.0 / Date 2026-07-31
```

> 第 ① 条只能证明「两个官方地址给出同一个文件」，证明不了文件本身完整 ——
> 真正起作用的是第 ② 条的 ZIP 内建 CRC-32：它能发现任何字节级损坏或截断，
> 比「再下一次比哈希」有力得多。

重新生成内置表（需要 Python 3，脚本在 `.temporary/slug-generator/`）：

```bash
python build-pinyin.py Unihan.zip ../../js/vendor/pinyin-common.js
# 输出会列出：Unihan 收录 44355 个码位 / GB2312 范围内 6763 个字 /
#            GB2312 里没有拼音的汉字 0 个 / 拼音音节 403 个，
#            并抽样核对 我 wo、你 ni、好 hao、中 zhong、绿 lv、女 nv 等
node --check js/vendor/pinyin-common.js
```

解析结果的抽样核对（在 Node 里把内置表还原成映射表再查）：

```bash
node -e "
const fs = require('fs');
const win = {};
new Function('window', fs.readFileSync('js/vendor/pinyin-common.js','utf8'))(win);
const map = Object.create(null);
win.TOOLBOX_PINYIN.data.split('\n').forEach((line) => {
  const i = line.indexOf(' '); if (i < 0) return;
  const py = line.slice(0, i);
  for (const ch of line.slice(i + 1)) map[ch] = py;
});
const want = { 我:'wo', 你:'ni', 好:'hao', 中:'zhong', 国:'guo', 绿:'lv', 女:'nv' };
let bad = 0;
for (const ch of Object.keys(want)) {
  if (map[ch] !== want[ch]) { console.log('不符:', ch, map[ch], '应为', want[ch]); bad++; }
}
console.log('条目数', Object.keys(map).length, '不符', bad);
"
#   应为：条目数 6763 不符 0
```

> 提示：直接从 CDN / raw 链接下载大文件时容易被截断。**不要**用
> 「和同一个来源再下一次对比哈希」的方式校验完整性 —— 那只能证明两次
> 下载结果相同，证明不了文件本身完整。应当对比官方发布的校验和，
> 并跑一次 `node --check`。
