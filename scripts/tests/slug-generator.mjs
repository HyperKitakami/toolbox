/* ==========================================================================
   Slug 生成（slug-generator）测试
   --------------------------------------------------------------------------
   用真实 DOM 交互驱动：设 textarea.value + dispatch input + 等防抖。
   期望值一律手算，拼音部分对着 Unihan 的 kMandarin 逐个核过。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const { d, w, errors } = await loadPage('tools/slug-generator/index.html', {
    clipboard: (t) => { copied = t; }
  });

  const $ = (sel) => d.querySelector(sel);
  const input = d.getElementById('sg-input');
  const maxLenEl = d.getElementById('sg-maxlen');

  const out = () => d.getElementById('sg-output').textContent;
  const slugs = () => out().split('\n').filter(Boolean);
  const statVal = (i) => d.querySelectorAll('#sg-stats .stat')[i]
    .querySelector('.stat-value').textContent;

  const click = async (sel) => {
    $(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
  };
  const setText = async (text) => {
    input.value = text;
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);
  };
  const setOpt = async (key, value) => {
    const chip = $(`[data-opt="${key}"][data-value="${value}"]`);
    if (chip.getAttribute('aria-pressed') !== 'true') {
      chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await sleep(30);
    }
  };
  const setMaxLen = async (n) => {
    maxLenEl.value = String(n);
    maxLenEl.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);
  };

  /* 每个用例都把选项显式摆好，不依赖上一个用例留下的状态 */
  const prep = async (text, cfg = {}) => {
    await click('#sg-reset');
    for (const k of Object.keys(cfg)) {
      if (k === 'maxLen') continue;
      await setOpt(k, cfg[k]);
    }
    await setMaxLen(cfg.maxLen === undefined ? 0 : cfg.maxLen);
    await setText(text);
  };

  /* ---------- 1. 基本渲染 ---------- */
  section('1. 基本渲染');

  ok('无脚本错误', errors.length === 0, errors.join(' | '));
  ok('拼音表已加载', w.TOOLBOX_PINYIN && w.TOOLBOX_PINYIN.chars === 6763,
     w.TOOLBOX_PINYIN ? String(w.TOOLBOX_PINYIN.chars) : '未加载');
  ok('统计格 4 个', d.querySelectorAll('#sg-stats .stat').length === 4);
  ok('空输入时输出区为空', out() === '');
  ok('默认选项：转拼音 / 全拼 / 短横线 / 小写',
     $('[data-opt="chinese"][data-value="pinyin"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="pinyinStyle"][data-value="full"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="sep"][data-value="-"]').getAttribute('aria-pressed') === 'true' &&
     $('[data-opt="letterCase"][data-value="lower"]').getAttribute('aria-pressed') === 'true');
  ok('最大长度默认 0', maxLenEl.value === '0', maxLenEl.value);

  /* ---------- 2. 基础转换 ---------- */
  section('2. 基础转换');

  await prep('Hello World!');
  ok('英文转小写并去标点', out() === 'hello-world', out());

  await prep('hello_world');
  ok('下划线也是分隔符', out() === 'hello-world', out());

  await prep('  spaced  out  ');
  ok('首尾与连续空白不产生多余分隔符', out() === 'spaced-out', out());

  await prep('C++ & C#');
  ok('符号连排只算一个分隔符', out() === 'c-c', out());

  await prep('---');
  ok('全是标点时输出为空', out() === '', JSON.stringify(out()));

  await prep('a\n\nb');
  ok('空行被跳过', out() === 'a\nb', JSON.stringify(out()));

  await prep('one\ntwo\nthree');
  ok('逐行生成', slugs().length === 3, String(slugs().length));
  ok('逐行结果正确', out() === 'one\ntwo\nthree', JSON.stringify(out()));

  /* ---------- 3. 中文转拼音 ---------- */
  section('3. 中文转拼音');

  await prep('你好世界');
  ok('每个汉字一个音节', out() === 'ni-hao-shi-jie', out());

  await prep('如何用 Python 写一个爬虫');
  ok('中英混排', out() === 'ru-he-yong-python-xie-yi-ge-pa-chong', out());

  await prep('中文 test');
  ok('中文与英文之间只留一个分隔符', out() === 'zhong-wen-test', out());

  await prep('绿色出行');
  ok('ü 按 slug 惯例写成 v', out() === 'lv-se-chu-xing', out());

  await prep('2008 年北京奥运会');
  ok('数字与汉字混排', out() === '2008-nian-bei-jing-ao-yun-hui', out());

  /* ---------- 4. 拼音首字母 ---------- */
  section('4. 拼音首字母');

  await prep('你好世界', { pinyinStyle: 'initial' });
  ok('连续中文合并成一个词', out() === 'nhsj', out());

  await prep('你好 世界', { pinyinStyle: 'initial' });
  ok('中间有分隔符就分开', out() === 'nh-sj', out());

  await prep('中文 test', { pinyinStyle: 'initial' });
  ok('首字母与英文混排', out() === 'zw-test', out());

  /* ---------- 5. 分隔符与大小写 ---------- */
  section('5. 分隔符与大小写');

  await prep('Hello World', { sep: '_' });
  ok('下划线分隔', out() === 'Hello_World'.toLowerCase(), out());

  await prep('Hello World', { sep: '' });
  ok('无分隔符', out() === 'helloworld', out());

  await prep('Hello World', { letterCase: 'upper' });
  ok('大写', out() === 'HELLO-WORLD', out());

  await prep('Hello World', { letterCase: 'keep' });
  ok('原样保留大小写', out() === 'Hello-World', out());

  await prep('hello world', { letterCase: 'keep', sep: '_' });
  ok('原样 + 下划线', out() === 'hello_world', out());

  /* ---------- 6. 中文的三种处理方式 ---------- */
  section('6. 中文处理方式');

  await prep('你好 world', { chinese: 'keep' });
  ok('保留中文', out() === '你好-world', out());

  await prep('你好 world', { chinese: 'drop' });
  ok('删除中文', out() === 'world', out());

  await prep('你好世界', { chinese: 'drop' });
  ok('全中文删除后输出为空', out() === '', JSON.stringify(out()));

  /* ---------- 7. 重音符号与特殊字母 ---------- */
  section('7. 重音符号与特殊字母');

  await prep('Café');
  ok('é → e', out() === 'cafe', out());

  await prep('München');
  ok('ü → u（拉丁字母的 ü 走分解，不是拼音的 v）', out() === 'munchen', out());

  await prep('Straße');
  ok('ß → ss', out() === 'strasse', out());

  await prep('Ærø');
  ok('æ → ae、ø → o', out() === 'aero', out());

  await prep('Crème Brûlée');
  ok('多个重音字母一起处理', out() === 'creme-brulee', out());

  /* ---------- 8. 最大长度 ---------- */
  section('8. 最大长度');

  await prep('hello wonderful world', { maxLen: 10 });
  ok('在最后一个分隔符处回退截断', out() === 'hello', out());

  await prep('hello world', { maxLen: 3 });
  ok('没有可回退的分隔符时硬截断', out() === 'hel', out());

  await prep('hello world', { maxLen: 100 });
  ok('未超过上限时不动', out() === 'hello-world', out());

  await prep('hello world', { maxLen: 0 });
  ok('0 表示不限', out() === 'hello-world', out());

  await prep('hello world', { maxLen: 11 });
  ok('正好等于上限时不截断', out() === 'hello-world', out());

  await prep('你好世界你好世界', { maxLen: 8 });
  ok('拼音结果同样按词边界截断', out() === 'ni-hao', out());

  /* 非数字输入要标红并回退到 0（不限），不能把 NaN 带进计算 */
  await prep('hello world');
  maxLenEl.value = 'abc';
  maxLenEl.dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(170);
  ok('非数字输入时按 0 处理', out() === 'hello-world', out());
  ok('非数字输入被标红', maxLenEl.classList.contains('input--invalid'));
  maxLenEl.dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(30);
  ok('失焦后回退成 0 并清掉标红',
     maxLenEl.value === '0' && !maxLenEl.classList.contains('input--invalid'),
     maxLenEl.value);

  /* ---------- 9. 表外汉字 ---------- */
  section('9. 表外汉字');

  await prep('〇 test');
  ok('表外汉字按分隔符处理', out() === 'test', out());
  ok('底部说明提示有字不在表里',
     $('#sg-foot').textContent.includes('1 个字不在表里'), $('#sg-foot').textContent);
  ok('汉字统计仍然计入', statVal(3) === '1', statVal(3));

  await prep('你好 test');
  ok('表内汉字不触发提示',
     !$('#sg-foot').textContent.includes('不在表里'), $('#sg-foot').textContent);

  /* ---------- 10. 统计 ---------- */
  section('10. 统计');

  await prep('如何用 Python 写一个爬虫');
  /* 输入：如何用(3) + 空格(1) + Python(6) + 空格(1) + 写一个爬虫(5) = 16 */
  ok('输入字符数', statVal(0) === '16', statVal(0));
  /* 输出：ru-he-yong-python-xie-yi-ge-pa-chong = 9 个音节 28 字母 + 8 个分隔符 = 36 */
  ok('输出字符数', statVal(1) === '36', statVal(1));
  ok('输出行数', statVal(2) === '1', statVal(2));
  /* 汉字：如何用写一个爬虫 = 8 个 */
  ok('汉字数', statVal(3) === '8', statVal(3));

  await prep('a\n\n\nb');
  ok('跳过空行时输出行数为 2', statVal(2) === '2', statVal(2));
  ok('结果区底部说明跳过数量',
     $('#sg-out-foot').textContent.includes('2 个空行'), $('#sg-out-foot').textContent);

  await prep('one\ntwo');
  ok('没有跳过时说明回到默认文案',
     $('#sg-out-foot').textContent.includes('空行会被跳过'), $('#sg-out-foot').textContent);

  /* ---------- 11. 复制 ---------- */
  section('11. 复制');

  await prep('one\ntwo');
  copied = null;
  await click('[data-copy-target="#sg-output"]');
  ok('复制的是完整的多行结果', copied === 'one\ntwo', JSON.stringify(copied));

  /* ---------- 12. 恢复默认 ---------- */
  section('12. 恢复默认');

  await prep('你好 world', {
    chinese: 'keep', pinyinStyle: 'initial', sep: '', letterCase: 'upper', maxLen: 5
  });
  ok('改动生效（前置条件检查）', out() === '你好WOR', JSON.stringify(out()));

  await click('#sg-reset');
  ok('恢复默认后中文转拼音',
     $('[data-opt="chinese"][data-value="pinyin"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后全拼',
     $('[data-opt="pinyinStyle"][data-value="full"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后短横线',
     $('[data-opt="sep"][data-value="-"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后小写',
     $('[data-opt="letterCase"][data-value="lower"]').getAttribute('aria-pressed') === 'true');
  ok('恢复默认后长度归 0', maxLenEl.value === '0', maxLenEl.value);
  ok('恢复默认后结果回到默认转换', out() === 'ni-hao-world', out());

  /* ---------- 13. 示例 ---------- */
  section('13. 示例');

  await click('[data-demo]');
  ok('示例有 3 行结果', slugs().length === 3, String(slugs().length));
  ok('示例：中文标题', slugs()[0] === 'ru-he-yong-python-xie-yi-ge-pa-chong', slugs()[0]);
  ok('示例：重音字母', slugs()[1] === 'cafe-yu-ka-fei-na-ge-geng-hao-he', slugs()[1]);
  ok('示例：全角括号被去掉', slugs()[2] === '2026-nian-qian-duan-kai-fa-qu-shi-shang', slugs()[2]);

  await click('[data-clear]');
  ok('清空后输出区为空', out() === '');

  /* ---------- 14. 页面结构 ---------- */
  section('14. 页面结构');

  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为文本分类的绿色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#16a34a',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区写明了拼音表来源', d.body.textContent.includes('Unihan'));
  ok('说明区写明了多音字的处理方式', d.body.textContent.includes('多音字'));

  ok('全程无脚本错误', errors.length === 0, errors.join(' | '));
}
