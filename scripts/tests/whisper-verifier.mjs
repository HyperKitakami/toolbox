/* ==========================================================================
   日语语音校对（whisper-verifier）测试
   --------------------------------------------------------------------------
   真实 DOM 交互驱动：设 value + dispatch input、点按钮、回车加词，
   不直接调工具内部函数。

   这个工具的特殊之处：它的核心是**对外发请求**，而 jsdom 里没有可用的 fetch。
   所以测试里装一个假的 fetch，把每次请求的 url / headers / body 记下来 ——
   这样「发给 Anthropic 的 body 长什么样」「有音频时 magic 字段在哪」
   都能真的断言到，而不是只看渲染结果。
   音频那条路要 FileReader，jsdom 支持得不完整，探不到就显式跳过。
   ========================================================================== */

import { ok, section, loadPage, sleep } from './_harness.mjs';

const PAGE = 'tools/whisper-verifier/index.html';

/** 装一个假的 fetch：记录每次请求，响应由当前 responder 决定 */
function installFetch(w, responder) {
  const calls = [];
  w.fetch = function (url, init) {
    const rec = {
      url: String(url),
      method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {},
      raw: (init && init.body) || null,
      body: null
    };
    try { rec.body = rec.raw ? JSON.parse(rec.raw) : null; } catch (e) { rec.body = null; }
    calls.push(rec);
    return Promise.resolve(responder(rec, calls.length));
  };
  return calls;
}

const reply = (data, init = {}) => ({
  ok: init.ok !== false,
  status: init.status || 200,
  json: () => Promise.resolve(data)
});

/** 三家响应形态各搭一个壳 */
const anthropicReply = (payload) => ({ content: [{ type: 'text', text: payload }] });
const openaiReply = (payload) => ({ choices: [{ message: { content: payload } }] });
const googleReply = (payload) => ({ candidates: [{ content: { parts: [{ text: payload }] } }] });

/** 从一次请求里取出「那段给模型看的文字」，三家结构不同 */
function promptText(call) {
  const b = call && call.body;
  if (!b) return '';
  if (Array.isArray(b.messages)) {
    const c = b.messages[0] && b.messages[0].content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n');
    }
  }
  const parts = b.contents && b.contents[0] && b.contents[0].parts;
  if (Array.isArray(parts)) {
    return parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
  }
  return '';
}

/** 取出音频那一块（三家分别是 document / input_audio / inlineData） */
function audioBlock(call) {
  const b = call && call.body;
  if (!b) return null;
  if (Array.isArray(b.messages)) {
    const c = b.messages[0] && b.messages[0].content;
    if (Array.isArray(c)) {
      return c.find((x) => x && (x.type === 'document' || x.type === 'input_audio')) || null;
    }
  }
  const parts = b.contents && b.contents[0] && b.contents[0].parts;
  if (Array.isArray(parts)) return parts.find((p) => p && p.inlineData) || null;
  return null;
}

const CORRECTED = 'この装備、ちょうどいいわね。提督、いつもありがとう。';

/* 新格式：候选是对象，带 confidence；顶层多一个 corrected_text */
const WORDS = {
  words: [
    {
      original: '装備',
      candidates: [
        { text: '装備', confidence: 0.92 },
        { text: '装備品', confidence: 0.05 },
        { text: '装弾', confidence: 0.03 }
      ],
      best: '装備',
      reasoning: '音はソウビ。文脈は艦娘の会話なので「装備」で間違いない。'
    },
    {
      original: '提督',
      candidates: [{ text: '提督', confidence: 0.98 }],
      best: '提督',
      reasoning: 'ていとく。ここは問題なし。'
    }
  ],
  corrected_text: CORRECTED,
  overall_suggestion: 'この装備、ちょうどいいわね。提督、いつもありがとう。'
};

