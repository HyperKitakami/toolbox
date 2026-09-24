/* ==========================================================================
   whisper-verifier.js — 日语语音校对（自研 · 个人工具迁移）
   --------------------------------------------------------------------------
   原型是本机一个单文件 HTML 工具（.temporary/whisper-verifier/index.html，
   2026-04-02 的版本）。这次按本站的设计系统与约定重写，功能对齐原型，
   结构、交互与容错都改掉了。改动清单：

   1. **删掉了外部字体。** 原型从 Google Fonts 引入 Syne 与 Noto Sans JP，
      是站外的一次请求。改用系统字体栈。
   2. **删掉了硬编码的深色配色。** 原型写死了 `--bg: #0e0e11` 一整套深色值，
      换到本站的 CSS 变量后才能跟深浅主题一起走。
   3. **事件一律在 JS 里绑。** 原型满屏内联 onclick（analyze / fetchModels /
      toggleFavorite / clearApiKey / removeTag…）。
   4. **修掉了 XSS。** 原型是 `innerHTML` 直接拼模型返回的字段：
      `w.reasoning`、`w.original`、`w.candidates` 都会被当成 HTML 解析 ——
      模型只要在理由里写一句 `<img src=x onerror=...>`，脚本就在你的页面上跑了。
      模型输出是**不可信输入**，现在全部走 textContent 建节点。
      （测试里有回归：往理由里塞 `<b>x</b>`，渲染出来必须是原样文本。）
   5. **拆成页面 / 脚本 / 样式三处**，不再单文件内联 1364 行。
   6. **prompt 拼装、请求体构造、响应解析都抽成纯函数。**
      不是为了好看：原型这三个环节全埋在 `analyze()` 的异步流程里，
      而 jsdom 里跑不了真实 fetch，等于核心逻辑一行都测不到。
      现在 `buildRequest()` 只返回 { url, headers, body } 不发起请求，
      测试可以直接断言「发给 Anthropic 的 body 长什么样」。
   7. **响应解析加了退让链。** 原型是
      `JSON.parse(raw.replace(/```json|```/g, '').trim())` —— 模型只要在 JSON
      前面多说一句「好的，以下是分析结果：」，整单就炸，用户拿到的是一个
      SyntaxError。现在按「原文 → 去围栏 → 截最外层花括号」逐个试。
      全都不是 JSON 时，把模型的原始输出留下来（`showRaw`），不让人两手空空。
   8. **模型返回的结构做了归一化。** 原型直接 `data.words.forEach` +
      `w.candidates.map`，模型漏一个字段就 TypeError。现在 `normalizeResult()`
      逐字段兜底，缺的补空、多的忽略，还能认 `word` / `text` / `reason`
      这类同义键名，并把 best 补进候选列表。
   9. **翻译只翻理由与整句建议，不再翻词本身。** 原型的做法是把整个 JSON
      丢回去重翻，不仅多花一次 token，还会把 `original` / `best`（本来就是要
      拿去用的日语词）一起翻掉。词是产出物，不能动。
   10. **翻译不再共用分析的 max_tokens。** 原型两个请求都是 2000 —— 翻译整份
       结果的 JSON 时会被拦腰截断，然后 JSON.parse 失败，表现是「翻译按钮
       时灵时不灵」。现在翻译单独给 8000。
   11. **Gemini 的 Key 从 URL 挪到请求头。** 原型拼 `?key=<你的Key>`，
       这个 Key 会进浏览器历史、代理日志与 Referer。改用 `x-goog-api-key`。
       同时给它加了 `responseMimeType: 'application/json'`，减少要 JSON 却
       拿到散文的概率。
   12. **localStorage 全程 try/catch + 写入防抖。** 原型在每次 input 上裸写，
       无痕模式下会抛 SecurityError 把整个脚本带崩；正常模式每敲一个字写一次。
       现在读的时候挡坏 JSON 与错类型字段，写按 400ms 合并，存不下会明说。
   13. **配置的保存提示改成常驻一行文字**，不再每次 `insertAdjacentElement`
       往 DOM 里插一个新节点、再靠 opacity 淡出。
   14. **模型列表换成原生 `<datalist>`。** 原型是「select + 过滤输入框 +
       收藏 + 刷新」四个控件，还配了一段 `alignModelButtons()` 用
       `getBoundingClientRect` 逐个算像素把按钮对齐。现在输入框挂 datalist，
       能选也能自己敲，那四个控件和那段对齐 hack 一起删掉。
   15. **砍掉了模型收藏与翻译历史。** 前者收益小（datalist 已经够用），
       后者要多一份 localStorage 状态、且原型里存进去是字符串、取出来再 parse，
       属于有 bug 的复杂度。留在 PENDING 里的想法记在这里备查。
   16. **可以不标疑难词，直接全文校对。** 之前要求「必须至少标一个词」，
       理由是「只核对你自己指出的词」—— 可实际用起来，很多时候你并不知道
       是哪个词错了，只想让模型通读一遍。现在疑难词可选：标了就只核对那几个，
       没标就走全文校对，并在 prompt 里明说「没有可疑之处就返回空数组，
       不要为了凑数硬造」。
   17. **每个候选带置信度。** 之前只给一串平铺的候选写法，谁更可信全靠
       模型把它们排个序 —— 排第 2 和第 3 到底差多少，看不出来。现在候选是
       `{ text, confidence }`，置信度归一化成 0~1 的小数（认 0.9 / 90 /
       "90%" / "高" 四种形态），在胶囊里显示成百分比并按高低着色。
   18. **翻译翻的是「校对后的文本」，不是分析结果里的字段。** 更早的版本把
       整份结果 JSON 丢回去重翻，连 best 一起翻（产出物就毁了）；中间那版
       退成只翻理由与整句建议 —— 但真正要的是「这段日语校对完是什么中文」。
       现在分析阶段就让模型产出 `corrected_text`，翻译直接送它，并且
       **只要求纯文本回复**：不再有「模型少给一个字段 → 贴回错位」这类失败，
       翻译按钮也就不会再时灵时不灵。
   19. **修了 token 预算没生效的旧账。** `TOKENS_TRANSLATE` 定义了却没被
       任何一处引用，翻译走的仍是分析的 4000 —— 上面第 10 条写下的
       「翻译单独给 8000」其实一直没兑现。现在 `buildRequest()` 收一个 token
       参数，翻译路径显式传 8000。
   ========================================================================== */
