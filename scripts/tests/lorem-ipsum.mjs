/* ==========================================================================
   占位文本生成
   移植自 Praticulus 的 lorem-ipsum。测试重点：
     - 功能：语言、单位、数量、经典开头、HTML 包裹、复制下载、统计；
     - 回归：逐条锁住移植时修掉的缺陷（后行断言、单词模式下 HTML 开关失效、
             超量时的整块重复、数量不校验、复制没有降级、语料标注不符）。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/lorem-ipsum/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const CORPUS = w.TOOLBOX.corpus;

  const $ = (sel) => d.querySelector(sel);
  const out = () => $('#li-output').textContent;
  const paras = () => out().split('\n\n');
  const lines = () => out().split('\n').filter((l) => l.trim());
  const stats = () => {
    const o = {};
    for (const s of d.querySelectorAll('#li-stats .stat')) {
      o[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return o;
  };
  const status = () => $('#li-status').textContent;
  const unitNames = () =>
    [...d.querySelectorAll('#li-units .choice-chip')].map((c) => c.textContent);

  const fire = async (el, type, wait = 170) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const setVal = (el, v) => { el.value = v; return fire(el, 'input'); };
  const setCheck = async (el, on) => { el.checked = on; await fire(el, 'change'); };
  const click = async (sel, wait = 170) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const lang = (id) => click('#li-langs [data-lang="' + id + '"]');
  const unit = (id) => click('#li-units [data-unit="' + id + '"]');
  const setCount = (n) => setVal($('#li-count'), String(n));

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('两套语言都渲染了', count(d, '#li-langs .choice-chip') === 2,
     String(count(d, '#li-langs .choice-chip')));
  ok('默认是拉丁文',
     $('#li-langs [data-lang="la"]').getAttribute('aria-pressed') === 'true');
  ok('拉丁文下四个单位齐全', unitNames().join(',') === '段落,句子,单词,列表项', unitNames().join(','));
  ok('默认单位是段落',
     $('#li-units [data-unit="paragraphs"]').getAttribute('aria-pressed') === 'true');
  ok('默认数量 3', $('#li-count').value === '3', $('#li-count').value);
  ok('默认勾选「以经典开头」', $('#li-classic').checked);
  ok('输出 3 段', paras().length === 3, String(paras().length));
  ok('第一段就是 Cicero 原文第一段', paras()[0] === CORPUS.la[0], paras()[0].slice(0, 40));
  ok('四个统计格子',
     Object.keys(stats()).join(',') === '字符数,单词数,条目数,字节数',
     Object.keys(stats()).join(','));
  ok('条目数 = 3', stats()['条目数'] === '3', stats()['条目数']);
  ok('状态行给出单位与字符数',
     /已生成 3 个段落，纯文本共 [\d,]+ 个字符/.test(status()), status());
  ok('语料信息给出段落/句子/单词数',
     /^8 段 · 24 句 · 398 个单词\n/.test($('#li-corpus-info').textContent),
     JSON.stringify($('#li-corpus-info').textContent.slice(0, 30)));
  ok('语料信息带一段开头预览',
     $('#li-corpus-info').textContent.includes('Lorem ipsum dolor sit amet'));

  /* ---------- 2. 经典开头 ---------- */
  section('2. 以经典开头');
  await setCheck($('#li-classic'), false);

  /* 关掉之后第一段是从 8 段里随机取的 —— 单次比较会**假失败**
     （有 1/8 的概率正好抽到经典段），所以连续生成几次看它会不会变 */
  const firsts = new Set();
  for (let i = 0; i < 8; i++) {
    firsts.add(paras()[0]);
    if (i < 7) await click('#li-regenerate');
  }
  ok('取消后第一段不再固定为经典段落', firsts.size > 1, firsts.size + ' 种取值');
  ok('取消后仍然出 3 段', paras().length === 3, String(paras().length));

  await setCheck($('#li-classic'), true);
  ok('勾选后经典段落只出现一次',
     paras().filter((p) => p === CORPUS.la[0]).length === 1,
     String(paras().filter((p) => p === CORPUS.la[0]).length));
  ok('勾选后其余段落都来自语料',
     paras().every((p) => CORPUS.la.includes(p)), paras()[1].slice(0, 40));

  /* 回归：上游用 pool[i % pool.length] 让第 2 轮与第 1 轮逐字相同 */
  await setCount(20);
  const p20 = paras();
  ok('要 20 段时确实出 20 段', p20.length === 20, String(p20.length));
  ok('回归：第 9–16 段不是第 1–8 段的逐字复制',
     p20.slice(0, 8).join('|') !== p20.slice(8, 16).join('|'));
  ok('20 段里 8 段语料都用上了',
     new Set(p20).size === 8, String(new Set(p20).size));
  await setCount(3);

  /* ---------- 3. 单位 ---------- */
  section('3. 四种单位');
  await unit('sentences');
  ok('句子：并成一段（条目数 1）', stats()['条目数'] === '1', stats()['条目数']);
  ok('句子：句末标点齐全', /[.?!]/.test(out()), out().slice(-40));
  ok('句子：第一句是经典开头', out().startsWith('Lorem ipsum dolor sit amet,'), out().slice(0, 40));
  ok('句子：3 句之间用空格连接',
     out().split(/\s+/).length > 3, out().slice(0, 60));

  await unit('words');
  ok('单词：条目数 1', stats()['条目数'] === '1', stats()['条目数']);
  ok('单词：全部是小写字母', /^[a-z ]+$/.test(out()), out().slice(0, 60));
  ok('单词：正好 3 个词', out().split(/\s+/).length === 3, out());
  ok('单词：经典开头就是语料最前面的三个词',
     out() === 'lorem ipsum dolor', out());
  ok('回归：词与词之间没有多余空格（上游会推进空串）',
     !/ {2,}/.test(out()), JSON.stringify(out()));

  await unit('list');
  ok('列表项：3 条', lines().length === 3, String(lines().length));
  ok('列表项：每条都不带句末标点',
     lines().every((l) => !/[.?!,]$/.test(l)), lines()[0]);
  ok('列表项：每条首字母大写',
     lines().every((l) => /^[A-Z]/.test(l)), lines()[0]);
  ok('列表项：比整句短', lines()[0].split(/\s+/).length <= 8,
     String(lines()[0].split(/\s+/).length));

  await unit('paragraphs');

  /* ---------- 4. HTML 包裹 ---------- */
  section('4. 包一层 HTML 标签');
  const num = (s) => Number(String(s).replace(/,/g, ''));

  /* 纯文本模式下，字符数应该与输出长度严格相等 */
  ok('纯文本时字符数 = 输出长度',
     num(stats()['字符数']) === Array.from(out()).length,
     stats()['字符数'] + ' vs ' + Array.from(out()).length);

  await setCheck($('#li-html'), true);
  ok('段落：每段一个 <p>',
     (out().match(/<p>/g) || []).length === 3 && (out().match(/<\/p>/g) || []).length === 3,
     out().slice(0, 60));
  ok('段落：标签之间没有多余空行', !/\n\n/.test(out()));
  ok('统计按纯文本算，不含 HTML 标签',
     num(stats()['字符数']) < Array.from(out()).length,
     stats()['字符数'] + ' vs ' + Array.from(out()).length);
  ok('差值正好是标签占的字符数（3 组 <p></p> 共 21 个，减去 2 个被合并的换行）',
     Array.from(out()).length - num(stats()['字符数']) === 21 - 2,
     String(Array.from(out()).length - num(stats()['字符数'])));

  await unit('list');
  ok('列表：包成 <ul> / <li>',
     out().startsWith('<ul>\n') && out().trimEnd().endsWith('</ul>') &&
     (out().match(/<li>/g) || []).length === 3, out().slice(0, 60));

  await unit('words');
  ok('回归：单词模式下 HTML 开关也生效（上游这里是静默失效的）',
     out().startsWith('<p>') && out().endsWith('</p>'), out().slice(0, 40));

  await unit('sentences');
  ok('句子：包成单个 <p>',
     out().startsWith('<p>') && out().endsWith('</p>') &&
     (out().match(/<p>/g) || []).length === 1, out().slice(0, 40));

  await unit('paragraphs');
  await setCheck($('#li-html'), false);
  ok('关掉后回到纯文本', !out().includes('<p>'), out().slice(0, 40));

  /* ---------- 5. 数量校验 ---------- */
  section('5. 数量');
  await setCount(1);
  ok('数量 1 -> 1 段', paras().length === 1, String(paras().length));
  await setCount(100);
  ok('数量 100 -> 100 段', paras().length === 100, String(paras().length));

  await setCount(0);
  ok('数量 0 标红', $('#li-count').classList.contains('input--invalid'));
  ok('数量非法时按 1 渲染', paras().length === 1, String(paras().length));
  await fire($('#li-count'), 'blur');
  ok('失焦后回退为 1', $('#li-count').value === '1', $('#li-count').value);
  ok('失焦后清掉标红', !$('#li-count').classList.contains('input--invalid'));

  await setCount(500);
  ok('数量 500 标红', $('#li-count').classList.contains('input--invalid'));
  ok('回归：上游会静默截断到 100 且没有提示', paras().length === 100, String(paras().length));
  await fire($('#li-count'), 'blur');
  ok('失焦后回退为 100', $('#li-count').value === '100', $('#li-count').value);

  await setCount(3);

  /* ---------- 6. 重新生成 ---------- */
  section('6. 重新生成');
  /* 3 段里有 2 段来自 7 项的随机排列，两次生成碰巧一致的概率约 1/42，
     所以重试几次 —— 单次断言会偶发假失败 */
  let changed = false;
  for (let i = 0; i < 3 && !changed; i++) {
    const b = paras().join('|');
    await click('#li-regenerate');
    if (paras().join('|') !== b) changed = true;
  }
  const after = paras();
  ok('重新生成后段落顺序变化', changed);
  ok('重新生成后段数不变', after.length === 3, String(after.length));
  ok('重新生成后第一段仍是经典段落', after[0] === CORPUS.la[0], after[0].slice(0, 40));

  /* ---------- 7. 中文语料 ---------- */
  section('7. 中文语料');
  await lang('zh');
  ok('切到中文后单位只剩三个', unitNames().join(',') === '段落,句子,列表项', unitNames().join(','));
  ok('中文下没有「单词」这一档', !unitNames().includes('单词'));
  ok('中文下「以经典开头」被禁用', $('#li-classic').disabled === true);
  ok('中文下提示改成了说明文案',
     $('#li-classic-hint').textContent.includes('中文语料'), $('#li-classic-hint').textContent);
  ok('中文输出不含拉丁字母', !/[A-Za-z]/.test(out()), out().slice(0, 40));
  ok('中文输出是 3 段', paras().length === 3, String(paras().length));
  ok('统计格子换成汉字数',
     Object.keys(stats()).join(',') === '字符数,汉字数,条目数,字节数',
     Object.keys(stats()).join(','));
  ok('中文语料信息不含单词数（中文没有词边界）',
     /^8 段 · 23 句\n/.test($('#li-corpus-info').textContent),
     JSON.stringify($('#li-corpus-info').textContent.slice(0, 20)));
  ok('中文语料信息给出中文开头',
     $('#li-corpus-info').textContent.includes('这是一段用于排版预览'), 
     $('#li-corpus-info').textContent.split('\n')[1].slice(0, 20));

  await unit('sentences');
  ok('中文句子以全角句末标点结尾', /[。！？]$/.test(out().trim()), out().slice(-20));
  ok('中文句子之间用空格分隔', /[。！？] /.test(out()), out().slice(0, 60));

  await unit('list');
  ok('中文列表项不带标点', lines().every((l) => !/[。！？，、；：]$/.test(l)), lines()[0]);
  ok('中文列表项是短句', lines().every((l) => l.length <= 24), lines()[0]);

  /* 切回拉丁文：单位恢复，「单词」不会因为中文而永久消失 */
  await lang('la');
  ok('切回拉丁文后单位恢复四个', unitNames().join(',') === '段落,句子,单词,列表项', unitNames().join(','));
  ok('切回拉丁文后经典开关可用', $('#li-classic').disabled === false);
  ok('切回拉丁文后仍是勾选状态', $('#li-classic').checked);

  /* 中文下选中「单词」再切语言，要退回可用的档位 */
  await lang('zh');
  await unit('list');
  await lang('la');
  await unit('words');
  await lang('zh');
  ok('中文下选中「单词」会被退回「段落」',
     $('#li-units [data-unit="paragraphs"]').getAttribute('aria-pressed') === 'true',
     unitNames().join(','));
  await lang('la');
  await unit('paragraphs');

  /* ---------- 8. 复制与下载 ---------- */
  section('8. 复制与下载');
  await setCount(3);
  const text = out();
  copied = null;
  await click('[data-copy-target="#li-output"]');
  ok('复制按钮复制的是输出内容', copied === text, JSON.stringify(copied).slice(0, 40));

  ok('下载按钮存在', $('#li-download') !== null);

  /* ---------- 9. 语料完整性 ---------- */
  section('9. 语料');
  ok('拉丁语料 8 段', CORPUS.la.length === 8, String(CORPUS.la.length));
  ok('中文语料 8 段', CORPUS.zh.length === 8, String(CORPUS.zh.length));
  ok('拉丁语料前 6 段是 Cicero 原文（开头可对上）',
     CORPUS.la[0].startsWith('Lorem ipsum dolor sit amet') &&
     CORPUS.la[1].startsWith('Sed ut perspiciatis') &&
     CORPUS.la[2].startsWith('Neque porro quisquam') &&
     CORPUS.la[3].startsWith('Quis autem vel eum') &&
     CORPUS.la[4].startsWith('Similique sunt in culpa') &&
     CORPUS.la[5].startsWith('Temporibus autem quibusdam'));
  ok('回归：后 2 段本来就不是 Cicero 原文（标注已改准）',
     !CORPUS.la[6].includes('lorem') && !CORPUS.la[7].includes('lorem'));
  ok('中文语料全为中文（含标点，无拉丁字母）',
     CORPUS.zh.every((p) => !/[A-Za-z]/.test(p)));
  ok('中文语料每段都有句末标点',
     CORPUS.zh.every((p) => /[。！？]$/.test(p)));
  ok('拉丁语料每段都有句末标点',
     CORPUS.la.every((p) => /[.?!]$/.test(p)));

  /* ---------- 10. 页面结构 ---------- */
  section('10. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为生成器的琥珀色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d97706',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区讲清了 Lorem ipsum 的出处',
     d.querySelector('.tool-notes').textContent.includes('De Finibus'));
  ok('说明区说明中文语料是自撰的',
     d.querySelector('.tool-notes').textContent.includes('本项目自己写的'));
  ok('结果区用的是正文字体而不是等宽字体',
     d.querySelector('#li-output').classList.contains('output--prose'));
}