/* 旧格式：候选是裸字符串、没有 corrected_text —— 模型有时就这么答，不能崩 */
const LEGACY = {
  words: [
    { original: '装備', candidates: ['装備', '装備品'], best: '装備', reasoning: '旧格式。' }
  ],
  overall_suggestion: '旧格式的整句建议。'
};

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage(PAGE, { clipboard: (t) => { copied = t; } });

  const $ = (sel) => d.querySelector(sel);
  const $$ = (sel) => [...d.querySelectorAll(sel)];

  const keyEl = $('#wv-key');
  const providerEl = $('#wv-provider');
  const modelEl = $('#wv-model');
  const textEl = $('#wv-text');
  const contextEl = $('#wv-context');
  const termInput = $('#wv-term-input');
  const analyzeBtn = $('#wv-analyze');
  const resultEl = $('#wv-result');
  const statusEl = $('#wv-status');
  const resultFoot = $('#wv-result-foot');
  const saveEl = $('#wv-save');

  const fire = async (el, type, wait = 30) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const click = async (el, wait = 40) => {
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setVal = async (el, v, wait = 30) => {
    el.value = v;
    await fire(el, 'input', wait);
  };
  const setSelect = async (el, v) => {
    el.value = v;
    await fire(el, 'change');
  };
  const statusText = () => statusEl.textContent;
  const terms = () => $$('#wv-terms .wv-term').map((t) => t.textContent.replace('×', ''));
  const words = () => $$('#wv-result .wv-word');
  const candsOf = (i) => $$('#wv-result .wv-word')[i].querySelectorAll('.wv-cand');

  const addTerm = async (word) => {
    termInput.value = word;
    termInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(30);
  };

  /** 填好一份可提交的输入 */
  const fill = async (opts = {}) => {
    await setVal(keyEl, opts.key || 'sk-test-key');
    await setSelect(providerEl, opts.provider || 'anthropic');
    await setVal(modelEl, opts.model || 'claude-sonnet-4-5');
    await setVal(textEl, opts.text || 'この装備、ちょうどいいわね。');
    if (opts.context != null) await setVal(contextEl, opts.context);
    if (opts.terms) {
      for (const t of opts.terms) await addTerm(t);
    }
  };

  let responder = () => reply(anthropicReply(JSON.stringify(WORDS)));
  const calls = installFetch(w, (rec, n) => responder(rec, n));

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('页面标了 data-tool', d.body.getAttribute('data-tool') === 'whisper-verifier',
     d.body.getAttribute('data-tool'));
  ok('页面挂在 ai 分类下', d.body.getAttribute('data-hub') === 'ai',
     d.body.getAttribute('data-hub'));
  ok('面包屑指向 AI 辅助', ($('.breadcrumb a[href*="hubs/ai"]') || {}).textContent === 'AI 辅助');
  ok('顶部有「会联网」徽章', !!$('.tool-head-meta .badge--warn'));
  ok('顶部有联网提示条', !!$('.notice--warn'));
  ok('提示条里写明了数据会发往第三方',
     $('.notice--warn').textContent.includes('发往'), $('.notice--warn').textContent.slice(0, 40));
  ok('结果区初始是空状态', !!$('#wv-result .wv-result-empty'));
  ok('初始状态栏是空的', statusText() === '', statusText());
  ok('默认服务商是 anthropic', providerEl.value === 'anthropic', providerEl.value);
  ok('默认模型名与提示都给了',
     modelEl.value === 'claude-sonnet-4-5' && $('#wv-model-hint').textContent.includes('音频'),
     modelEl.value + ' / ' + $('#wv-model-hint').textContent);
  ok('自定义接口地址这一格默认收起', $('#wv-endpoint-field').hidden === true);
  ok('译文切换按钮初始隐藏（还没有译文）', $('#wv-restore').hidden === true);
  ok('「移除音频」按钮初始隐藏', $('#wv-audio-clear').hidden === true);

  /* ---------- 2. 输入校验 ---------- */
  section('2. 输入校验（每一条都要求能指出该填哪一格）');

  await click(analyzeBtn, 60);
  ok('缺 Key 时拒绝提交', statusText().includes('API Key'), statusText());
  ok('缺 Key 时把焦点给到 Key 输入框', d.activeElement === keyEl);

  await setVal(keyEl, 'sk-test-key');
  ok('打开时模型名已经预填了默认值（不必自己查型号）',
     modelEl.value === 'claude-sonnet-4-5', modelEl.value);
  await setVal(modelEl, '');
  await click(analyzeBtn, 60);
  ok('缺模型名时拒绝提交', statusText().includes('模型名'), statusText());
  ok('缺模型名时把焦点给到模型框', d.activeElement === modelEl);
  await setVal(modelEl, 'claude-sonnet-4-5');
  await click(analyzeBtn, 60);
  ok('缺转录文本时拒绝提交', statusText().includes('转录结果'), statusText());
  ok('缺转录文本时把焦点给到文本框', d.activeElement === textEl);

  await setVal(textEl, 'この装備、ちょうどいいわね。');
  ok('以上三次都没发出请求', calls.length === 0, String(calls.length));

  /* 疑难词是**可选**的：不填就走全文校对，由模型自己找可疑处 */
  calls.length = 0;
  await click(analyzeBtn, 120);
  ok('一个疑难词都不填也能提交（走全文校对）', calls.length === 1, String(calls.length));
  const fp = calls[0] ? promptText(calls[0]) : '';
  ok('全文校对时不出现「需要核对的词」那一段', !fp.includes('## 需要核对的词'), fp.slice(0, 80));
  ok('全文校对时明确让模型自己找可疑处', fp.includes('自己找出'), fp.slice(0, 140));
  ok('全文校对时要求「没有可疑处就返回空数组，不要硬造」',
     fp.includes('不要为了凑数硬造'), fp.slice(0, 200));
  ok('全文校对照样给出词卡', words().length === 2, String(words().length));
  calls.length = 0;

  await setSelect(providerEl, 'custom');
  ok('选了自定义接口就把地址那一格露出来', $('#wv-endpoint-field').hidden === false);
  /* 换服务商时，上一家的默认模型名会被清掉（那是 anthropic 的默认值）——
     这是有意行为，所以这里要把模型名重新填上，才轮得到地址那条校验 */
  ok('换服务商后模型名被清掉了（上一家的默认值）', modelEl.value === '', modelEl.value);
  await setVal(modelEl, 'my-custom-model');
  await addTerm('装備');
  await click(analyzeBtn, 60);
  ok('自定义接口但地址非法时拒绝提交', statusText().includes('http://'), statusText());
  ok('地址非法时把焦点给到地址框', d.activeElement === $('#wv-endpoint'));

  await setVal($('#wv-endpoint'), 'https://example.com/v1/chat/completions');
  calls.length = 0;
  await click(analyzeBtn, 120);
  ok('地址合法后放行并真的发出去',
     calls.length === 1 && calls[0].url === 'https://example.com/v1/chat/completions',
     calls[0] ? calls[0].url : String(calls.length));
  await setSelect(providerEl, 'anthropic');

  /* ---------- 3. 疑难词标签 ---------- */
  section('3. 疑难词标签');

  ok('回车加词进列表', terms().join(',') === '装備', terms().join(','));
  ok('加词后输入框清空', termInput.value === '', termInput.value);

  await addTerm('装備');
  ok('重复的词不会加第二遍', terms().length === 1, String(terms().length));
  ok('重复时给出提示', statusText().includes('已经在列表里'), statusText());

  await addTerm('  提督  ');
  ok('加词会去掉首尾空白', terms()[1] === '提督', JSON.stringify(terms()));

  await addTerm('');
  ok('空串不会被加成标签', terms().length === 2, String(terms().length));

  for (let i = 0; i < 15; i++) await addTerm('词' + i);
  ok('最多 12 个词', terms().length === 12, String(terms().length));
  ok('超出上限时说明原因', statusText().includes('最多标 12 个'), statusText());

  const delBtn = $('#wv-terms .wv-term .wv-term-del');
  await click(delBtn);
  ok('点 × 删掉指定的词', terms().length === 11 && terms()[0] === '提督', JSON.stringify(terms()));

  termInput.value = '';
  termInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  await sleep(30);
  ok('输入框为空时退格删掉最后一个词', terms().length === 10, String(terms().length));

  /* 复位成两个词，后面的用例基于它 */
  await click($('#wv-reset'));
  await addTerm('装備');
  await addTerm('提督');
  ok('「清空」把词也清掉后再加两个', terms().join(',') === '装備,提督', terms().join(','));

  /* ---------- 4. 分析：发给 Anthropic 的请求 ---------- */
  section('4. 分析 · Anthropic');

  await setVal(textEl, 'この装備、ちょうどいいわね。');
  await setVal(contextEl, '动画台词，说话者开朗。');
  calls.length = 0;
  await fill({ terms: [] });
  await click(analyzeBtn, 120);

  ok('发出了一次请求', calls.length === 1, String(calls.length));
  const a = calls[0] || { headers: {}, body: {} };
  ok('发往 Anthropic messages 端点', a.url === 'https://api.anthropic.com/v1/messages', a.url);
  ok('用的是 POST', a.method === 'POST', a.method);
  ok('Key 走 x-api-key 请求头', a.headers['x-api-key'] === 'sk-test-key', a.headers['x-api-key']);
  ok('带了 anthropic-version', a.headers['anthropic-version'] === '2023-06-01');
  ok('带了浏览器直连所需的头',
     a.headers['anthropic-dangerous-direct-browser-access'] === 'true');
  ok('body 里带模型名', a.body.model === 'claude-sonnet-4-5', a.body.model);
  ok('body 里给了输出预算', a.body.max_tokens === 4000, String(a.body.max_tokens));

  const p1 = promptText(a);
  ok('prompt 里有转录文本', p1.includes('この装備'), p1.slice(0, 30));
  ok('prompt 里有两个疑难词', p1.includes('「装備」') && p1.includes('「提督」'));
  ok('标了词就出现「需要核对的词」那一段', p1.includes('## 需要核对的词'));
  ok('prompt 里有背景说明', p1.includes('动画台词'), '');
  ok('没给音频时明确说了只听文本',
     p1.includes('没有音频'), p1.includes('没有音频') ? '' : p1.slice(0, 60));
  ok('prompt 要求以 JSON 回', p1.includes('"words"') && p1.includes('"overall_suggestion"'));
  ok('prompt 要求候选带 confidence', p1.includes('"confidence"'), p1.slice(0, 80));
  ok('prompt 要求给出 corrected_text', p1.includes('"corrected_text"'));
  ok('prompt 说明了 confidence 的取值是 0~1 的小数', p1.includes('0 到 1'));
  ok('prompt 说明 corrected_text 不该增删内容', p1.includes('不要增删内容'));
  ok('prompt 要求原词与候选保持日语、只有说明文字用中文',
     p1.includes('保持日语原样') && p1.includes('简体中文'), '');
  ok('没给音频时不带任何音频块', audioBlock(a) === null);

  /* ---------- 5. 结果渲染 ---------- */
  section('5. 结果渲染');

  ok('渲染出两张词卡', words().length === 2, String(words().length));
  ok('结果区顶部先给「校对后的文本」',
     ($('.wv-corrected h3') || {}).textContent === '校对后的文本');
  ok('校对后的文本就是模型给的那份',
     ($('.wv-corrected-text') || {}).textContent === CORRECTED,
     ($('.wv-corrected-text') || {}).textContent);
  ok('模型真的给了 corrected_text 时不加兜底说明', !$('.wv-corrected-note'));
  ok('第一张卡的原词是「装備」',
     words()[0].querySelector('.wv-word-original').textContent === '装備');
  ok('推荐写法显示在箭头右边',
     words()[0].querySelector('.wv-word-best').textContent === '装備');
  ok('三个候选都列出来了', candsOf(0).length === 3, String(candsOf(0).length));
  ok('最推荐的那个单独标了 is-best',
     [...candsOf(0)].filter((c) => c.classList.contains('is-best')).length === 1);
  ok('推荐项确实是 .is-best 那一个',
     words()[0].querySelector('.wv-cand.is-best .wv-cand-text').textContent === '装備');
  ok('候选文本与置信度分开成两个节点',
     words()[0].querySelectorAll('.wv-cand')[0].querySelectorAll('.wv-cand-text, .wv-conf').length === 2);

  /* 置信度 */
  const confs = [...candsOf(0)].map((c) => (c.querySelector('.wv-conf') || {}).textContent);
  ok('每个候选都带一个百分比', confs.join(',') === '92%,5%,3%', confs.join(','));
  ok('≥80% 的标 is-high', candsOf(0)[0].classList.contains('is-high'));
  ok('<50% 的标 is-low',
     candsOf(0)[1].classList.contains('is-low') && candsOf(0)[2].classList.contains('is-low'));
  ok('候选的 title 写明了这是模型的把握',
     (candsOf(0)[0].getAttribute('title') || '').includes('92%'),
     String(candsOf(0)[0].getAttribute('title')));
  ok('单个候选也带置信度',
     words()[1].querySelector('.wv-conf').textContent === '98%',
     words()[1].querySelector('.wv-conf').textContent);

  ok('理由渲染出来了', words()[0].querySelector('.wv-reason').textContent.includes('ソウビ'));
  ok('整句建议单独一块',
     $('.wv-overall p').textContent === WORDS.overall_suggestion, $('.wv-overall p').textContent);
  ok('底部统计写了词数', resultFoot.textContent.includes('2 个词'), resultFoot.textContent);
  ok('底部统计注明含校对后文本',
     resultFoot.textContent.includes('含校对后文本'), resultFoot.textContent);
  ok('完成后状态栏是完成', statusText().includes('分析完成'), statusText());
  ok('分析按钮恢复可用', analyzeBtn.disabled === false);

  /* ---------- 6. 响应解析的退让链 ---------- */
  section('6. 响应解析：模型不老实按格式答的几种情况');

  const analyzeOnce = async (payload) => {
    responder = () => reply(anthropicReply(payload));
    calls.length = 0;
    await click(analyzeBtn, 120);
  };

  await analyzeOnce('```json\n' + JSON.stringify(WORDS) + '\n```');
  ok('带 ```json 围栏能解析', words().length === 2, String(words().length));

  await analyzeOnce('好的，以下是分析结果：\n\n' + JSON.stringify(WORDS));
  ok('前面带一句客套话也能解析', words().length === 2, String(words().length));

  await analyzeOnce('分析如下\n```json\n' + JSON.stringify(WORDS) + '\n```\n希望有帮助！');
  ok('客套话 + 围栏 + 尾巴都能解析', words().length === 2, String(words().length));

  await analyzeOnce('抱歉，我无法完成这个请求。');
  ok('完全不是 JSON 时保留原始输出', !!$('#wv-result .wv-raw'), $('.wv-error strong') && $('.wv-error strong').textContent);
  ok('原始输出里能看到模型的原话',
     ($('#wv-result .wv-raw') || {}).textContent === '抱歉，我无法完成这个请求。');
  ok('这种情况给出可读的提示', statusText().includes('没按 JSON'), statusText());

  await analyzeOnce(JSON.stringify({ words: [], overall_suggestion: '' }));
  ok('JSON 合法但没有内容时也保留原文', !!$('#wv-result .wv-raw'));
  ok('空结果时说明没结果', statusText().includes('没按 JSON') || statusText().includes('空'), statusText());

  await analyzeOnce(JSON.stringify({ nope: 1 }));
  ok('字段完全不认识时留原文，不白屏', !!$('#wv-result .wv-raw'));

  /* ---------- 7. 结构归一的容错 ---------- */
  section('7. 结构归一：模型少给字段、改名、给怪类型');

  await analyzeOnce(JSON.stringify({
    words: [{ original: '提督', best: '提督' }]
  }));
  ok('只有 original + best 也能渲染', words().length === 1, String(words().length));
  const onlyBest = candsOf(0);
  ok('best 会自动补进候选里', onlyBest.length === 1 && onlyBest[0].textContent === '提督',
     String(onlyBest.length));
  ok('缺理由时不渲染理由段落', !words()[0].querySelector('.wv-reason'));

  await analyzeOnce(JSON.stringify({
    words: [{ word: '装備', candidates: ['装備'], reason: '音似分析。' }]
  }));
  ok('认得出 word / reason 这类同义键名',
     words()[0].querySelector('.wv-word-original').textContent === '装備' &&
     words()[0].querySelector('.wv-reason').textContent === '音似分析。');

  await analyzeOnce(JSON.stringify({
    words: [{ original: '装備', candidates: ['装備', 123, null], best: '装備', reasoning: ['第一点', '第二点'] }]
  }));
  const mixed = [...candsOf(0)].map((c) => c.textContent);
  ok('候选里的 null 被丢掉、数字被转成字符串',
     mixed.length === 2 && mixed[0] === '装備' && mixed[1] === '123', mixed.join('|'));
  ok('理由给成数组时拼成一段',
     words()[0].querySelector('.wv-reason').textContent === '第一点；第二点',
     words()[0].querySelector('.wv-reason').textContent);

  await analyzeOnce(JSON.stringify({
    words: [null, '字符串', { original: '装備', best: '装備', candidates: ['装備'] }],
    overall: '整体没问题。'
  }));
  ok('数组里混着垃圾项也能挑出好的', words().length === 1, String(words().length));
  ok('认得出 overall 这个简写', $('.wv-overall p').textContent === '整体没问题。');

  await analyzeOnce(JSON.stringify({ words: { a: 1 }, overall_suggestion: '随便一句' }));
  ok('words 给成对象时不崩，只渲染整句建议',
     words().length === 0 && !!$('.wv-overall'), String(words().length));

  /* 置信度：模型给四种形态都要认 */
  await analyzeOnce(JSON.stringify({
    words: [{
      original: 'A',
      candidates: [
        { text: '甲', confidence: 90 },     /* 百分数 */
        { text: '乙', confidence: '60%' },  /* 带百分号的字符串 */
        { text: '丙', confidence: '高' },    /* 档位词 */
        { text: '丁' }                       /* 没给 */
      ],
      best: '甲'
    }]
  }));
  const norm = [...candsOf(0)].map((c) => (c.querySelector('.wv-conf') || {}).textContent || null);
  ok('置信度 90 被当成 90%', norm[0] === '90%', String(norm[0]));
  ok('置信度 "60%" 认得出来', norm[1] === '60%', String(norm[1]));
  ok('置信度 "高" 映射成 90%', norm[2] === '90%', String(norm[2]));
  ok('没给置信度就不显示百分比', norm[3] === null, String(norm[3]));
  ok('90% / 60% / 90% 分别标上 high / mid / high',
     candsOf(0)[0].classList.contains('is-high') &&
     candsOf(0)[1].classList.contains('is-mid') &&
     candsOf(0)[2].classList.contains('is-high'));

  await analyzeOnce(JSON.stringify({
    words: [{ original: 'A', candidates: [{ text: '甲', confidence: '不好说' }], best: '甲' }]
  }));
  ok('认不出的置信度宁可留空，也不猜一个数字',
     !words()[0].querySelector('.wv-conf'), '出现了 .wv-conf');

  await analyzeOnce(JSON.stringify({
    words: [{ original: 'A', candidates: [{ text: '甲', confidence: 500 }], best: '甲' }]
  }));
  ok('超过 100 的置信度按「认不出」处理', !words()[0].querySelector('.wv-conf'));

  /* 旧格式：候选是裸字符串、没有 corrected_text —— 模型有时就这么答 */
  await analyzeOnce(JSON.stringify(LEGACY));
  ok('候选给成裸字符串也能渲染',
     [...candsOf(0)].map((c) => c.querySelector('.wv-cand-text').textContent).join(',') === '装備,装備品',
     [...candsOf(0)].map((c) => c.textContent).join(','));
  ok('裸字符串候选不显示置信度', !words()[0].querySelector('.wv-conf'));
  ok('模型没给 corrected_text 时回退成用户贴的原文',
     ($('.wv-corrected-text') || {}).textContent === 'この装備、ちょうどいいわね。',
     ($('.wv-corrected-text') || {}).textContent);
  ok('回退成原文时明确说明「这不是模型给的」', !!$('.wv-corrected-note'));

  /* ---------- 8. XSS 回归（原型在这里是敞的） ---------- */
  section('8. 模型输出不进 HTML 解析器');

  const XSS = '<b>粗体</b> & "引号" <img src=x onerror="window.__pwned=1">';
  await analyzeOnce(JSON.stringify({
    words: [{
      original: XSS,
      candidates: [{ text: XSS, confidence: 0.5 }],
      best: XSS,
      reasoning: XSS
    }],
    corrected_text: XSS,
    overall_suggestion: XSS
  }));

  ok('理由里的标签没有被解析成元素',
     words()[0].querySelectorAll('.wv-reason b').length === 0);
  ok('原词里的标签也没有被解析',
     words()[0].querySelectorAll('.wv-word-original b').length === 0);
  ok('候选胶囊里的标签也没有被解析',
     words()[0].querySelectorAll('.wv-cand b, .wv-cand img').length === 0);
  ok('校对后的文本里的标签也没有被解析',
     d.querySelectorAll('#wv-result .wv-corrected b, #wv-result .wv-corrected img').length === 0);
  ok('校对后的文本按纯文本原样显示',
     $('.wv-corrected-text').textContent === XSS, $('.wv-corrected-text').textContent);
  ok('没有产生注入的 img 元素', d.querySelectorAll('#wv-result img').length === 0);
  ok('页面上没有执行到注入的脚本', w.__pwned === undefined, String(w.__pwned));
  ok('整句建议里的标签也没被解析', d.querySelectorAll('#wv-result .wv-overall img').length === 0);
  ok('标签以纯文本原样显示',
     words()[0].querySelector('.wv-reason').textContent === XSS,
     words()[0].querySelector('.wv-reason').textContent);

  /* ---------- 9. 出错路径 ---------- */
  section('9. 出错的几种样子');

  const failWith = async (resp) => {
    responder = () => resp;
    calls.length = 0;
    await click(analyzeBtn, 120);
  };

  await failWith(reply({ error: { message: 'invalid x-api-key' } }, { ok: false, status: 401 }));
  ok('401 说成 Key 被拒', $('.wv-error').textContent.includes('Key 被拒'), $('.wv-error').textContent.slice(0, 60));
  ok('401 带上了对方的原话', $('.wv-error').textContent.includes('invalid x-api-key'));
  ok('401 时状态栏提醒失败', statusText().includes('没成功'), statusText());

  await failWith(reply({ error: { message: 'rate limit' } }, { ok: false, status: 429 }));
  ok('429 说成请求太频繁或额度用完', $('.wv-error').textContent.includes('额度'), $('.wv-error').textContent.slice(0, 60));

  await failWith(reply({}, { ok: false, status: 413 }));
  ok('413 猜是音频太大', $('.wv-error').textContent.includes('音频'), $('.wv-error').textContent.slice(0, 60));

  await failWith({
    ok: true,
    status: 200,
    json: () => Promise.reject(new Error('不是 JSON'))
  });
  ok('返回不是 JSON 时给出可读原因',
     $('.wv-error').textContent.includes('不是 JSON'), $('.wv-error').textContent.slice(0, 60));

  responder = () => { throw new Error('网络断了'); };
  calls.length = 0;
  await click(analyzeBtn, 120);
  ok('取不到响应时也不留白屏', !!$('.wv-error'), resultEl.textContent.slice(0, 40));

  /* ---------- 10. 音频 ---------- */
  section('10. 音频（jsdom 支持不全，探不到就跳过）');

  const audioEl = $('#wv-audio');
  const canFile = typeof w.File === 'function' && typeof w.FileReader === 'function' &&
                  typeof audioEl.files !== 'undefined';

  if (!canFile) {
    console.log('  · 跳过音频用例：这个 jsdom 版本没有 File / FileReader');
  } else {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
    const file = new w.File([bytes], 'clip.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(audioEl, 'files', { value: [file], configurable: true });
    await fire(audioEl, 'change', 120);

    ok('选好音频后露出「移除音频」', $('#wv-audio-clear').hidden === false);
    ok('音频文件名与体积都显示出来',
       $('#wv-audio-name').textContent.includes('clip.mp3'), $('#wv-audio-name').textContent);
    ok('音频就位后给了提示', statusText().includes('音频已就位'), statusText());

    await fill({ terms: [] });
    responder = () => reply(anthropicReply(JSON.stringify(WORDS)));
    calls.length = 0;
    await click(analyzeBtn, 150);

    const withAudio = calls[0];
    const block = withAudio ? audioBlock(withAudio) : null;
    if (block) {
      ok('Anthropic 用 document 块装音频', block.type === 'document');
      ok('音频 MIME 传对了', block.source.media_type === 'audio/mpeg', block.source.media_type);
      ok('音频以 base64 传（解出来正是原始字节）',
         w.atob(block.source.data) === String.fromCharCode(...bytes), block.source.data.slice(0, 20));
      const ap = promptText(withAudio);
      ok('有音频时 prompt 换成「已附上音频」的说法',
         ap.includes('已经附上'), ap.slice(0, 120));
      ok('底部统计注明已附音频', resultFoot.textContent.includes('已附音频'), resultFoot.textContent);
    } else {
      ok('音频块没能传出来（jsdom 的 FileReader 没跑通）', false, 'audioBlock 为空');
    }

    /* 换服务商时音频块的形态应当跟着变 */
    await setSelect(providerEl, 'openai');
    await fill({ terms: [], provider: 'openai', model: 'gpt-4o-audio-preview' });
    calls.length = 0;
    await click(analyzeBtn, 150);
    const oa = calls[0];
    const oaBlock = oa ? audioBlock(oa) : null;
    if (oaBlock) {
      ok('OpenAI 用 input_audio 装音频', oaBlock.type === 'input_audio');
      ok('格式名从 MIME 推出来', oaBlock.input_audio.format === 'mp3', oaBlock.input_audio.format);
    } else {
      ok('OpenAI 的音频块没能传出来', false);
    }

    await setSelect(providerEl, 'google');
    await fill({ terms: [], provider: 'google', model: 'gemini-2.5-flash' });
    calls.length = 0;
    await click(analyzeBtn, 150);
    const g = calls[0];
    const gBlock = g ? audioBlock(g) : null;
    if (gBlock) {
      ok('Gemini 用 inlineData 装音频', !!gBlock.inlineData);
      ok('Gemini 的 MIME 传对了', gBlock.inlineData.mimeType === 'audio/mpeg');
    } else {
      ok('Gemini 的音频块没能传出来', false);
    }

    /* 移除音频后不应再带音频块 */
    await click($('#wv-audio-clear'));
    ok('移除音频后按钮藏回去', $('#wv-audio-clear').hidden === true);
    ok('移除音频后文件名清空', $('#wv-audio-name').textContent === '');
    await fill({ terms: [], provider: 'anthropic', model: 'claude-sonnet-4-5' });
    calls.length = 0;
    await click(analyzeBtn, 120);
    ok('移除音频之后请求里不再有音频块',
       !!calls[0] && audioBlock(calls[0]) === null, String(calls.length));
  }

  /* ---------- 11. 另外三家的请求形态 ---------- */
  section('11. 三家的请求形态');

  await click($('#wv-audio-clear'));
  await setSelect(providerEl, 'openai');
  await fill({ terms: [], provider: 'openai', model: 'gpt-4o' });
  calls.length = 0;
  await click(analyzeBtn, 120);

  const o = calls[0] || { headers: {}, body: { messages: [{ content: [] }] } };
  ok('OpenAI 端点正确',
     o.url === 'https://api.openai.com/v1/chat/completions', o.url);
  ok('OpenAI 用 Authorization: Bearer',
     o.headers['Authorization'] === 'Bearer sk-test-key', o.headers['Authorization']);
  ok('OpenAI 的 prompt 在 messages 里', promptText(o).includes('この装備'));
  ok('没有音频时用户消息里只有文字',
     o.body.messages[0].content.every((c) => c.type === 'text'), JSON.stringify(o.body.messages[0].content));

  await setSelect(providerEl, 'google');
  await fill({ terms: [], provider: 'google', model: 'gemini-2.5-flash' });
  calls.length = 0;
  await click(analyzeBtn, 120);

  const g = calls[0] || { headers: {}, body: { generationConfig: {} } };
  ok('Gemini 把模型名拼进地址',
     g.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
     g.url);
  ok('Gemini 的 Key 走请求头，不在 URL 里',
     g.headers['x-goog-api-key'] === 'sk-test-key' && !g.url.includes('sk-test-key'), g.headers['x-goog-api-key']);
  ok('Gemini 要求以 JSON 回（responseMimeType）',
     g.body.generationConfig.responseMimeType === 'application/json');
  ok('Gemini 的 prompt 在 parts 里', promptText(g).includes('この装備'));

  /* Gemini 的响应壳也要能认出来 */
  responder = () => reply(googleReply(JSON.stringify(WORDS)));
  calls.length = 0;
  await click(analyzeBtn, 120);
  ok('Gemini 形态的响应能解析出词卡', words().length === 2, String(words().length));

  await setSelect(providerEl, 'custom');
  await setVal($('#wv-endpoint'), 'https://my-proxy.example.com/v1/chat/completions');
  await fill({ terms: [], provider: 'custom', model: 'my-model' });
  calls.length = 0;
  await click(analyzeBtn, 120);

  const c = calls[0] || { headers: {} };
  ok('自定义接口就用填进来的地址',
     c.url === 'https://my-proxy.example.com/v1/chat/completions', c.url);
  ok('自定义接口也走 Bearer', c.headers['Authorization'] === 'Bearer sk-test-key');

  responder = () => reply(openaiReply(JSON.stringify(WORDS)));
  calls.length = 0;
  await click(analyzeBtn, 120);
  ok('OpenAI 形态的响应能解析出词卡', words().length === 2, String(words().length));

  /* ---------- 12. 复制 ---------- */
  section('12. 复制');

  copied = null;
  await click($('#wv-copy'), 60);
  ok('复制出去了内容', typeof copied === 'string' && copied.length > 0);
  ok('复制的是纯文本而不是 HTML',
     copied.includes('装備 → 装備') && !copied.includes('<'), copied.slice(0, 60));
  ok('复制内容含候选与理由',
     copied.includes('候选：') && copied.includes('理由：'), copied.slice(0, 120));
  ok('复制内容含整句建议', copied.includes('整体建议：'), copied.slice(-80));
  ok('复制内容以「校对后的文本」开头',
     copied.startsWith('校对后的文本：') && copied.includes(CORRECTED), copied.slice(0, 40));
  ok('复制内容里候选带上了置信度', copied.includes('装備（92%）'), copied.slice(0, 200));

  /* ---------- 13. 翻译：翻的是「校对后的文本」 ---------- */
  section('13. 翻译校对后的文本');

  await setSelect(providerEl, 'anthropic');
  await fill({ terms: [], provider: 'anthropic', model: 'claude-sonnet-4-5' });
  responder = () => reply(anthropicReply(JSON.stringify(WORDS)));
  calls.length = 0;
  await click(analyzeBtn, 120);
  ok('先有一份分析结果', words().length === 2, String(words().length));

  await setSelect($('#wv-lang'), 'zh');
  /* 这次让模型回**纯文本**译文 —— 翻译不再要求 JSON，
     也就不存在「少返回一个字段导致译文贴错位」那类失败 */
  const ZH = '这套装备，正合适呢。提督，一直以来谢谢你。';
  responder = () => reply(anthropicReply(ZH));
  calls.length = 0;
  await click($('#wv-translate'), 140);

  ok('翻译发出了一次请求', calls.length === 1, String(calls.length));
  const tp = promptText(calls[0]);
  ok('翻译的 prompt 里要求翻成中文', tp.includes('中文'), tp.slice(0, 60));
  ok('翻译送的是校对后的文本，不是分析结果里的字段',
     tp.includes(CORRECTED), tp.slice(-60));
  ok('翻译 prompt 点名只要译文，别加围栏',
     tp.includes('只输出译文') && tp.includes('不要 Markdown 围栏'), tp.slice(0, 80));
  ok('翻译请求里没有音频块', audioBlock(calls[0]) === null);
  ok('翻译用的是翻译档的 token 预算（8000）',
     calls[0].body.max_tokens === 8000, String(calls[0].body.max_tokens));
  ok('翻译请求里不再出现 candidates / best 这些结果字段名',
     !tp.includes('"candidates"') && !tp.includes('"best"'));

  ok('结果区切到译文视图', resultEl.classList.contains('is-translated'));
  ok('译文整块显示出来',
     ($('.wv-transcript-text') || {}).textContent === ZH,
     ($('.wv-transcript-text') || {}).textContent);
  ok('译文块标了目标语言', ($('.wv-transcript h3') || {}).textContent.includes('中文'),
     ($('.wv-transcript h3') || {}).textContent);
  ok('译文视图里不再出现词卡', words().length === 0, String(words().length));
  ok('露出切换按钮', $('#wv-restore').hidden === false);
  ok('译文视图下按钮说「看原文」',
     $('#wv-restore').textContent === '看原文', $('#wv-restore').textContent);
  ok('底部说明这是译文', resultFoot.textContent.includes('中文'), resultFoot.textContent);

  await click($('#wv-restore'), 60);
  ok('点「看原文」切回校对结果',
     words().length === 2 && !resultEl.classList.contains('is-translated'), String(words().length));
  ok('切回后校对后的文本还在',
     ($('.wv-corrected-text') || {}).textContent === CORRECTED);
  ok('切回后词卡与置信度都还在',
     words()[0].querySelector('.wv-conf').textContent === '92%');
  ok('切回后底栏也回到校对结果的说明',
     resultFoot.textContent.includes('含校对后文本'), resultFoot.textContent);

  /* 回归（本次修的 bug）：切回原文后按钮不能跟着消失，否则译文就再也回不去了，
     用户只能重新点一次「翻译」再花一次请求 */
  ok('切回原文后切换按钮仍在', $('#wv-restore').hidden === false);
  ok('切回原文后按钮改口说「看译文」',
     $('#wv-restore').textContent === '看译文', $('#wv-restore').textContent);

  await click($('#wv-restore'), 60);
  ok('再点一次就回到译文，不用重新翻译',
     resultEl.classList.contains('is-translated') &&
     ($('.wv-transcript-text') || {}).textContent === ZH,
     ($('.wv-transcript-text') || {}).textContent);
  ok('来回切换不会发出新请求', calls.length === 1, String(calls.length));
  ok('切回译文后底栏又是译文说明',
     resultFoot.textContent.includes('译文'), resultFoot.textContent);

  /* 切回原文，供下面「再翻一次」使用 */
  await click($('#wv-restore'), 60);
  ok('第三次点又回到原文', !resultEl.classList.contains('is-translated'));

  /* 译文视图下复制的是译文本身，不是整份结果 */
  await click($('#wv-translate'), 140);
  ok('再翻一次仍然成功', resultEl.classList.contains('is-translated'));
  copied = null;
  await click($('#wv-copy'), 60);
  ok('译文视图下复制的是译文',
     copied === ZH, String(copied).slice(0, 40));
  await click($('#wv-restore'), 60);

  /* 围栏要剥掉 */
  await setSelect($('#wv-lang'), 'en');
  responder = () => reply(anthropicReply('```\nThe equipment fits nicely.\n```'));
  calls.length = 0;
  await click($('#wv-translate'), 140);
  ok('译文被围栏包着时剥掉围栏',
     ($('.wv-transcript-text') || {}).textContent === 'The equipment fits nicely.',
     ($('.wv-transcript-text') || {}).textContent);
  await click($('#wv-restore'), 60);

  /* 回空：不切视图、不清结果，给出可读提示 */
  await setSelect($('#wv-lang'), 'zh');
  responder = () => reply(anthropicReply(''));
  calls.length = 0;
  await click($('#wv-translate'), 140);
  ok('译文为空时不切视图', !resultEl.classList.contains('is-translated'), resultEl.className);
  ok('译文为空时校对结果没被冲掉',
     ($('.wv-corrected-text') || {}).textContent === CORRECTED);
  ok('译文为空时给出可读提示', statusText().includes('没拿到译文'), statusText());

  /* 接口报错：同样不能把校对结果冲掉 */
  responder = () => reply({ error: { message: 'bad key' } }, { ok: false, status: 401 });
  calls.length = 0;
  await click($('#wv-translate'), 140);
  ok('翻译失败时状态栏给出原因，校对结果仍在',
     statusText().includes('Key 被拒') && ($('.wv-corrected-text') || {}).textContent === CORRECTED,
     statusText());

  responder = () => reply(anthropicReply(JSON.stringify(WORDS)));

  /* ---------- 14. 模型列表 ---------- */
  section('14. 拉取模型列表');

  await setSelect(providerEl, 'openai');
  await setVal(keyEl, 'sk-test-key');
  responder = () => reply({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'o3' }] });
  calls.length = 0;
  await click($('#wv-models'), 120);

  ok('向 OpenAI 的 /v1/models 发了 GET',
     calls.length === 1 && calls[0].url === 'https://api.openai.com/v1/models' &&
     calls[0].method === 'GET', calls[0] && calls[0].url);
  ok('列表请求带上了 Bearer',
     calls[0].headers['Authorization'] === 'Bearer sk-test-key');
  const opts = $$('#wv-model-list option').map((o) => o.value);
  ok('拉到的模型进了候选列表',
     opts.join(',') === 'gpt-4o,gpt-4o-mini,o3', opts.join(','));
  ok('给出了拉取结果提示',
     $('#wv-models-status').textContent.includes('3 个模型'), $('#wv-models-status').textContent);

  await setSelect(providerEl, 'anthropic');
  responder = () => reply({ models: [{ id: 'claude-sonnet-4-5' }, { display_name: 'Claude Opus' }] });
  calls.length = 0;
  await click($('#wv-models'), 120);
  ok('Anthropic 的列表端点也认',
     calls[0].url === 'https://api.anthropic.com/v1/models', calls[0] && calls[0].url);
  ok('Anthropic 的列表走 x-api-key', calls[0].headers['x-api-key'] === 'sk-test-key');

  await setSelect(providerEl, 'google');
  calls.length = 0;
  await click($('#wv-models'), 120);
  ok('Gemini 不发请求，直接用内置候选', calls.length === 0, String(calls.length));
  ok('Gemini 的候选进了列表', $$('#wv-model-list option').length === 3);

  await setSelect(providerEl, 'custom');
  await click($('#wv-models'), 120);
  ok('自定义接口明说不支持拉列表',
     $('#wv-models-status').textContent.includes('手填'), $('#wv-models-status').textContent);

  /* ---------- 15. 配置的保存与回填 ---------- */
  section('15. 配置保存与回填');

  await setSelect(providerEl, 'openai');
  await setVal(keyEl, 'sk-saved-key');
  await setVal(modelEl, 'gpt-4o-mini');
  await sleep(520);   /* 等防抖（400ms）落地 */

  const rawStored = w.localStorage.getItem('toolbox-whisper-verifier');
  ok('配置写进了 localStorage', !!rawStored, String(rawStored));
  const stored = JSON.parse(rawStored || '{}');
  ok('存下了 Key', stored.key === 'sk-saved-key', stored.key);
  ok('存下了服务商', stored.provider === 'openai', stored.provider);
  ok('存下了模型名', stored.model === 'gpt-4o-mini', stored.model);
  ok('保存提示出现过', saveEl.textContent.includes('保存'), saveEl.textContent);

  /* 换一次服务商时，模型名跟着换（因为还是上一家的默认值） */
  await setVal(modelEl, 'gpt-4o');
  await sleep(520);
  await setSelect(providerEl, 'anthropic');
  ok('切服务商时把上一家的默认模型换掉',
     modelEl.value === 'claude-sonnet-4-5', modelEl.value);

  await setVal(modelEl, '我自己的模型名');
  await setSelect(providerEl, 'google');
  ok('用户自己填过的模型名不被覆盖', modelEl.value === '我自己的模型名', modelEl.value);

  /* 清除 Key */
  await click($('#wv-key-clear'), 60);
  ok('清除 Key 后输入框空了', keyEl.value === '', keyEl.value);
  ok('清除 Key 后本地存的也空了',
     JSON.parse(w.localStorage.getItem('toolbox-whisper-verifier') || '{}').key === '');
  await sleep(20);

  /* 新开一个页面：配置应当回填 */
  {
    const page2 = await loadPage(PAGE, {
      storage: { 'toolbox-whisper-verifier': JSON.stringify({
        key: 'sk-from-last-time', provider: 'google', model: 'gemini-2.5-flash',
        endpoint: 'https://x.example.com/v1'
      }) }
    });
    const d2 = page2.d;
    ok('换页面后 Key 回填了', d2.querySelector('#wv-key').value === 'sk-from-last-time');
    ok('换页面后服务商回填了', d2.querySelector('#wv-provider').value === 'google');
    ok('换页面后模型名回填了', d2.querySelector('#wv-model').value === 'gemini-2.5-flash');
    ok('非自定义接口时地址那一格仍是收起的',
       d2.querySelector('#wv-endpoint-field').hidden === true);
    ok('回填的页面上没有脚本错误', page2.errors.length === 0, page2.errors.join(' | '));
  }

  /* 坏数据与错类型 */
  {
    const page3 = await loadPage(PAGE, {
      storage: { 'toolbox-whisper-verifier': '{ 这不是 JSON' }
    });
    ok('存的是坏 JSON 时不崩，回落默认值',
       page3.d.querySelector('#wv-provider').value === 'anthropic' &&
       page3.d.querySelector('#wv-key').value === '',
       page3.d.querySelector('#wv-provider').value);
    ok('坏 JSON 页面上没有脚本错误', page3.errors.length === 0, page3.errors.join(' | '));
  }
  {
    const page4 = await loadPage(PAGE, {
      storage: { 'toolbox-whisper-verifier': JSON.stringify({
        key: 12345, provider: { evil: true }, model: ['a'], endpoint: null
      }) }
    });
    const d4 = page4.d;
    ok('字段类型不对时逐个回落（key 不是字符串就当空）',
       d4.querySelector('#wv-key').value === '', JSON.stringify(d4.querySelector('#wv-key').value));
    ok('不存在的服务商回落到 anthropic',
       d4.querySelector('#wv-provider').value === 'anthropic', d4.querySelector('#wv-provider').value);
    ok('模型名不是字符串时被忽略，回落成默认值',
       d4.querySelector('#wv-model').value === 'claude-sonnet-4-5',
       d4.querySelector('#wv-model').value);
    ok('错类型页面上没有脚本错误', page4.errors.length === 0, page4.errors.join(' | '));
  }
  {
    /* provider 里塞一个原型上的属性名，不能被当成合法服务商 */
    const page5 = await loadPage(PAGE, {
      storage: { 'toolbox-whisper-verifier': JSON.stringify({ provider: 'constructor' }) }
    });
    ok('原型链上的属性名不会被当成服务商',
       page5.d.querySelector('#wv-provider').value === 'anthropic',
       page5.d.querySelector('#wv-provider').value);
    ok('原型污染尝试后没有脚本错误', page5.errors.length === 0, page5.errors.join(' | '));
  }

  /* ---------- 16. 示例与清空 ---------- */
  section('16. 示例与清空');

  await click($('#wv-demo'), 60);
  ok('示例填进了转录文本', textEl.value.includes('この装備'), textEl.value);
  ok('示例填进了背景说明', contextEl.value.includes('动画台词'), contextEl.value);
  ok('示例填了两个疑难词', terms().join(',') === '装備,提督', terms().join(','));
  ok('示例提示要自己填 Key', statusText().includes('Key'), statusText());

  await setVal(keyEl, 'sk-keep-me');
  await click($('#wv-reset'), 60);
  ok('清空后转录文本为空', textEl.value === '');
  ok('清空后背景说明为空', contextEl.value === '');
  ok('清空后疑难词为空', terms().length === 0, String(terms().length));
  ok('清空后结果区回到空状态', !!$('#wv-result .wv-result-empty'));
  ok('清空不动接口配置', keyEl.value === 'sk-keep-me', keyEl.value);

  /* ---------- 17. 边界：重复点击与并发 ---------- */
  section('17. 重复点击不并发');

  await fill({ terms: ['装備', '提督'] });
  let release = null;
  responder = () => new Promise((resolve) => {
    release = () => resolve(reply(anthropicReply(JSON.stringify(WORDS))));
  });
  calls.length = 0;
  await click(analyzeBtn, 40);
  await click(analyzeBtn, 40);
  ok('请求进行中时再点不会再发一次', calls.length === 1, String(calls.length));
  ok('请求进行中按钮是禁用的', analyzeBtn.disabled === true);
  if (release) release();
  await sleep(140);
  ok('响应回来后按钮恢复', analyzeBtn.disabled === false);
}
