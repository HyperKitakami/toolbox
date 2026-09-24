/* ==========================================================================
   文本差异对比 测试
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/diff-checker/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;

  const badge = () => d.getElementById('dc-badge').textContent;
  const stats = () => {
    const out = {};
    for (const s of d.querySelectorAll('#dc-stats .stat')) {
      out[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return out;
  };
  const rows = () => [...d.querySelectorAll('#dc-view .diff-row')].map((r) => ({
    nos: [...r.querySelectorAll('.diff-no')].map((n) => n.textContent),
    cells: [...r.querySelectorAll('.diff-cell')].map((c) => c.textContent)
  }));
  const setText = async (left, right) => {
    const L = d.getElementById('dc-left');
    const R = d.getElementById('dc-right');
    L.value = left; R.value = right;
    L.dispatchEvent(new w.Event('input', { bubbles: true }));
    R.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(170);
  };
  const setOpt = async (id, on) => {
    const el = d.getElementById(id);
    el.checked = on;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(30);
  };
  const click = async (sel) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
  };

  /* ---------- 1. 初始状态 ---------- */
  section('1. 初始状态');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('显示空状态提示', d.querySelector('#dc-view .diff-hint') !== null);
  ok('徽章为 —', badge() === '—', badge());
  ok('统计格子 5 个', count(d, '#dc-stats .stat') === 5);

  /* ---------- 2. 完全一致 ---------- */
  section('2. 完全一致');
  await setText('a\nb\nc', 'a\nb\nc');
  ok('徽章「完全一致」', badge() === '完全一致', badge());
  ok('未变 = 3 且相似度 100%',
     stats()['未变'] === '3' && stats()['相似度'] === '100%', JSON.stringify(stats()));

  /* ---------- 3. 纯新增 / 纯删除 ---------- */
  section('3. 纯新增与纯删除');
  await setText('a\nb', 'a\nb\nc');
  ok('新增 = 1，删除 = 0，修改 = 0',
     stats()['新增'] === '1' && stats()['删除'] === '0' && stats()['修改'] === '0',
     JSON.stringify(stats()));

  await setText('a\nb\nc', 'a\nc');
  ok('删除 = 1，未变 = 2',
     stats()['删除'] === '1' && stats()['未变'] === '2', JSON.stringify(stats()));

  /* 行号追踪：删除块之后的行号不能错位 */
  const R = rows();
  ok('删除行行号 2 / 空', R[1].nos[0] === '2' && R[1].nos[1] === '', JSON.stringify(R[1].nos));
  ok('后续行行号 3 / 2（不错位）', R[2].nos[0] === '3' && R[2].nos[1] === '2',
     JSON.stringify(R[2].nos));

  /* ---------- 4. 修改配对与行内高亮 ---------- */
  section('4. 修改配对与行内字符级高亮');
  await setText('a\nhello world\nc', 'a\nhello there\nc');
  ok('修改 = 1（而非 1 删 + 1 增）', stats()['修改'] === '1', JSON.stringify(stats()));
  ok('左右两侧都有行内高亮',
     count(d, '#dc-view mark.d-del') > 0 && count(d, '#dc-view mark.d-add') > 0);
  ok('高亮只覆盖改动部分',
     d.querySelector('#dc-view mark.d-del').textContent === 'world' &&
     d.querySelector('#dc-view mark.d-add').textContent === 'there');

  /* ---------- 5. 变更块对齐（回归） ---------- */
  section('5. 变更块内的相似度对齐');
  await setText('// TODO: 稍后删掉\nconst a = 1;\nconst b = 2;', 'const a = 10;\nconst b = 20;');
  ok('块首纯删除不影响后续配对',
     stats()['删除'] === '1' && stats()['修改'] === '2' && stats()['新增'] === '0',
     JSON.stringify(stats()));
  const aligned = rows();
  ok('第 1 行是纯删除', aligned[0].nos[1] === '' && aligned[0].cells[0].includes('TODO'));
  ok('const a 配 const a', aligned[1].cells[0] === 'const a = 1;' && aligned[1].cells[1] === 'const a = 10;');
  ok('const b 配 const b', aligned[2].cells[0] === 'const b = 2;' && aligned[2].cells[1] === 'const b = 20;');

  await setText('foo bar baz', '完全不同的中文内容');
  ok('毫不相干的行不强行配对',
     stats()['修改'] === '0' && stats()['删除'] === '1' && stats()['新增'] === '1',
     JSON.stringify(stats()));

  /* ---------- 6. 忽略选项 ---------- */
  section('6. 忽略选项');
  await setText('ABC\ndef', 'abc\ndef');
  ok('默认视为修改', stats()['修改'] === '1', JSON.stringify(stats()));
  await setOpt('dc-opt-case', true);
  ok('忽略大小写后完全一致', badge() === '完全一致', badge());
  await setOpt('dc-opt-case', false);

  await setText('a\n   b   ', 'a\nb');
  ok('首尾空白差异默认视为修改', stats()['修改'] === '1', JSON.stringify(stats()));
  await setOpt('dc-opt-ws', true);
  ok('忽略首尾空白后完全一致', badge() === '完全一致', badge());
  await setOpt('dc-opt-ws', false);

  await setText('a\n\n\nb', 'a\nb');
  ok('空行差异默认可检出', badge() !== '完全一致', badge());
  await setOpt('dc-opt-blank', true);
  ok('忽略空行后完全一致', badge() === '完全一致', badge());
  ok('行数徽章仍显示原始行数', d.getElementById('dc-left-count').textContent === '4 行',
     d.getElementById('dc-left-count').textContent);
  await setOpt('dc-opt-blank', false);

  /* ---------- 7. 折叠 ---------- */
  section('7. 未变更块折叠与展开');
  const same = Array.from({ length: 20 }, (_, i) => 'line ' + (i + 1)).join('\n');
  await setText(same + '\nX', same + '\nY');
  ok('出现折叠条', d.querySelector('#dc-view .diff-collapse') !== null);
  const before = rows().length;
  const n = Number(d.querySelector('.diff-expand').textContent.match(/展开 (\d+) 行/)[1]);
  ok('折叠了 14 行', n === 14, String(n));
  await click('.diff-expand');
  ok('展开后折叠条消失', d.querySelector('#dc-view .diff-collapse') === null);
  ok('展开后行数增加 14', rows().length === before + 14, `${before} → ${rows().length}`);

  /* ---------- 8. 视图切换 ---------- */
  section('8. 并排 / 统一视图');
  await setText('a\nhello world\nc', 'a\nhello there\nc');
  const splitRows = rows().length;
  const uni = d.querySelector('input[name="dc-view"][value="unified"]');
  uni.checked = true;
  uni.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  ok('容器切换为 unified', d.getElementById('dc-view').className.includes('diff-view--unified'));
  ok('修改行在统一视图展开成 2 行', rows().length === splitRows + 1);
  const signs = [...d.querySelectorAll('#dc-view .diff-sign')].map((x) => x.textContent);
  ok('符号列含 - 与 +', signs.includes('-') && signs.includes('+'), signs.join(''));
  const split = d.querySelector('input[name="dc-view"][value="split"]');
  split.checked = true;
  split.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(30);
  ok('可切回并排', d.getElementById('dc-view').className.includes('diff-view--split'));

  await setOpt('dc-opt-wrap', false);
  ok('可关闭自动换行', !d.getElementById('dc-view').className.includes('diff-view--wrap'));
  await setOpt('dc-opt-wrap', true);

  /* ---------- 9. 按钮 ---------- */
  section('9. 交换 / 示例 / 清空');
  await setText('a\nb', 'a\nb\nc');
  await click('[data-swap]');
  ok('交换后新增变删除',
     stats()['删除'] === '1' && stats()['新增'] === '0', JSON.stringify(stats()));
  ok('交换后文本框内容互换', d.getElementById('dc-left').value === 'a\nb\nc');

  await click('[data-demo]');
  ok('示例能产生差异', Number(stats()['修改']) > 0, JSON.stringify(stats()));
  ok('底部统计出现变更块', /个变更块/.test(d.getElementById('dc-foot').textContent),
     d.getElementById('dc-foot').textContent);

  await click('[data-clear]');
  ok('清空后回到空状态', d.querySelector('#dc-view .diff-hint') !== null && badge() === '—');

  /* ---------- 10. 复制 ---------- */
  section('10. 复制 unified diff');
  await setText('a\nhello world\nc', 'a\nhello there\nc');
  copied = null;
  await click('#dc-copy');
  const out = (copied || '').split('\n');
  ok('写入了剪贴板', copied !== null);
  ok('带 --- / +++ 头部', out[0] === '--- 原文' && out[1] === '+++ 修改后',
     JSON.stringify(out.slice(0, 2)));
  ok('上下文行以空格开头', out[2] === ' a', JSON.stringify(out[2]));
  ok('含 - / + 行', out[3] === '-hello world' && out[4] === '+hello there',
     JSON.stringify(out.slice(3, 5)));

  /* ---------- 11. 中文与 emoji ---------- */
  section('11. 中文与 emoji');
  await setText('你好世界 🎉', '你好，世界 🎉');
  ok('识别为 1 处修改', stats()['修改'] === '1', JSON.stringify(stats()));
  ok('行内高亮命中中文标点',
     [...d.querySelectorAll('#dc-view mark')].some((m) => m.textContent.includes('，')));
  ok('emoji 未被拆坏', d.getElementById('dc-view').textContent.includes('🎉'));

  /* ---------- 12. 边界 ---------- */
  section('12. 边界情况');
  await setText('a\nb\n', 'a\nb');
  ok('结尾换行不影响结果', badge() === '完全一致', badge());
  await setText('', '');
  ok('两侧都为空 → 空状态', d.querySelector('#dc-view .diff-hint') !== null);
  await setText('', 'a\nb');
  ok('一侧为空 → 2 行新增', stats()['新增'] === '2', JSON.stringify(stats()));

  /* ---------- 13. 相关工具 ---------- */
  section('13. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为开发者蓝',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#2f6bff',
     d.documentElement.style.getPropertyValue('--hub-accent'));
}
