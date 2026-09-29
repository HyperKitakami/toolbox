/* ==========================================================================
   registry.js — 全站唯一数据源
   --------------------------------------------------------------------------
   加一个工具 = 建目录 + 在这里加一行。首页、分类页、搜索都由这里驱动。
   status: 'ready'（已上线，可点击） | 'planned'（规划中，虚线卡片，不可点击）
   hot:    排序权重，越大越靠前（首页与分类页按此降序）
   ========================================================================== */
(function () {
  'use strict';

  /* --- 站点信息 ---------------------------------------------------------- */
  var SITE = {
    name: '工具箱',
    en: 'Toolbox',
    tagline: '本地运行 · 联网工具会标注',
    desc: '一个纯静态、零依赖的个人在线工具箱。除「AI 辅助」分类外，所有工具都在你的浏览器里运行，输入不会离开本机；需要调用外部模型的那几个必须自备 API Key，并且在页面上明确标注了会把数据发往哪里。'
  };

  /* --- 图标（24×24 线性图标，只存路径） ---------------------------------- */
  var ICONS = {
    code:     '<path d="M8.5 6 3.5 12l5 6"/><path d="M15.5 6l5 6-5 6"/>',
    shield:   '<path d="M12 3.2 19 6v6.1c0 4.4-2.9 7.4-7 8.7-4.1-1.3-7-4.3-7-8.7V6l7-2.8Z"/><path d="m9.3 12.1 1.9 1.9 3.5-3.7"/>',
    palette:  '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.8-1.7 1.7-1.7h1.3a4.7 4.7 0 0 0 4.7-4.7c0-3.7-3.8-6.6-8.5-6.6Z"/><circle cx="7.7" cy="12" r="1.1"/><circle cx="9.6" cy="8.3" r="1.1"/><circle cx="14.3" cy="7.9" r="1.1"/>',
    swap:     '<path d="M4.5 8.5h13l-3.2-3.2"/><path d="M19.5 15.5h-13l3.2 3.2"/>',
    sparkles: '<path d="M11.5 3.8l1.7 4.6 4.6 1.7-4.6 1.7-1.7 4.6-1.7-4.6L5.2 10l4.6-1.7 1.7-4.5Z"/><path d="M18 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z"/>',
    text:     '<path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h8"/>',
    search:   '<circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4.1 4.1"/>',
    ai:       '<rect x="6.5" y="6.5" width="11" height="11" rx="2.4"/><circle cx="12" cy="12" r="2.1"/><path d="M12 3.2v3.3"/><path d="M12 17.5v3.3"/><path d="M3.2 12h3.3"/><path d="M17.5 12h3.3"/>',
    bolt:     '<path d="M13.2 3 5.8 13.4h5l-.9 7.6 7.4-10.4h-5l.9-7.6Z"/>'
  };

  /* --- 分类（Hub） ------------------------------------------------------- */
  var HUBS = [
    {
      id: 'developer',
      name: '开发者',
      en: 'Developer',
      icon: 'code',
      accent: '#2f6bff',
      desc: '格式化、解析与调试类工具。处理 JSON、SQL、正则、差异对比这些每天都在打交道的活儿。',
      tags: ['JSON', 'SQL', '正则', 'Diff']
    },
    {
      id: 'security',
      name: '安全',
      en: 'Security',
      icon: 'shield',
      accent: '#e5484d',
      desc: '编码、摘要与凭据相关工具。全部在本地计算，密钥和密码不会离开你的浏览器。',
      tags: ['Base64', '哈希', 'JWT', 'TOTP']
    },
    {
      id: 'color',
      name: '颜色',
      en: 'Color',
      icon: 'palette',
      accent: '#d6409f',
      desc: '取色、格式转换与配色方案。给界面调色时的一站式辅助。',
      tags: ['HEX', 'RGB', 'HSL', '对比度']
    },
    {
      id: 'converters',
      name: '转换',
      en: 'Converters',
      icon: 'swap',
      accent: '#0d9488',
      desc: '格式与单位之间的互转。时间戳、进制、图片、数字格式。',
      tags: ['时间戳', '进制', '图片', '单位']
    },
    {
      id: 'generators',
      name: '生成器',
      en: 'Generators',
      icon: 'sparkles',
      accent: '#d97706',
      desc: '随机生成类工具。密码、UUID、二维码、测试数据，用密码学安全的随机源。',
      tags: ['密码', 'UUID', '二维码', '假数据']
    },
    {
      id: 'text',
      name: '文本',
      en: 'Text',
      icon: 'text',
      accent: '#16a34a',
      desc: '文本处理与统计。字数统计、命名风格转换、去重排序、批量替换。',
      tags: ['字数', '大小写', '去重', '替换']
    },
    {
      id: 'ai',
      name: 'AI 辅助',
      en: 'AI',
      icon: 'ai',
      accent: '#7c6af7',
      desc: '需要调用外部大模型才能完成的活儿。要自己填 API Key，输入会发送到第三方接口——本站只有这一组工具会联网，用之前请先看清数据发往哪里。',
      tags: ['大模型', 'API Key', '联网', '校对']
    }
  ];

  /* --- 工具清单 ---------------------------------------------------------- */
  /* [slug, 名称, 分类, 描述, 标签, 状态, 热度] */
  var TOOLS = [
    /* ---- 文本 ---------------------------------------------------------- */
    ['word-counter', '字数统计', 'text',
      '实时统计字符数、词数、行数、段落数与预计阅读时长，中英文混排分别计算。',
      ['字数', '统计', '阅读时长'], 'ready', 90],

    ['text-case', '文本大小写转换', 'text',
      '驼峰、帕斯卡、下划线、短横线、全大写等命名风格互转，也支持整段文本大小写。',
      ['大小写', '命名', 'camelCase', 'snake_case'], 'ready', 82],

    ['text-sort-dedupe', '文本排序去重', 'text',
      '按行排序、去重、删除空行，支持字典序、数值序与随机打乱。',
      ['排序', '去重', '行处理'], 'planned', 74],

    ['text-replace', '批量查找替换', 'text',
      '支持纯文本与正则的批量替换，替换前先给出命中预览。',
      ['替换', '正则', '批量'], 'planned', 70],

    ['whitespace-cleaner', '空白清理', 'text',
      '清除行尾空白、连续空格与多余空行，并列出文本里藏着的零宽字符、全角空格与方向控制符，每项都能单独开关。',
      ['空白', '清理', '规范化'], 'ready', 58],

    ['slug-generator', 'Slug 生成', 'text',
      '把标题转成干净的 URL 标识：中文自动转拼音（6763 个常用汉字）、标点换成统一分隔符，可选大小写与最大长度，支持逐行批量生成。',
      ['slug', 'URL', '拼音'], 'ready', 54],

    ['kcwiki-voiceline', 'KCWiki 语音台词', 'text',
      '按 wiki 的场合表逐条填写日文与中文台词，一键生成可直接粘贴的 Wikitext：内置 52 个常规与整点时报场合，支持追加自定义场合、整条标记省略与按完成度筛选，草稿自动保存在本机。',
      ['台词', 'wiki', '翻译', '模板'], 'ready', 46],

    ['line-number', '批量加行号', 'text',
      '给每行加上序号或统一的前后缀：十进制 / 十六进制 / 字母 / 罗马 / 中文七种序号格式，起始值与步长自定，可补零对齐；空行可保留、可编号、可删除，结尾换行不会被多编号一次。',
      ['行号', '前缀', '日志'], 'ready', 42],

    /* ---- 开发者 -------------------------------------------------------- */
    ['json-formatter', 'JSON 格式化', 'developer',
      '格式化、压缩与校验 JSON，带语法高亮和行号，解析失败时定位到具体行列并给出中文说明。',
      ['json', '格式化', '校验', '压缩'], 'ready', 98],

    ['diff-checker', '文本差异对比', 'developer',
      '逐行比对两段文本，高亮新增、删除与修改，支持并排与统一视图和行内字符级差异。',
      ['diff', '对比', '比对'], 'ready', 92],

    ['regex-tester', '正则表达式测试', 'developer',
      '实时高亮全部命中位置，逐字拆解表达式的含义，列出捕获分组与索引，支持替换预览与分享链接。',
      ['regex', '正则', '匹配', '分组', '替换'], 'ready', 88],

    ['sql-formatter', 'SQL 格式化', 'developer',
      '按指定方言美化 SQL，关键字自动大写、缩进对齐。',
      ['sql', '格式化', '数据库'], 'suspended', 80],

    ['markdown-preview', 'Markdown 预览', 'developer',
      '实时渲染 Markdown，生成可跳转的文档大纲，附字数与阅读时长统计，草稿自动保存在本地。',
      ['markdown', '预览', 'md', '大纲'], 'ready', 78],

    ['cron-parser', 'Cron 表达式解析', 'developer',
      '把 Cron 表达式翻译成人话，并列出未来若干次触发时间。',
      ['cron', '定时', '解析'], 'suspended', 72],

    ['yaml-formatter', 'YAML 格式化', 'developer',
      '美化与校验 YAML，支持与 JSON 双向互转。',
      ['yaml', '格式化', 'json'], 'suspended', 66],

    ['xml-formatter', 'XML 格式化', 'developer',
      '缩进美化或压缩 XML，校验标签闭合与嵌套结构。',
      ['xml', '格式化', '校验'], 'suspended', 60],

    ['csv-viewer', 'CSV 查看器', 'developer',
      '把 CSV 渲染成表格，自动探测分隔符与编码（含 GBK），支持表头识别、点击排序、分页浏览与导出 JSON / TSV。',
      ['csv', '表格', '预览', 'tsv'], 'ready', 64],

    ['json-to-typescript', 'JSON 转 TypeScript', 'developer',
      '根据 JSON 样例推导并生成 TypeScript 类型定义。',
      ['json', 'typescript', '类型'], 'suspended', 68],

    ['markdown-to-html', 'Markdown 转 HTML', 'developer',
      '把 Markdown 转成干净的语义化 HTML，支持 GFM、实时预览、Tailwind 工具类输出与一键下载。',
      ['markdown', 'html', '转换', 'gfm'], 'ready', 56],

    /* ---- 安全 ---------------------------------------------------------- */
    ['base64', 'Base64 编解码', 'security',
      '文本与文件的 Base64 互转：UTF-8 编码、URL 安全字符集、自动判定方向；解出来的字节不是 UTF-8 文本时给出十六进制字节视图，而不是一句「无效」。文件可直接拖进来转 Base64 与 Data URL。',
      ['base64', '编码', '解码', 'urlsafe', 'dataurl'], 'ready', 94],

    ['hash-generator', '哈希摘要生成', 'security',
      '一次算出 MD5、SHA-1、SHA-256、SHA-384、SHA-512 五种摘要，十六进制或 Base64 输出；文本按 UTF-8 编码，也可以直接拖一个文件进来算校验和。可粘贴一个期望的摘要反查是哪种算法（含长度推断）。本地计算，输入不上传。',
      ['hash', 'md5', 'sha256', 'sha512', '摘要', '校验和'], 'ready', 86],

    ['jwt-decoder', 'JWT 解码', 'security',
      '拆开 JWT 的头部、载荷与签名三段：载荷按 JSON 着色展开，exp / nbf / iat 换算成本机时区的时间与剩余时长，并标出 alg=none、crit、jku 这类要留神的头字段；签名只展示不校验。',
      ['jwt', 'token', '解码', '过期'], 'ready', 84],

    ['url-encoder', 'URL 编解码', 'security',
      '对网址、查询参数与组件做百分号编码或解码：组件 / 整条 URL / RFC 3986 严格三种模式同时管两个方向，空格与 + 可互转；解码失败会指出是第几个字符、哪几个字节不合法，字节按 GBK 能解时附一句推测值。附网址结构拆解（协议 / 主机 / 路径 / 查询参数 / 片段）与常用字符转义对照表。',
      ['url', '编码', '解码', 'encodeURIComponent', '百分号'], 'ready', 76],

    ['hmac-generator', 'HMAC 生成', 'security',
      '用指定密钥计算 HMAC 消息认证码，支持 SHA 系列算法。',
      ['hmac', '密钥', '签名'], 'suspended', 62],

    ['password-strength', '密码强度检测', 'security',
      '把密码拆成攻击者会怎么猜的几段（词表词、l33t 替换、键盘相邻键、重复、日期）逐段计价，取最省的拆法；与「字符集 × 长度」的上界并排给出，附五种破解场景的耗时与具体改法。不保存、不联网。',
      ['密码', '强度', '熵', '爆破'], 'ready', 60],

    ['totp-generator', 'TOTP 动态口令', 'security',
      '按 RFC 6238 从 Base32 密钥生成 6/8 位动态口令（SHA-1/256/512），带实时倒计时、otpauth 链接与可扫描的二维码。密钥严格校验，口令的全部输入（计数器、8 字节大端等）都列出来方便对照排查；密钥不保存、不联网。',
      ['totp', '2fa', '动态口令', 'otpauth', '验证码'], 'ready', 88],

    ['cert-decoder', 'X.509 证书解码', 'security',
      '解析证书的颁发者、主体、有效期、SAN 与指纹信息。',
      ['证书', 'x509', 'ssl'], 'suspended', 40],

    /* ---- 颜色 ---------------------------------------------------------- */
    ['color-converter', '颜色格式转换', 'color',
      '输入任意格式的颜色，一次得到 HEX、RGB、HSL、CMYK、HWB 五种写法，支持透明度并找出最接近的 CSS 颜色名。',
      ['hex', 'rgb', 'hsl', 'hwb', 'cmyk'], 'ready', 80],

    ['contrast-checker', '对比度检查', 'color',
      '按 WCAG 2.2 计算前景背景对比度，判定 AA / AAA 四档标准，附多字号真实预览、一键把前景色调整到达标，以及一组配色的批量检查。',
      ['对比度', 'wcag', '无障碍', '批量'], 'ready', 70],

    ['palette-generator', '调色板生成', 'color',
      '从一个主色生成互补、类似、三角等六种协调配色方案与 11 级明暗色阶，可导出 CSS 变量、SCSS、Tailwind 与 JSON。',
      ['调色板', '配色', 'palette', '色阶'], 'ready', 66],

    ['color-picker', '取色器', 'color',
      '系统取色盘与屏幕吸管取色，一键复制 HEX / RGB / HSL / CMYK，附明暗色阶与 WCAG 对比度检查。',
      ['取色', '吸管', 'hex', '对比度'], 'ready', 64],

    ['gradient-generator', '渐变生成器', 'color',
      '可视化编辑线性、径向、圆锥三种 CSS 渐变，增删色标、调角度与重复，实时预览并一键复制代码，附 10 套预设。',
      ['渐变', 'gradient', 'css', '预设'], 'ready', 58],

    ['color-blender', '颜色混合', 'color',
      '按正片叠底、滤色、叠加等 16 种混合模式计算两色叠加的结果，或生成两色之间的过渡色阶，支持 RGB / HSL 两种插值空间。',
      ['混合', 'blend', '正片叠底', '过渡色阶'], 'ready', 38],

    /* ---- 转换 ---------------------------------------------------------- */
    ['timestamp-converter', '时间戳转换', 'converters',
      'Unix 时间戳与日期双向互转，自动识别秒/毫秒/微秒/纳秒四档单位，输出 ISO 8601、RFC 1123、本地时间与相对时间，附多时区对照表与批量转换。',
      ['时间戳', 'unix', '时区', 'iso8601'], 'ready', 88],

    ['base-converter', '进制转换', 'converters',
      '二、八、十、十六进制与任意 2–36 进制互转，用 BigInt 支持任意位数的大整数，可选位宽看负数补码，附二进制分组、字节视图与位统计。',
      ['进制', '二进制', '十六进制', 'bigint'], 'ready', 68],

    ['unit-converter', '单位换算', 'converters',
      '长度、面积、体积、质量、温度、速度、数据存储、时间、角度九类单位互转，温度按函数换算，精确定义与近似值分开标注。',
      ['单位', '换算', '度量', '温度'], 'ready', 62],

    ['image-compressor', '图片压缩', 'converters',
      '在本地压缩 JPG / PNG / WebP，实时对比压缩前后体积。',
      ['图片', '压缩', 'webp'], 'suspended', 74],

    ['image-to-base64', '图片转 Base64', 'converters',
      '把图片转成 Data URL，方便直接内联进 HTML 或 CSS。',
      ['图片', 'base64', 'dataurl'], 'suspended', 56],

    ['number-formatter', '数字格式化', 'converters',
      '千分位分组（含印度式 3-2-2）、自定义小数位与取整方式、科学/工程计数法、百分比、货币与人民币大写金额，全程按十进制字符串计算不丢精度。',
      ['数字', '千分位', '格式化', '人民币大写'], 'ready', 46],

    /* ---- 生成器 -------------------------------------------------------- */
    ['password-generator', '密码生成器', 'generators',
      '按字符类别与长度批量生成强密码，也可生成 EFF 词表的口令短语，实时给出熵值、强度与离线爆破时间。',
      ['密码', '随机', '口令短语', '安全'], 'ready', 84],

    ['uuid-generator', 'UUID 生成器', 'generators',
      '批量生成 RFC 9562 的 UUID v4 / v7 / v1，v7 在同一毫秒内也按生成顺序递增，支持大写、去横线、花括号与格式校验。',
      ['uuid', 'guid', '主键', '随机'], 'ready', 78],

    ['qr-generator', '二维码生成', 'generators',
      '把网址、文本、WiFi、名片、邮件、短信、电话、WhatsApp、位置或日程生成二维码，可调纠错等级、样式与配色，支持中心 Logo 与 PNG / SVG 导出。',
      ['二维码', 'qr', 'wifi', '名片'], 'ready', 72],

    ['lorem-ipsum', '占位文本生成', 'generators',
      '生成拉丁文（Lorem ipsum）与中文的占位文本，可按段落、句子、单词或列表项输出，支持包 HTML 标签与导出 .txt。',
      ['占位', 'lorem', '假文', '排版'], 'ready', 50],

    ['random-string', '随机字符串', 'generators',
      '按指定字符集与长度批量生成随机串，适合做 ID、token 与盐值，随机源为 crypto.getRandomValues。',
      ['随机', 'token', '字符串'], 'ready', 44],

    ['mock-data', '测试数据生成', 'generators',
      '批量生成中文姓名、手机号、邮箱、地址、身份证号等假数据，字段之间自洽，可导出 CSV / JSON。',
      ['测试数据', 'mock', '假数据', '造数据'], 'ready', 48],

    /* ---- AI 辅助 ------------------------------------------------------- */
    ['whisper-verifier', '日语语音校对', 'ai',
      '校对 Whisper 的日语识别结果：整段贴进来（音频可选），交给你配置的大模型，拿回校对后的完整文本、逐词候选与把握程度；标了疑难词就只核对那几个，不标就通读全文自己找。需要自备 API Key，是站内唯一会联网的工具。',
      ['语音识别', 'whisper', '日语', '校对'], 'ready', 66]
  ];

  /* --- 组装为对象 -------------------------------------------------------- */
  var STATUS = { ready: '已上线', planned: '规划中', suspended: '已挂起' };

  var tools = TOOLS.map(function (row) {
    return {
      slug: row[0],
      name: row[1],
      hub: row[2],
      desc: row[3],
      tags: row[4] || [],
      status: row[5] || 'planned',
      hot: row[6] || 0,
      path: 'tools/' + row[0] + '/',
      statusLabel: STATUS[row[5]] || '规划中'
    };
  });

  var hubMap = {};
  HUBS.forEach(function (h) { hubMap[h.id] = h; });

  /* 每个分类下挂上工具，便于渲染 */
  HUBS.forEach(function (h) {
    h.tools = tools.filter(function (t) { return t.hub === h.id; });
    h.readyCount = h.tools.filter(function (t) { return t.status === 'ready'; }).length;
    h.totalCount = h.tools.length;
  });

  /* --- 工具函数 ---------------------------------------------------------- */
  function svg(iconKey, extraClass) {
    var inner = ICONS[iconKey] || ICONS.bolt;
    return '<svg class="' + (extraClass || '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  function readyTools() {
    return tools.filter(function (t) { return t.status === 'ready'; });
  }

  /* 会联网的工具。口径：目前只有「AI 辅助」分类下的工具会调用外部模型。
     全站「本地运行」「数据不出浏览器」这类说法都建立在这个判断上，
     以后要加会联网的工具，先想清楚它归哪个分类，再改这一处。 */
  function onlineTools() {
    return tools.filter(function (t) { return t.hub === 'ai'; });
  }

  function sortByHot(list) {
    return list.slice().sort(function (a, b) {
      if (b.hot !== a.hot) return b.hot - a.hot;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }

  window.TOOLBOX = {
    site: SITE,
    icons: ICONS,
    hubs: HUBS,
    hubMap: hubMap,
    tools: tools,
    readyTools: readyTools,
    onlineTools: onlineTools,
    sortByHot: sortByHot,
    svg: svg
  };
})();
