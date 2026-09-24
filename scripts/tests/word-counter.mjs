/* ==========================================================================
   字数统计
   站点的第一个工具，也是统计类工具的参考实现。之前只被全站测试间接覆盖，
   这里补上专属套件：中英混排的计数规则、代理对、词频、阅读时长、复制。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/word-counter/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const inputEl = () => d.getElementById('wc-input');
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#wc-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const freqItems = () => [...d.querySelectorAll('#wc-freq .freq-item')];
  const freqWords = () => freqItems().map((li) => li.querySelector('.freq-word').textContent);
  const freqCounts = () => freqItems().map((li) => Number(li.querySelector('.freq-count').textContent));

  const setText = async (text, wait = 140) => {
    const el = inputEl();
    el.value = text;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const click = async (sel, wait = 140) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('统计格子 8 个', count(d, '#wc-stats .stat') === 8, String(count(d, '#wc-stats .stat')));
  ok('八个指标齐全',
     Object.keys(stats()).join(',') === '总字符数,不含空格,汉字,英文单词,行数,段落,句子,阅读时长',
     Object.keys(stats()).join(','));
  ok('空输入时全部为 0',
     stats()['总字符数'] === '0' && stats()['行数'] === '0' && stats()['阅读时长'] === '—',
     JSON.stringify(stats()));
  ok('空输入时词频显示空状态', d.querySelector('#wc-freq .freq-empty') !== null);

  /* ---------- 2. 中英混排 ---------- */
  section('2. 中英混排计数');
  await setText('你好世界 hello world');
  ok('总字符数按码点计 = 16', stats()['总字符数'] === '16', stats()['总字符数']);
  ok('不含空格 = 14', stats()['不含空格'] === '14', stats()['不含空格']);
  ok('汉字 = 4', stats()['汉字'] === '4', stats()['汉字']);
  ok('英文单词 = 2', stats()['英文单词'] === '2', stats()['英文单词']);
  ok('行数 = 1', stats()['行数'] === '1', stats()['行数']);
  ok('段落 = 1', stats()['段落'] === '1', stats()['段落']);
  ok('无句末标点时句子 = 0', stats()['句子'] === '0', stats()['句子']);
  ok('短文本阅读时长按秒显示', stats()['阅读时长'] === '1 秒', stats()['阅读时长']);

  await setText('你好世界，你好世界。');
  ok('中文标点不计入汉字', stats()['汉字'] === '8', stats()['汉字']);
  ok('中文句末标点计入句子', stats()['句子'] === '1', stats()['句子']);

  /* ---------- 3. 行与段落 ---------- */
  section('3. 行数与段落');
  await setText('第一段。\n\n第二段 hello');
  ok('空行分隔出 3 行', stats()['行数'] === '3', stats()['行数']);
  ok('空行分隔出 2 段', stats()['段落'] === '2', stats()['段落']);
  ok('汉字 6 个', stats()['汉字'] === '6', stats()['汉字']);
  ok('英文单词 1 个', stats()['英文单词'] === '1', stats()['英文单词']);
  ok('句子 1 个', stats()['句子'] === '1', stats()['句子']);

  await setText('一行\n两行\n三行');
  ok('单换行只算行不算段', stats()['行数'] === '3' && stats()['段落'] === '1',
     `行 ${stats()['行数']} / 段 ${stats()['段落']}`);

  await setText('a\n\n\n\nb');
  ok('连续多个空行仍算 2 段', stats()['段落'] === '2', stats()['段落']);

  await setText('a\r\nb\r\nc');
  ok('CRLF 换行也正确', stats()['行数'] === '3', stats()['行数']);

  /* ---------- 4. 代理对与非 ASCII ---------- */
  section('4. 代理对与特殊字符');
  await setText('你好 🎉');
  ok('emoji 按 1 个码点计（不是 2）', stats()['总字符数'] === '4', stats()['总字符数']);
  ok('emoji 不计入汉字', stats()['汉字'] === '2', stats()['汉字']);

  await setText('🎉🎉🎉');
  ok('三个 emoji = 3 个字符', stats()['总字符数'] === '3', stats()['总字符数']);

  await setText('日本語と한국어');
  ok('日文假名与韩文计入汉字口径', stats()['汉字'] === '7', stats()['汉字']);

  /* ---------- 5. 英文单词规则 ---------- */
  section('5. 英文单词规则');
  await setText("don't stop it's fine");
  ok('撇号算词内字符', stats()['英文单词'] === '4', stats()['英文单词']);

  await setText('well-known state-of-the-art');
  ok('连字符把整串算作一个词（2 个词）', stats()['英文单词'] === '2', stats()['英文单词']);

  await setText('a b c');
  ok('单个字母也算词', stats()['英文单词'] === '3', stats()['英文单词']);

  await setText('test123 456');
  ok('字母数字串算词', stats()['英文单词'] === '2', stats()['英文单词']);

  /* ---------- 6. 阅读时长 ---------- */
  section('6. 阅读时长');
  await setText('中'.repeat(800));
  ok('800 汉字约 2 分钟', stats()['阅读时长'] === '2 分钟', stats()['阅读时长']);

  await setText('中'.repeat(500));
  ok('500 汉字 = 1 分 15 秒', stats()['阅读时长'] === '1 分 15 秒', stats()['阅读时长']);

  await setText(Array.from({ length: 440 }, () => 'word').join(' '));
  ok('440 个英文单词约 2 分钟', stats()['阅读时长'] === '2 分钟', stats()['阅读时长']);

  await setText('中英 mixed 混排');
  ok('不足 1 秒时显示 —', stats()['阅读时长'] === '—', stats()['阅读时长']);

  await setText('中'.repeat(200) + ' ' + Array.from({ length: 220 }, () => 'word').join(' '));
  ok('中英混排分别折算后相加（0.5 分 + 1 分 = 1 分 30 秒）',
     stats()['阅读时长'] === '1 分 30 秒', stats()['阅读时长']);

  /* ---------- 7. 词频 ---------- */
  section('7. 高频词');
  await setText('abc abc abc def def');
  ok('只列出出现两次以上的词', freqWords().join(',') === 'abc,def', freqWords().join(','));
  ok('按出现次数降序', freqCounts()[0] === 3 && freqCounts()[1] === 2, String(freqCounts()));
  ok('词频条按比例渲染',
     freqItems()[0].querySelector('.freq-bar i').style.width === '100%',
     freqItems()[0].querySelector('.freq-bar i').style.width);

  await setText('中文测试中文测试');
  ok('中文按相邻二字组合统计',
     freqWords().includes('中文') && freqWords().includes('测试'), freqWords().join(','));
  ok('只出现一次的组合不列出', !freqWords().includes('试中'), freqWords().join(','));

  const manyWords = 'abcdefghijkl'.split('').map(function (c) { return c + c + c + c + c; });
  await setText(manyWords.map(function (x) { return x + ' ' + x; }).join(' '));
  ok('12 个重复词只列前 10 条', freqItems().length === 10, String(freqItems().length));
  ok('截断时保留的是次数最多的', freqCounts().every(function (n) { return n === 2; }), String(freqCounts()));

  await setText('完全没有重复的词');
  ok('无重复时显示空状态', d.querySelector('#wc-freq .freq-empty') !== null);

  /* ---------- 8. 复制统计 ---------- */
  section('8. 复制统计');
  await setText('你好世界 hello world');
  copied = null;
  await click('#wc-copy');
  ok('复制成功', typeof copied === 'string' && copied.length > 0);
  const lines = (copied || '').split('\n');
  ok('共 8 行', lines.length === 8, String(lines.length));
  ok('首行是总字符数', lines[0] === '总字符数（含空格）：16', JSON.stringify(lines[0]));
  ok('含汉字行', lines[2] === '汉字：4', JSON.stringify(lines[2]));
  ok('末行是阅读时长', lines[7] === '预计阅读时长：1 秒', JSON.stringify(lines[7]));

  /* ---------- 9. 按钮 ---------- */
  section('9. 载入示例 / 清空');
  await click('[data-demo]');
  ok('载入示例后有内容', inputEl().value.length > 0);
  ok('示例是 4 行', stats()['行数'] === '4', stats()['行数']);
  ok('示例是 2 段', stats()['段落'] === '2', stats()['段落']);
  ok('示例含中英文', Number(stats()['汉字']) > 0 && Number(stats()['英文单词']) > 0,
     JSON.stringify({ cjk: stats()['汉字'], words: stats()['英文单词'] }));

  await click('[data-clear]');
  ok('清空后输入框为空', inputEl().value === '');
  ok('清空后统计归零', stats()['总字符数'] === '0', stats()['总字符数']);
  ok('清空后词频回到空状态', d.querySelector('#wc-freq .freq-empty') !== null);
  ok('清空后状态栏清空', d.getElementById('wc-status').textContent === '',
     JSON.stringify(d.getElementById('wc-status').textContent));

  /* ---------- 10. 边界 ---------- */
  section('10. 边界情况');
  await setText('   ');
  ok('只有空白时行数为 1', stats()['行数'] === '1', stats()['行数']);
  ok('只有空白时汉字为 0', stats()['汉字'] === '0', stats()['汉字']);

  await setText('。！？');
  ok('连续标点算 1 个句子', stats()['句子'] === '1', stats()['句子']);

  await setText('a. b. c.');
  ok('英文句号后跟空格算句末', stats()['句子'] === '3', stats()['句子']);

  await setText('v1.2.3');
  ok('句号后不跟空格不算句末', stats()['句子'] === '0', stats()['句子']);

  const big = '中'.repeat(5000);
  await setText(big, 300);
  ok('5000 字不卡死且计数正确', stats()['总字符数'] === '5,000', stats()['总字符数']);

  /* ---------- 11. 页面结构 ---------- */
  section('11. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为文本分类的绿色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#16a34a',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('面板底部说明了阅读时长的估算口径',
     [...d.querySelectorAll('.panel-foot')].some(function (el) {
       return el.textContent.includes('阅读时长') && el.textContent.includes('400 字/分');
     }));
  ok('说明区列出了计数规则',
     d.querySelector('.tool-notes').textContent.includes('Unicode 码点'));
}