(function () {
  'use strict';

  var T = window.TOOLBOX;
  if (!T) return;

  /* --- 0. 取元素 + 依赖检查 ---------------------------------------------- */
  var keyEl         = document.getElementById('wv-key');
  var providerEl    = document.getElementById('wv-provider');
  var endpointField = document.getElementById('wv-endpoint-field');
  var endpointEl    = document.getElementById('wv-endpoint');
  var modelEl       = document.getElementById('wv-model');
  var modelHintEl   = document.getElementById('wv-model-hint');
  var modelListEl   = document.getElementById('wv-model-list');
  var modelsBtn     = document.getElementById('wv-models');
  var modelsStatus  = document.getElementById('wv-models-status');
  var saveEl        = document.getElementById('wv-save');
  var keyClearBtn   = document.getElementById('wv-key-clear');

  var dropEl        = document.getElementById('wv-drop');
  var audioEl       = document.getElementById('wv-audio');
  var audioNameEl   = document.getElementById('wv-audio-name');
  var playerEl      = document.getElementById('wv-player');
  var audioClearBtn = document.getElementById('wv-audio-clear');

  var textEl        = document.getElementById('wv-text');
  var termsEl       = document.getElementById('wv-terms');
  var termInputEl   = document.getElementById('wv-term-input');
  var contextEl     = document.getElementById('wv-context');
  var demoBtn       = document.getElementById('wv-demo');
  var resetBtn      = document.getElementById('wv-reset');
  var analyzeBtn    = document.getElementById('wv-analyze');
  var statusEl      = document.getElementById('wv-status');

  var resultEl      = document.getElementById('wv-result');
  var resultFootEl  = document.getElementById('wv-result-foot');
  var copyBtn       = document.getElementById('wv-copy');
  var translateBtn  = document.getElementById('wv-translate');
  var restoreBtn    = document.getElementById('wv-restore');
  var langEl        = document.getElementById('wv-lang');

  if (!keyEl || !textEl || !resultEl || !termsEl) return;

  /* 依赖缺失要吵，不要静默 return —— 静默退出的表现是「界面一片空白、
     控制台一行错都没有」，用户完全无从下手（详见 skill 5c）。 */
  function bail(detail) {
    var wrap = document.createElement('div');
    wrap.className = 'wv-error';
    var strong = document.createElement('strong');
    strong.textContent = '工具没能初始化';
    wrap.appendChild(strong);
    wrap.appendChild(document.createTextNode(detail));
    resultEl.parentNode.insertBefore(wrap, resultEl);
  }

  var util = T.util;
  if (!util ||
      typeof util.esc !== 'function' ||
      typeof util.debounce !== 'function' ||
      typeof util.copy !== 'function') {
    bail('页面加载到的 js/site.js 是旧版本，缺少这个工具需要的公共方法。请强制刷新（Ctrl+F5）后重试。');
    return;
  }

  /* --- 1. 常量 ------------------------------------------------------------ */

  var STORAGE_KEY = 'toolbox-whisper-verifier';
  var SAVE_DELAY = 400;
  var MAX_TERMS = 12;
  var MAX_AUDIO_MB = 15;
  /* 分析要输出「每个词的候选 + 理由」，给的预算比翻译小；
     翻译要原样吐出整份 JSON，给少了会被截断（原型的旧账，见文件头第 10 条）。 */
  var TOKENS_ANALYZE = 4000;
  var TOKENS_TRANSLATE = 8000;

  var PROVIDERS = {
    anthropic: {
      label: 'Anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      modelsUrl: 'https://api.anthropic.com/v1/models',
      defaultModel: 'claude-sonnet-4-5',
      hint: '音频走 document 块，选支持音频输入的型号（如 claude-sonnet-4-5）。'
    },
    openai: {
      label: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      modelsUrl: 'https://api.openai.com/v1/models',
      defaultModel: 'gpt-4o',
      hint: '只有带 audio 的型号才收音频（如 gpt-4o-audio-preview）；用纯文本型号时请把音频留空。'
    },
    google: {
      label: 'Google',
      url: '',
      modelsUrl: '',
      defaultModel: 'gemini-2.5-flash',
      hint: '模型名会拼进请求地址，直接填型号即可（如 gemini-2.5-flash）。'
    },
    custom: {
      label: '自定义接口',
      url: '',
      modelsUrl: '',
      defaultModel: '',
      hint: '要兼容 OpenAI 的 /chat/completions 格式；地址以 http:// 或 https:// 开头。'
    }
  };

  /* Gemini 没有列出模型的公开端点，给几个常见的当候选，用户可以自己改 */
  var GOOGLE_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];

  /* 各家的音频容器认这些 MIME；认不出来的按子类型兜底 */
  var AUDIO_FORMATS = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/ogg': 'ogg', 'audio/oga': 'ogg',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
    'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac'
  };

  var LANG_LABEL = { zh: '中文（简体）', ja: '日本語', en: 'English' };

  var DEMO = {
    text: 'この装備、ちょうどいいわね。提督、いつもありがとう。',
    terms: ['装備', '提督'],
    context: '动画台词，说话者是一位性格开朗的女性舰娘，场景在镇守府。'
  };

  /* --- 2. 小工具 ---------------------------------------------------------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** 把模型返回的任意值收拾成字符串 —— 它不保证按约定给字符串 */
  function str(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(str).filter(Boolean).join('；');
    if (typeof v === 'object') return str(v.text || v.value || v.content || v.name || '');
    return '';
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  /**
   * 取 fetch。**每次调用时现取**，不要在加载时缓存进闭包 ——
   * jsdom 里没有可用的 fetch，工具自己的测试会先把 window.fetch 换掉。
   */
  function pickFetch() {
    if (T && typeof T.fetch === 'function') return T.fetch;
    return typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  }

  /* --- 3. 纯函数（可单独断言） ------------------------------------------- */

  function audioFormat(mime) {
    if (AUDIO_FORMATS[mime]) return AUDIO_FORMATS[mime];
    var sub = String(mime || '').split('/')[1] || '';
    return sub || 'mp3';
  }

  function googleUrl(model) {
    return 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent';
  }

  /**
   * 拼分析用的 prompt。两种模式：
   *   - 标了疑难词 → 只核对用户指出的那几个（用户自己知道哪里可疑）
   *   - 一个词都没标 → 全文校对，由模型通读一遍自己找可疑处
   * 没有音频时明确告诉模型「只能凭文本判断」，让它把不确定的地方说出来 ——
   * 否则模型会假装听过音频，给出同样自信但不可靠的结论。
   * 理由和整句建议要求用简体中文写：这样读者不用再点一次「翻译」，
   * 翻译按钮就能专心做「把校对后的日语文本翻成中文」这一件事。
   */
  function buildPrompt(input) {
    var terms = input.terms || [];
    var out = [];
    out.push('你是一位日语语言学家，擅长核对语音识别（Whisper）的日语转录结果。');
    out.push('');
    out.push('## 任务');
    out.push('下面是一段 Whisper 的日语识别结果。');
    if (terms.length) {
      out.push('其中标出的词可信度存疑，请逐个核对并给出修正建议。');
    } else {
      out.push('请通读全文，自己找出所有可能听错、写错或与语境不符的词，逐个核对并给出修正建议。');
      out.push('确实没有可疑之处时就返回空的 words 数组，不要为了凑数硬造。');
    }
    if (input.hasAudio) {
      out.push('音频已经附上，请先仔细听，再结合上下文判断。');
    } else {
      out.push('这次没有音频，只能凭文本与背景说明判断 —— 请在理由里说明哪些结论把握不大。');
    }
    out.push('');
    out.push('## Whisper 转录结果');
    out.push(input.text);
    if (terms.length) {
      out.push('');
      out.push('## 需要核对的词');
      out.push(terms.map(function (t) { return '「' + t + '」'; }).join('、'));
    }
    if (input.context) {
      out.push('');
      out.push('## 背景说明');
      out.push(input.context);
    }
    out.push('');
    out.push('## 输出格式');
    out.push('只输出一个 JSON 对象，不要任何解释文字，也不要 Markdown 围栏。结构如下：');
    out.push('{');
    out.push('  "words": [');
    out.push('    {');
    out.push('      "original": "原词，照抄转录结果里的写法",');
    out.push('      "candidates": [');
    out.push('        { "text": "最可能的写法", "confidence": 0.9 },');
    out.push('        { "text": "次选写法", "confidence": 0.08 }');
    out.push('      ],');
    out.push('      "best": "最推荐的写法，必须与某个候选的 text 完全一致",');
    out.push('      "reasoning": "判断理由：音似、上下文、语法上为什么这么改。用简体中文写"');
    out.push('    }');
    out.push('  ],');
    out.push('  "corrected_text": "把转录结果按上面的推荐写法校正后的完整文本",');
    out.push('  "overall_suggestion": "整句的修正建议，用简体中文写"');
    out.push('}');
    out.push('');
    out.push('几点要求：');
    out.push('- confidence 是 0 到 1 之间的小数，表示你对这个候选的把握；' +
      '同一个词的候选按把握从大到小排列，最多 4 个。');
    out.push('- corrected_text 只改需要改的地方，其余原样保留，不要增删内容；' +
      '一个字都不用改时就原样返回。');
    out.push('- 原词与候选都保持日语原样，不要翻译；只有 reasoning 与 overall_suggestion 用简体中文。');
    return out.join('\n');
  }

  /**
   * 构造一次请求，**不发起**。返回 { url, headers, body }。
   * 抽出来的意义：真实 fetch 在 jsdom 里跑不了，但请求长什么样可以在测试里断言。
   * tokens 不传就用分析档；翻译要吐整段译文，得显式传 TOKENS_TRANSLATE
   * （旧版把这个常量定义了却没用上，翻译一直挤在 4000 里，见文件头第 19 条）。
   */
  function buildRequest(cfg, prompt, audio, tokens) {
    var provider = cfg.provider;
    var model = cfg.model;
    var budget = tokens || TOKENS_ANALYZE;

    if (provider === 'anthropic') {
      var content = [];
      if (audio) {
        content.push({ type: 'text', text: '先听这段音频，再核对下面的词。' });
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: audio.mime, data: audio.data }
        });
      }
      content.push({ type: 'text', text: prompt });
      return {
        url: PROVIDERS.anthropic.url,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: {
          model: model,
          max_tokens: budget,
          messages: [{ role: 'user', content: content }]
        }
      };
    }

    if (provider === 'google') {
      var parts = [];
      if (audio) parts.push({ inlineData: { mimeType: audio.mime, data: audio.data } });
      parts.push({ text: prompt });
      return {
        url: googleUrl(model),
        headers: {
          'Content-Type': 'application/json',
          /* 原型把 key 拼在 query 里（?key=...），会进历史与日志；改用请求头 */
          'x-goog-api-key': cfg.key
        },
        body: {
          contents: [{ parts: parts }],
          generationConfig: {
            maxOutputTokens: budget,
            responseMimeType: 'application/json'
          }
        }
      };
    }

    /* openai 与自定义接口共用 /chat/completions 的形状 */
    var userContent = [];
    if (audio) {
      userContent.push({
        type: 'input_audio',
        input_audio: { data: audio.data, format: audioFormat(audio.mime) }
      });
    }
    userContent.push({ type: 'text', text: prompt });
    return {
      url: provider === 'custom' ? cfg.endpoint : PROVIDERS.openai.url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: {
        model: model,
        max_tokens: budget,
        messages: [{ role: 'user', content: userContent }]
      }
    };
  }

  /** 从各家形态不同的响应里取出那一段文本 */
  function pickText(provider, data) {
    if (!data || typeof data !== 'object') return '';
    if (provider === 'anthropic') {
      return (data.content || []).map(function (b) {
        return b && typeof b.text === 'string' ? b.text : '';
      }).join('');
    }
    if (provider === 'google') {
      var cand = (data.candidates || [])[0] || {};
      var parts = (cand.content && cand.content.parts) || [];
      return parts.map(function (p) {
        return p && typeof p.text === 'string' ? p.text : '';
      }).join('');
    }
    var choice = (data.choices || [])[0] || {};
    var msg = choice.message || {};
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.map(function (p) { return (p && p.text) || ''; }).join('');
    }
    if (typeof choice.text === 'string') return choice.text;
    return '';
  }

  /**
   * 从模型输出里挖出 JSON。三种形态逐个试，全失败才认输。
   * 原型只有第一种的简化版，模型多说一句客套话就整单失败（见文件头第 7 条）。
   */
  function extractJson(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return { ok: false, reason: '模型没有返回任何内容。' };

    var tries = [text];

    var fenced = text.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '').replace(/\r?\n?[ \t]*```$/, '').trim();
    if (fenced && fenced !== text) tries.push(fenced);

    var from = text.indexOf('{');
    var to = text.lastIndexOf('}');
    if (from >= 0 && to > from) {
      var sliced = text.slice(from, to + 1);
      if (tries.indexOf(sliced) < 0) tries.push(sliced);
    }

    for (var i = 0; i < tries.length; i++) {
      try {
        var parsed = JSON.parse(tries[i]);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { ok: true, data: parsed };
        }
      } catch (e) { /* 换下一种形态再试 */ }
    }
    return { ok: false, reason: '模型的回答不是合法 JSON。' };
  }

  /* 模型不保证给数字，常见的还有「高 / 中 / 低」这种档位词 */
  var CONF_WORDS = {
    'certain': 0.95, 'very high': 0.95, 'high': 0.9, 'medium': 0.6, 'mid': 0.6,
    'low': 0.3, 'very low': 0.15,
    '确定': 0.95, '很高': 0.95, '高': 0.9, '较高': 0.85, '中': 0.6, '中等': 0.6,
    '较低': 0.35, '低': 0.3, '很可能': 0.85, '可能': 0.6, '不确定': 0.3
  };

  /**
   * 把模型给的置信度收拾成 0~1 的小数，`null` 表示它没给。
   * 四种形态都要认：0.9 / 90 / "90%" / "高"。
   * 认不出的宁可返回 null（界面就不显示这个百分比），也不要猜一个数字 ——
   * 置信度是给人做判断用的，编一个出来比不显示更糟。
   */
  function normalizeConfidence(v) {
    if (v == null || v === '') return null;

    if (typeof v === 'number' && isFinite(v)) {
      var n = v > 1 ? (v <= 100 ? v / 100 : null) : v;
      if (n == null) return null;
      return n < 0 ? 0 : (n > 1 ? 1 : n);
    }

    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      var pct = s.match(/^([0-9]*\.?[0-9]+)\s*%$/);
      if (pct) return normalizeConfidence(parseFloat(pct[1]));
      if (/^[0-9]*\.?[0-9]+$/.test(s)) return normalizeConfidence(parseFloat(s));
      var lower = s.toLowerCase();
      if (CONF_WORDS[lower] != null) return CONF_WORDS[lower];
      if (CONF_WORDS[s] != null) return CONF_WORDS[s];
    }
    return null;
  }

  /** 置信度的三档，只用来着色（≥80% 高 / ≥50% 中 / 其余低） */
  function confLevel(v) {
    if (v == null) return '';
    if (v >= 0.8) return 'is-high';
    if (v >= 0.5) return 'is-mid';
    return 'is-low';
  }

  /** 显示成百分比；没给置信度就返回空串，胶囊里就不加那个角标 */
  function confLabel(v) {
    return v == null ? '' : Math.round(v * 100) + '%';
  }

  /**
   * 把模型给的结构收拾成 { corrected, correctedGiven, words, overall }。
   * 它可能漏字段、改键名、把 best 写在候选之外、候选给成字符串，甚至返回一个数组
   * —— 都不该让页面崩。
   * sourceText 是用户贴进去的转录原文：模型没给 corrected_text 时拿它兜底，
   * 这样「翻译」永远有输入（否则模型一偷懒，翻译按钮就变成哑的）。
   * 但同时记下 correctedGiven —— 兜底和「模型真的校对过」是两件事，
   * 界面要照实说，不能让人以为模型确认过「无需修改」。
   */
  function normalizeResult(data, sourceText) {
    var words = [];
    var list = data && Array.isArray(data.words) ? data.words :
               (data && Array.isArray(data.result) ? data.result : []);

    list.forEach(function (w) {
      if (!w || typeof w !== 'object') return;
      var original = str(w.original || w.word || w.text || w.from);
      var best = str(w.best || w.best_guess || w.suggestion || w.recommended);
      var candidates = [];

      /* 候选可能是字符串，也可能是 { text, confidence }（键名还可能是别的）。
         置信度键名认 confidence / score / prob / probability 四种。 */
      function pushCandidate(item) {
        var text = '';
        var conf = null;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          text = str(item.text || item.value || item.word || item.candidate || item.content);
          var raw = item.confidence != null ? item.confidence
            : (item.score != null ? item.score
            : (item.probability != null ? item.probability : item.prob));
          conf = normalizeConfidence(raw);
        } else {
          text = str(item);
        }
        if (!text) return;
        if (candidates.some(function (c) { return c.text === text; })) return;
        candidates.push({ text: text, confidence: conf });
      }

      if (Array.isArray(w.candidates)) w.candidates.forEach(pushCandidate);
      if (Array.isArray(w.options)) w.options.forEach(pushCandidate);

      if (best && !candidates.some(function (c) { return c.text === best; })) {
        candidates.unshift({ text: best, confidence: null });
      }
      var reasoning = str(w.reasoning || w.reason || w.explanation || w.analysis);

      if (!original && !best && !candidates.length && !reasoning) return;
      words.push({ original: original, candidates: candidates, best: best, reasoning: reasoning });
    });

    var corrected = str(data && (data.corrected_text || data.correctedText || data.corrected ||
      data.corrected_transcript || data.transcript));

    return {
      corrected: corrected || str(sourceText),
      correctedGiven: !!corrected,
      words: words,
      overall: str(data && (data.overall_suggestion || data.overall || data.summary || data.suggestion))
    };
  }

  function resultPlainText(result) {
    var out = [];
    if (result.corrected) {
      out.push('校对后的文本：');
      out.push(result.corrected);
      out.push('');
    }
    result.words.forEach(function (w) {
      var arrow = w.best || (w.candidates[0] && w.candidates[0].text) || '（没有建议）';
      out.push((w.original || '（未给出原词）') + ' → ' + arrow);
      if (w.candidates.length > 1) {
        out.push('候选：' + w.candidates.map(function (c) {
          var pct = confLabel(c.confidence);
          return c.text + (pct ? '（' + pct + '）' : '');
        }).join(' / '));
      }
      if (w.reasoning) out.push('理由：' + w.reasoning);
      out.push('');
    });
    if (result.overall) {
      out.push('整体建议：');
      out.push(result.overall);
    }
    return out.join('\n').trim();
  }

  /**
   * 翻译的是**校对后的文本**，不是分析结果里的一堆字段（见文件头第 18 条）。
   * 关键在「只要求纯文本回复」：不再要 JSON，就不会有「模型少返回一个字段
   * 导致译文贴回错位」——那正是上一版翻译时灵时不灵的原因。
   */
  function buildTranslatePrompt(text, langLabel) {
    return '把下面这段日语翻译成' + langLabel + '。' +
      '只输出译文本身：不要解释、不要加引号、不要 Markdown 围栏、不要保留日文对照。\n\n' +
      text;
  }

  /** 译文可能被围栏或一对引号包着，剥掉外层；正文一个字不动 */
  function extractTranslation(raw) {
    var text = String(raw == null ? '' : raw).trim();
    text = text.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '').replace(/\r?\n?[ \t]*```$/, '').trim();
    var quoted = text.match(/^["“]([\s\S]*)["”]$/);
    if (quoted && quoted[1].indexOf('"') < 0 && quoted[1].indexOf('“') < 0) {
      text = quoted[1].trim();
    }
    return text;
  }

  function errorMessage(status, data) {
    var detail = '';
    if (data && typeof data === 'object') {
      if (data.error && typeof data.error === 'object') {
        detail = str(data.error.message) || str(data.error.type);
      }
      if (!detail) detail = str(data.error);
      if (!detail) detail = str(data.message) || str(data.detail);
    }
    var base = '接口返回 HTTP ' + status;
    if (status === 401 || status === 403) base = 'Key 被拒了（HTTP ' + status + '）';
    else if (status === 404) base = '地址或模型名不对（HTTP 404）';
    else if (status === 413) base = '内容太大，多半是音频过长（HTTP 413）';
    else if (status === 429) base = '请求太频繁，或者额度用完了（HTTP 429）';
    else if (status >= 500) base = '对方服务出错（HTTP ' + status + '）';
    return base + (detail ? '：' + detail : '');
  }

  /* --- 4. 配置读写（全程兜底，见文件头第 12 条） ------------------------- */

  function readConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      var provider = typeof data.provider === 'string' &&
        Object.prototype.hasOwnProperty.call(PROVIDERS, data.provider) ? data.provider : null;
      return {
        key: typeof data.key === 'string' ? data.key : '',
        provider: provider,
        model: typeof data.model === 'string' ? data.model : '',
        endpoint: typeof data.endpoint === 'string' ? data.endpoint : ''
      };
    } catch (e) {
      return null;
    }
  }

  function writeConfig() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig()));
      return true;
    } catch (e) {
      return false;
    }
  }

  function currentConfig() {
    return {
      key: keyEl.value.trim(),
      provider: providerEl.value,
      model: modelEl.value.trim(),
      endpoint: endpointEl.value.trim()
    };
  }

  function flashSaved(msg) {
    if (!saveEl) return;
    saveEl.textContent = msg;
    saveEl.classList.add('is-visible');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function () {
      saveEl.classList.remove('is-visible');
    }, 1800);
  }

  var saveSoon = util.debounce(function () {
    if (!writeConfig()) {
      flashSaved('配置存不进本机（可能是无痕模式）');
      return;
    }
    flashSaved('配置已保存到本机');
  }, SAVE_DELAY);

  /* --- 5. 状态 ------------------------------------------------------------ */

  var state = {
    terms: [],
    audio: null,          /* { data: base64, mime, name, size } */
    audioUrl: null,       /* 试听用的 objectURL，切文件时要 revoke */
    result: null,         /* { corrected, correctedGiven, words, overall } */
    translated: null,     /* { text, lang } —— 校对后文本的译文 */
    showing: 'origin',    /* origin | translated */
    busy: false,
    lastProvider: 'anthropic'
  };

  /* --- 6. 渲染 ------------------------------------------------------------ */

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'tool-status' + (kind ? ' is-' + kind : '');
  }

  function setModelsStatus(msg, kind) {
    modelsStatus.textContent = msg || '';
    modelsStatus.className = 'tool-status' + (kind ? ' is-' + kind : '');
  }

  function setResultFoot(msg) {
    resultFootEl.textContent = msg || '—';
  }

  /** 底栏在分析完成后该写什么。抽出来是因为翻译失败时要把这行恢复回去 */
  function resultFootText(result) {
    if (!result) return '—';
    var parts = [];
    if (result.correctedGiven) parts.push('含校对后文本');
    parts.push(result.words.length ? result.words.length + ' 个词' : '未发现可疑词');
    if (result.overall) parts.push('含整句建议');
    if (state.audio) parts.push('已附音频');
    return parts.join(' · ');
  }

  function focusField(node) {
    if (node && typeof node.focus === 'function') node.focus();
  }

  function showEmptyResult() {
    clearNode(resultEl);
    var box = el('div', 'wv-result-empty');
    box.appendChild(el('strong', null, '还没有结果'));
    box.appendChild(document.createTextNode(
      '填好左侧信息，点「开始分析」。模型会给出校对后的文本与逐词建议 —— ' +
      '不标疑难词就按全文校对。'));
    resultEl.appendChild(box);
    state.result = null;
    state.translated = null;
    state.showing = 'origin';
    syncTranslateControls();
  }

  function showLoading(msg) {
    clearNode(resultEl);
    var box = el('div', 'wv-loading');
    box.appendChild(el('span', 'wv-spinner'));
    box.appendChild(el('span', null, msg));
    resultEl.appendChild(box);
    setResultFoot('请求进行中…');
  }

  function showError(msg) {
    clearNode(resultEl);
    var box = el('div', 'wv-error');
    box.appendChild(el('strong', null, '没能拿到结果'));
    box.appendChild(el('p', null, msg));
    box.appendChild(el('p', 'wv-error-tip',
      '常见原因：Key 不对、模型名拼错、这个模型不收音频、网络被拦或跨域被拒。'));
    resultEl.appendChild(box);
    setResultFoot('请求失败');
  }

  /** 解析不出 JSON 时留底：把模型的原文原样摆出来，别让人白等一场 */
  function showRaw(raw, reason) {
    clearNode(resultEl);
    var box = el('div', 'wv-error');
    box.appendChild(el('strong', null, '模型的回答没按格式来'));
    box.appendChild(el('p', null, reason + ' 下面是它的原文，可以自己看，也可以直接重试。'));
    var pre = el('pre', 'wv-raw', raw || '（空）');
    box.appendChild(pre);
    resultEl.appendChild(box);
    setResultFoot('已保留原始输出');
  }

  function buildWordCard(w) {
    var card = el('div', 'wv-word');

    var head = el('div', 'wv-word-head');
    head.appendChild(el('span', 'wv-word-original', w.original || '（未给出原词）'));
    if (w.best) {
      head.appendChild(el('span', 'wv-word-arrow', '→'));
      head.appendChild(el('span', 'wv-word-best', w.best));
    }
    card.appendChild(head);

    if (w.candidates.length) {
      var list = el('div', 'wv-cands');
      w.candidates.forEach(function (c) {
        var chip = el('span', 'wv-cand' + (c.text === w.best ? ' is-best' : '') +
          (c.confidence != null ? ' ' + confLevel(c.confidence) : ''));
        chip.appendChild(el('span', 'wv-cand-text', c.text));
        var pct = confLabel(c.confidence);
        if (pct) {
          chip.appendChild(el('span', 'wv-conf', pct));
          chip.setAttribute('title', '模型的把握：' + pct);
        }
        list.appendChild(chip);
      });
      card.appendChild(list);
    }

    if (w.reasoning) card.appendChild(el('p', 'wv-reason', w.reasoning));
    return card;
  }

  /**
   * 「校对后的文本」那块。摆在结果区最上面 —— 它是这个工具最主要的产品，
   * 也是「翻译」的输入。模型没单独给出来时说清楚，别让人误以为它确认过「无需修改」。
   */
  function buildCorrectedBlock(result) {
    var block = el('div', 'wv-corrected');
    var head = el('div', 'wv-corrected-head');
    head.appendChild(el('h3', null, '校对后的文本'));
    if (!result.correctedGiven) {
      head.appendChild(el('span', 'wv-corrected-note', '模型没单独给出，这是你贴进来的原文'));
    }
    block.appendChild(head);
    block.appendChild(el('p', 'wv-corrected-text', result.corrected));
    return block;
  }

  function renderResult(result) {
    clearNode(resultEl);
    if (result.corrected) resultEl.appendChild(buildCorrectedBlock(result));

    if (!result.words.length && !result.overall) {
      resultEl.appendChild(el('div', 'wv-result-empty', result.correctedGiven
        ? '通读了一遍，没有发现需要改动的词。'
        : '模型这次没给出任何可用的条目，可以补上背景说明再试一次。'));
      return;
    }

    result.words.forEach(function (w) {
      resultEl.appendChild(buildWordCard(w));
    });
    if (result.overall) {
      var block = el('div', 'wv-overall');
      block.appendChild(el('h3', null, '整体建议'));
      block.appendChild(el('p', null, result.overall));
      resultEl.appendChild(block);
    }
  }

  /** 译文视图：整块就是译文本身，不再混着词卡 */
  function renderTranslation(tr) {
    clearNode(resultEl);
    var block = el('div', 'wv-transcript');
    block.appendChild(el('h3', null, '译文 · ' + tr.lang));
    block.appendChild(el('p', 'wv-transcript-text', tr.text));
    block.appendChild(el('p', 'wv-transcript-note', '译自「校对后的文本」，可以点「看原文」切回去。'));
    resultEl.appendChild(block);
  }

  function syncTranslateControls() {
    /* 翻译的输入是校对后的文本，有它就能翻 */
    var canTranslate = !!(state.result && state.result.corrected);
    translateBtn.disabled = !canTranslate || state.busy;

    /* 是否是「译文视图」要看实际拿得到译文没有 —— showing 是意图，translated 才是事实。
       两者不同步时（新结果把译文清了）以事实为准，否则会给一份不存在的译文加标记。 */
    var translatedView = state.showing === 'translated' && !!state.translated;

    /* 只要译文还在，切换按钮就一直在，文案跟着当前视图走。
       早前是「不在译文视图就藏起来」，于是点一次「看原文」按钮自己消失，
       译文再也回不去，只能重新点一次「翻译」再花一次请求 —— 修的就是这个。
       按钮归按钮，重新翻译归「翻译」按钮，两件事别混。 */
    restoreBtn.hidden = !state.translated;
    restoreBtn.textContent = translatedView ? '看原文' : '看译文';

    copyBtn.disabled = translatedView ? !state.translated : !state.result;
    resultEl.classList.toggle('is-translated', translatedView);
  }

  function paintResult() {
    /* showing 可能停在 'translated' 但译文已经没了（重新分析过），先归位 */
    if (state.showing === 'translated' && !state.translated) state.showing = 'origin';

    if (state.showing === 'translated') {
      renderTranslation(state.translated);
      /* 底栏跟着视图走 —— 否则切回原文后还挂着「译文 · 中文」，跟内容对不上 */
      setResultFoot('译文 · ' + state.translated.lang);
      syncTranslateControls();
      return;
    }
    if (!state.result) { showEmptyResult(); return; }
    renderResult(state.result);
    setResultFoot(resultFootText(state.result));
    syncTranslateControls();
  }

  /* --- 7. 疑难词标签 ------------------------------------------------------ */

  function renderTerms() {
    var chips = termsEl.querySelectorAll('.wv-term');
    Array.prototype.forEach.call(chips, function (c) {
      if (c.parentNode) c.parentNode.removeChild(c);
    });
    state.terms.forEach(function (t, i) {
      var chip = el('span', 'wv-term');
      chip.appendChild(document.createTextNode(t));
      var del = el('button', 'wv-term-del', '×');
      del.type = 'button';
      del.setAttribute('data-term-index', String(i));
      del.setAttribute('aria-label', '删除「' + t + '」');
      chip.appendChild(del);
      termsEl.insertBefore(chip, termInputEl);
    });
  }

  function addTerm(raw) {
    var word = String(raw || '').trim();
    if (!word) return false;
    if (state.terms.indexOf(word) >= 0) {
      setStatus('「' + word + '」已经在列表里了。', 'warn');
      return false;
    }
    if (state.terms.length >= MAX_TERMS) {
      setStatus('一次最多标 ' + MAX_TERMS + ' 个词，再多每个词分到的分析会很浅。', 'warn');
      return false;
    }
    state.terms.push(word);
    renderTerms();
    setStatus('已加入 ' + state.terms.length + ' 个词。', 'ok');
    return true;
  }

  function removeTermAt(i) {
    if (i < 0 || i >= state.terms.length) return;
    state.terms.splice(i, 1);
    renderTerms();
    setStatus(state.terms.length ? '还有 ' + state.terms.length + ' 个词待核对。' : '', '');
  }

  /* --- 8. 音频 ------------------------------------------------------------ */

  function clearAudio(silent) {
    state.audio = null;
    try { audioEl.value = ''; } catch (e) { /* 某些环境不允许改 value */ }
    if (playerEl) {
      try { playerEl.pause(); } catch (e) { /* 没在播就算了 */ }
      playerEl.src = '';
      playerEl.hidden = true;
    }
    if (state.audioUrl) {
      try { URL.revokeObjectURL(state.audioUrl); } catch (e) { /* 没这个 API 就算了 */ }
      state.audioUrl = null;
    }
    if (audioNameEl) audioNameEl.textContent = '';
    if (audioClearBtn) audioClearBtn.hidden = true;
    if (!silent) setStatus('音频已移除，这次只按文本判断。', '');
  }

  function acceptAudio(file) {
    if (!file) return;
    if (!/^audio\//i.test(file.type || '')) {
      setStatus('这个文件不是音频（' + (file.type || '未知类型') + '）。', 'error');
      return;
    }
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
      setStatus('音频有 ' + formatSize(file.size) + '，超过 ' + MAX_AUDIO_MB +
        'MB 上限 —— 接口多半会拒收，剪短一点再传。', 'error');
      return;
    }

    /* 试听用的 objectURL。jsdom 没有这个 API，预览失败不能影响分析，
       所以整段包在 try 里（读 base64 是另一条路，见下面的 FileReader）。 */
    if (playerEl) {
      try {
        if (typeof URL.createObjectURL === 'function') {
          if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
          state.audioUrl = URL.createObjectURL(file);
          playerEl.src = state.audioUrl;
          playerEl.hidden = false;
        }
      } catch (e) { /* 预览不了不影响后面的分析 */ }
    }

    if (typeof FileReader !== 'function') {
      setStatus('这个浏览器没有 FileReader，读不出音频内容 —— 可以先把音频留空，只按文本判断。', 'error');
      return;
    }

    var reader = new FileReader();
    reader.onload = function (ev) {
      var result = ev && ev.target ? String(ev.target.result || '') : '';
      var comma = result.indexOf(',');
      if (comma < 0) {
        setStatus('音频读出来是空的，换一个文件试试。', 'error');
        return;
      }
      state.audio = {
        data: result.slice(comma + 1),
        mime: file.type || 'audio/mpeg',
        name: file.name || '音频',
        size: file.size || 0
      };
      if (audioNameEl) {
        audioNameEl.textContent = (file.name || '音频') + ' · ' + formatSize(file.size) +
          ' · 会随请求一起发出去';
      }
      if (audioClearBtn) audioClearBtn.hidden = false;
      setStatus('音频已就位，分析时会一并发送。', 'ok');
    };
    reader.onerror = function () {
      setStatus('这个文件读不出来（可能已损坏或被占用）。', 'error');
    };
    reader.readAsDataURL(file);
  }

  /* --- 9. 网络 ------------------------------------------------------------ */

  function doPost(req) {
    /* 整条链都放进 Promise 里。某些环境会**同步**抛错（CSP 拦下请求、
       fetch 被扩展覆写、参数非法），那样异常会直接穿出调用方，
       走不到下面的 .catch —— 表现是 state.busy 卡在 true、按钮永久禁用、
       结果区一直停在「正在分析」。所以第一步就用 Promise.resolve().then 包住。 */
    return Promise.resolve().then(function () {
      var send = pickFetch();
      if (typeof send !== 'function') {
        throw new Error('当前环境没有可用的 fetch，发不出请求。');
      }
      return send(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body)
      });
    }).then(function (resp) {
      return Promise.resolve()
        .then(function () { return resp.json(); })
        .catch(function () { return null; })
        .then(function (data) {
          if (!resp.ok) throw new Error(errorMessage(resp.status, data));
          if (!data) throw new Error('接口返回的不是 JSON，可能被网关或代理拦下了。');
          return data;
        });
    });
  }

  /* --- 10. 分析 ----------------------------------------------------------- */

  function validate() {
    if (!keyEl.value.trim()) return { field: keyEl, msg: '先填 API Key。' };
    if (!providerEl.value || !PROVIDERS[providerEl.value]) {
      return { field: providerEl, msg: '选一个服务商。' };
    }
    if (!modelEl.value.trim()) return { field: modelEl, msg: '先填模型名，或者点「拉取可用模型」挑一个。' };
    if (!textEl.value.trim()) return { field: textEl, msg: '把 Whisper 的转录结果贴进来。' };
    /* 疑难词是**可选**的：空着就走全文校对，由模型自己找可疑处 */
    if (providerEl.value === 'custom' && !/^https?:\/\/\S+$/i.test(endpointEl.value.trim())) {
      return { field: endpointEl, msg: '自定义接口地址要以 http:// 或 https:// 开头。' };
    }
    return null;
  }

  function runAnalyze() {
    if (state.busy) return;
    var problem = validate();
    if (problem) {
      setStatus(problem.msg, 'error');
      focusField(problem.field);
      return;
    }

    var sourceText = textEl.value.trim();
    var cfg = currentConfig();
    var prompt = buildPrompt({
      text: sourceText,
      terms: state.terms.slice(),
      context: contextEl.value.trim(),
      hasAudio: !!state.audio
    });
    var req = buildRequest(cfg, prompt, state.audio);

    state.busy = true;
    analyzeBtn.disabled = true;
    setStatus(state.terms.length
      ? '正在请求 ' + PROVIDERS[cfg.provider].label + '，音频越大等得越久…'
      : '正在请求 ' + PROVIDERS[cfg.provider].label + ' 做全文校对，音频越大等得越久…', '');
    showLoading(state.terms.length ? '正在分析…' : '正在通读全文…');
    syncTranslateControls();

    doPost(req).then(function (data) {
      var raw = pickText(cfg.provider, data);
      var parsed = extractJson(raw);
      if (!parsed.ok) {
        showRaw(raw, parsed.reason);
        setStatus('模型没按 JSON 格式回答，原文已留在右边。', 'warn');
        return;
      }
      /* sourceText 用来兜底 corrected_text：模型没给就退回用户的原文，
         翻译按钮不至于因此变成哑的 */
      var result = normalizeResult(parsed.data, sourceText);
      if (!result.words.length && !result.overall && !result.correctedGiven) {
        showRaw(raw, '返回的 JSON 里没有能认出来的字段。');
        setStatus('模型返回的 JSON 是空的，可以补上背景说明再试。', 'warn');
        return;
      }
      state.result = result;
      state.translated = null;
      state.showing = 'origin';
      paintResult();   /* 底栏由 paintResult 统一按视图设置 */
      setStatus('分析完成。', 'ok');
    }).catch(function (err) {
      showError(err && err.message ? err.message : String(err));
      setStatus('这次请求没成功，右边写了原因。', 'error');
    }).then(function () {
      state.busy = false;
      analyzeBtn.disabled = false;
      syncTranslateControls();
    });
  }

  /* --- 11. 翻译 ----------------------------------------------------------- */

  function runTranslate() {
    if (state.busy || !state.result) return;

    var cfg = currentConfig();
    var problem;
    /* 翻译不需要转录文本与疑难词，只需要能连通接口 */
    if (!keyEl.value.trim()) problem = { field: keyEl, msg: '先填 API Key 才能翻译。' };
    else if (!modelEl.value.trim()) problem = { field: modelEl, msg: '先填模型名才能翻译。' };
    else if (cfg.provider === 'custom' && !/^https?:\/\/\S+$/i.test(cfg.endpoint)) {
      problem = { field: endpointEl, msg: '自定义接口地址要以 http:// 或 https:// 开头。' };
    }
    if (problem) {
      setStatus(problem.msg, 'error');
      focusField(problem.field);
      return;
    }

    /* 翻的是校对后的文本 —— 原词与候选是产出物，不能翻 */
    var source = state.result.corrected || state.result.overall;
    if (!source) {
      setStatus('这次的结果里没有可翻译的文本。', 'warn');
      return;
    }

    var target = langEl.value;
    var label = LANG_LABEL[target] || target;
    var prompt = buildTranslatePrompt(source, label);
    /* 翻译只发文字，不带音频 —— 音频对翻译没有帮助，白花一次上传。
       token 预算要显式给翻译档：译文比分析结果长。 */
    var req = buildRequest(cfg, prompt, null, TOKENS_TRANSLATE);

    state.busy = true;
    translateBtn.disabled = true;
    /* 翻译**不动结果区**：校对结果还没看完呢，转个圈就把它清掉太粗暴。
       进度写在状态栏与底栏，结果区等真拿到译文再整块换。 */
    setStatus('正在把校对后的文本翻译成' + label + '…', '');
    setResultFoot('正在翻译成' + label + '…');

    doPost(req).then(function (data) {
      var text = extractTranslation(pickText(cfg.provider, data));
      if (!text) {
        setResultFoot(resultFootText(state.result));
        setStatus('没拿到译文 —— 模型这次没有返回文本。校对结果还在，可以直接重试。', 'warn');
        return;
      }
      state.translated = { text: text, lang: label };
      state.showing = 'translated';
      paintResult();   /* 底栏与切换按钮都由 paintResult 统一按视图设置 */
      setStatus('已翻译成' + label + '，点「看原文」可以切回去。', 'ok');
    }).catch(function (err) {
      /* 翻译失败**不碰结果区**：校对结果还等着看呢，别为了报个错把人家的结果冲掉 */
      setResultFoot(resultFootText(state.result));
      setStatus('翻译没成功：' + (err && err.message ? err.message : String(err)), 'error');
    }).then(function () {
      state.busy = false;
      analyzeBtn.disabled = false;
      syncTranslateControls();
    });
  }

  /* --- 12. 模型列表 ------------------------------------------------------- */

  function fillModelList(models) {
    clearNode(modelListEl);
    models.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m;
      modelListEl.appendChild(opt);
    });
  }

  function runFetchModels() {
    var provider = providerEl.value;
    var key = keyEl.value.trim();

    if (provider === 'custom') {
      setModelsStatus('自定义接口没有统一的模型列表端点，直接手填模型名。', 'warn');
      return;
    }
    if (provider === 'google') {
      fillModelList(GOOGLE_MODELS);
      setModelsStatus('Gemini 没有公开的列表端点，下面是几个常见的型号，可以直接改。', '');
      return;
    }
    if (!key) {
      setModelsStatus('要先填 API Key 才能拉列表。', 'error');
      return;
    }

    var send = pickFetch();
    if (typeof send !== 'function') {
      setModelsStatus('当前环境没有可用的 fetch。', 'error');
      return;
    }

    var cfg = PROVIDERS[provider];
    var url = cfg.modelsUrl;
    var headers = provider === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
      : { 'Authorization': 'Bearer ' + key };

    modelsBtn.disabled = true;
    setModelsStatus('正在拉取…', '');

    Promise.resolve(send(url, { method: 'GET', headers: headers })).then(function (resp) {
      return Promise.resolve()
        .then(function () { return resp.json(); })
        .catch(function () { return null; })
        .then(function (data) {
          if (!resp.ok) throw new Error(errorMessage(resp.status, data));
          if (!data) throw new Error('返回的不是 JSON。');
          var models = [];
          if (Array.isArray(data.data)) {
            models = data.data.map(function (m) { return str(m && m.id); }).filter(Boolean);
          } else if (Array.isArray(data.models)) {
            models = data.models.map(function (m) { return str(m && (m.id || m.name)); }).filter(Boolean);
          }
          if (!models.length) throw new Error('列表是空的。');
          models.sort();
          fillModelList(models);
          setModelsStatus('拉到 ' + models.length + ' 个模型，点输入框就能挑。', 'ok');
        });
    }).catch(function (err) {
      setModelsStatus((err && err.message ? err.message : String(err)) + ' 也可以直接手填模型名。', 'error');
    }).then(function () {
      modelsBtn.disabled = false;
    });
  }

  /* --- 13. 事件 ----------------------------------------------------------- */

  function onProviderChange() {
    var next = providerEl.value;
    var prev = PROVIDERS[state.lastProvider];
    var current = modelEl.value.trim();
    /* 换服务商时，如果模型名还是上一家的默认值，就跟着换掉；
       用户自己改过的名字不动 —— 他可能是有意指定的。 */
    if (!current || (prev && current === prev.defaultModel)) {
      modelEl.value = PROVIDERS[next].defaultModel || '';
    }
    state.lastProvider = next;

    endpointField.hidden = next !== 'custom';
    modelHintEl.textContent = PROVIDERS[next].hint || '';
    clearNode(modelListEl);
    setModelsStatus('', '');
    saveSoon();
  }

  /* 配置改动：防抖保存 */
  [keyEl, modelEl, endpointEl].forEach(function (node) {
    node.addEventListener('input', saveSoon);
  });
  providerEl.addEventListener('change', onProviderChange);

  keyClearBtn.addEventListener('click', function () {
    keyEl.value = '';
    if (writeConfig()) {
      flashSaved('Key 已从本机清除');
      setStatus('API Key 已清除。', '');
    } else {
      flashSaved('清除后写不回去，请手动确认');
    }
    focusField(keyEl);
  });

  modelsBtn.addEventListener('click', runFetchModels);

  /* 音频：拖放 + 点击 */
  dropEl.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropEl.classList.add('is-over');
  });
  dropEl.addEventListener('dragleave', function () {
    dropEl.classList.remove('is-over');
  });
  dropEl.addEventListener('drop', function (e) {
    e.preventDefault();
    dropEl.classList.remove('is-over');
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) acceptAudio(files[0]);
  });
  audioEl.addEventListener('change', function () {
    var files = audioEl.files;
    if (files && files.length) acceptAudio(files[0]);
  });
  audioClearBtn.addEventListener('click', function () { clearAudio(false); });

  /* 疑难词：回车添加、退格删最后一个、点 × 删指定项 */
  termInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (addTerm(termInputEl.value)) termInputEl.value = '';
    } else if (e.key === 'Backspace' && !termInputEl.value && state.terms.length) {
      e.preventDefault();
      removeTermAt(state.terms.length - 1);
    }
  });
  termsEl.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var del = t.closest('.wv-term-del');
    if (del) {
      removeTermAt(Number(del.getAttribute('data-term-index')));
      focusField(termInputEl);
    }
  });

  demoBtn.addEventListener('click', function () {
    textEl.value = DEMO.text;
    contextEl.value = DEMO.context;
    state.terms = DEMO.terms.slice();
    renderTerms();
    setStatus('示例已填入，别忘了在「接口配置」里填上你自己的 Key。', 'ok');
  });

  resetBtn.addEventListener('click', function () {
    textEl.value = '';
    contextEl.value = '';
    state.terms = [];
    renderTerms();
    clearAudio(true);
    showEmptyResult();
    setResultFoot('—');
    setStatus('已清空输入。接口配置与 Key 保留。', '');
  });

  analyzeBtn.addEventListener('click', runAnalyze);
  translateBtn.addEventListener('click', runTranslate);
  restoreBtn.addEventListener('click', function () {
    /* 双向切换 —— 译文一直在手里，随时能在原文与译文之间来回看，不重新请求 */
    state.showing = state.showing === 'translated' ? 'origin' : 'translated';
    paintResult();
    setStatus(state.showing === 'translated' ? '切到译文。' : '切回原文。', '');
  });
  copyBtn.addEventListener('click', function () {
    if (state.showing === 'translated') {
      if (!state.translated) {
        setStatus('还没有译文可复制。', 'warn');
        return;
      }
      util.copy(state.translated.text, copyBtn);
      return;
    }
    if (!state.result) {
      setStatus('还没有结果可复制。', 'warn');
      return;
    }
    util.copy(resultPlainText(state.result), copyBtn);
  });

  /* --- 14. 启动 ----------------------------------------------------------- */

  (function boot() {
    var saved = readConfig();
    if (saved) {
      keyEl.value = saved.key;
      providerEl.value = saved.provider || 'anthropic';
      modelEl.value = saved.model;
      endpointEl.value = saved.endpoint;
    }
    state.lastProvider = providerEl.value;

    /* 模型名空着就补一个该服务商的默认值。空着的话第一次点分析必然被拦，
       而多数人并不知道该填哪个型号 —— 让他先看到能跑通的样子再改。 */
    if (!modelEl.value.trim()) {
      modelEl.value = PROVIDERS[providerEl.value].defaultModel || '';
    }

    endpointField.hidden = providerEl.value !== 'custom';
    modelHintEl.textContent = PROVIDERS[providerEl.value].hint || '';

    renderTerms();
    showEmptyResult();
    setResultFoot('—');
  })();
})();
