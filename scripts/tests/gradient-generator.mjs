/* ==========================================================================
   渐变生成器
   移植自 Praticulus 的 gradient-generator。重点验证移植时修掉的
   「添加色标落在 100% 与末尾重合」这个让按钮看起来失效的缺陷，
   以及新增的位置轴、重复渐变与非法输入反馈。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/gradient-generator/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const C = w.TOOLBOX.color;

  const positions = () => [...d.querySelectorAll('#gg-stops .grad-stop-pos')].map((r) => Number(r.value));
  const colors = () => [...d.querySelectorAll('#gg-stops .color-input')].map((c) => c.value);
  const hexInputs = () => [...d.querySelectorAll('#gg-stops .grad-stop-hex')];
  const delBtns = () => [...d.querySelectorAll('#gg-stops [data-del]')];
  const marks = () => [...d.querySelectorAll('#gg-axis .grad-axis-mark')];
  const cssText = () => d.getElementById('gg-css-text').textContent;
  const previewBg = () => d.getElementById('gg-preview').style.background.replace(/\s+/g, ' ');
  const presets = () => [...d.querySelectorAll('.grad-preset')];

  const click = async (sel, wait = 40) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setType = async (v) => {
    const el = d.getElementById('gg-type');
    el.value = v;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(40);
  };
  const setAngle = async (v) => {
    const el = d.getElementById('gg-angle');
    el.value = String(v);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(40);
  };
  const setRepeat = async (on) => {
    const el = d.getElementById('gg-repeat');
    el.checked = on;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(40);
  };
  const setStopHex = async (i, v) => {
    const el = hexInputs()[i];
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(40);
  };
  const setStopPos = async (i, v) => {
    const el = [...d.querySelectorAll('#gg-stops .grad-stop-pos')][i];
    el.value = String(v);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(40);
  };
  const reset = () => click('.grad-preset[data-preset="0"]');

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('颜色引擎可用', !!C);
  ok('默认 2 个色标', positions().length === 2, JSON.stringify(positions()));
  ok('默认位置是 0 / 100', positions()[0] === 0 && positions()[1] === 100, JSON.stringify(positions()));
  ok('默认 CSS 正确',
     cssText() === 'background: linear-gradient(135deg, #6c5ce7 0%, #00cec9 100%);',
     cssText());
  ok('预览区已应用渐变',
     previewBg().startsWith('linear-gradient(135deg') &&
     previewBg().includes('rgb(108, 92, 231) 0%'), previewBg());
  ok('位置轴 2 个标记', marks().length === 2, String(marks().length));
  ok('轴标记落在 0% 与 100%',
     marks()[0].style.left === '0%' && marks()[1].style.left === '100%',
     `${marks()[0].style.left} / ${marks()[1].style.left}`);
  ok('预设 10 套', presets().length === 10, String(presets().length));
  ok('默认有删除按钮（色标多于 2 个时才显示，此时恰好 2 个所以没有）',
     delBtns().length === 0, String(delBtns().length));

  /* ---------- 2. 渐变类型与角度 ---------- */
  section('2. 渐变类型与角度');
  await setType('radial');
  ok('径向渐变 CSS 正确',
     cssText().includes('radial-gradient(circle, '), cssText());
  ok('径向时不显示角度输入',
     d.getElementById('gg-angle-group').style.display === 'none',
     d.getElementById('gg-angle-group').style.display);

  await setType('conic');
  ok('圆锥渐变带 from ... deg',
     cssText().includes('conic-gradient(from 135deg, '), cssText());
  ok('圆锥时显示角度输入',
     d.getElementById('gg-angle-group').style.display !== 'none');

  await setType('linear');
  ok('切回线性', cssText().includes('linear-gradient(135deg, '), cssText());

  await setAngle(90);
  ok('角度生效', cssText().includes('linear-gradient(90deg, '), cssText());

  await setAngle(500);
  ok('角度超过 360 会被夹到 360',
     cssText().includes('linear-gradient(360deg, '), cssText());

  await setAngle(135);

  /* ---------- 3. 重复渐变 ---------- */
  section('3. 重复渐变');
  await setRepeat(true);
  ok('开启重复后生成 repeating-linear-gradient',
     cssText().includes('repeating-linear-gradient('), cssText());

  await setType('radial');
  ok('径向也支持重复',
     cssText().includes('repeating-radial-gradient('), cssText());
  await setType('linear');

  await setRepeat(false);
  ok('关掉重复恢复普通渐变',
     cssText().includes('linear-gradient(') && !cssText().includes('repeating-'), cssText());

  /* ---------- 4. 编辑色标 ---------- */
  section('4. 编辑色标');
  await setStopHex(0, '#ff0000');
  ok('改色值后 CSS 跟着变', cssText().includes('#ff0000 0%'), cssText());
  ok('取色盘与文本框同步', colors()[0] === '#ff0000', colors()[0]);

  await setStopHex(0, 'tomato');
  ok('色标支持颜色名', cssText().includes('#ff6347 0%'), cssText());
  ok('输入过程中文本框保留原文', hexInputs()[0].value === 'tomato', hexInputs()[0].value);

  await setStopPos(0, 25);
  ok('位置生效', cssText().includes('#ff6347 25%'), cssText());
  ok('位置读数同步',
     d.querySelectorAll('.grad-stop-posval')[0].textContent === '25%',
     d.querySelectorAll('.grad-stop-posval')[0].textContent);
  ok('轴标记跟着移动', marks()[0].style.left === '25%', marks()[0].style.left);

  /* 回归：上游文本框输入非法色值时没有任何反馈 */
  await setStopHex(0, '#gggggg');
  ok('非法色值标红', hexInputs()[0].classList.contains('input--invalid'),
     hexInputs()[0].className);
  ok('非法色值不改变 CSS', cssText().includes('#ff6347 25%'), cssText());

  hexInputs()[0].dispatchEvent(new w.Event('focusout', { bubbles: true }));
  await sleep(30);
  ok('失焦后回退为当前色值', hexInputs()[0].value === '#ff6347', hexInputs()[0].value);
  ok('失焦后清除标红', !hexInputs()[0].classList.contains('input--invalid'));

  /* ---------- 5. 增删色标（核心回归） ---------- */
  section('5. 增删色标');
  await reset();
  ok('预设把色标重置为 2 个', positions().length === 2, JSON.stringify(positions()));

  /* 回归：上游算的是「最后一个位置 + 到 100 的一半」，
     默认 0% / 100% 算出来还是 100%，新色标和末尾完全重合，点了看不出变化。 */
  await click('#gg-add-stop');
  ok('添加后 3 个色标', positions().length === 3, JSON.stringify(positions()));
  ok('新色标插在 0 与 100 的中点 50%（上游会放到 100%）',
     positions()[2] === 50, JSON.stringify(positions()));
  ok('位置轴跟着多一个标记', marks().length === 3, String(marks().length));

  await click('#gg-add-stop');
  ok('再添加一个，并列空隙时取靠后的那个（50–100 的中点 75%）',
     positions()[3] === 75, JSON.stringify(positions()));

  ok('色标多于 2 个时有删除按钮', delBtns().length === 4, String(delBtns().length));

  await click('#gg-stops [data-del]');
  await click('#gg-stops [data-del]');
  ok('删除后剩 2 个色标', positions().length === 2, JSON.stringify(positions()));
  ok('只剩 2 个时不再显示删除按钮', delBtns().length === 0, String(delBtns().length));

  /* 上限 10 个 */
  for (let i = 0; i < 8; i++) await click('#gg-add-stop', 0);
  ok('最多 10 个色标', positions().length === 10, String(positions().length));
  ok('达到上限后添加按钮禁用', d.getElementById('gg-add-stop').disabled === true);
  ok('位置轴也是 10 个标记', marks().length === 10, String(marks().length));

  /* ---------- 6. 预设 ---------- */
  section('6. 预设');
  await click('.grad-preset[data-preset="0"]');
  ok('套用预设后剩 2 个色标', positions().length === 2, JSON.stringify(positions()));
  ok('预设色值正确',
     colors()[0] === '#ee9ca7' && colors()[1] === '#ffdde1', JSON.stringify(colors()));
  ok('预设色块已着色',
     presets()[0].querySelector('.grad-preset-swatch').style.background.includes('linear-gradient'));

  await click('.grad-preset[data-preset="5"]');
  ok('三色预设「霓虹」有 3 个色标', positions().length === 3, JSON.stringify(positions()));
  ok('中间色标在 50%', positions()[1] === 50, JSON.stringify(positions()));

  await click('.grad-preset[data-preset="9"]');
  ok('预设切换后色值整体替换',
     colors()[0] === '#000428' && colors()[1] === '#004e92', JSON.stringify(colors()));

  /* 预设不动角度与类型 */
  await setAngle(45);
  await click('.grad-preset[data-preset="1"]');
  ok('套用预设不影响角度', cssText().includes('linear-gradient(45deg, '), cssText());

  /* ---------- 7. 复制 ---------- */
  section('7. 复制');
  copied = null;
  await click('#gg-css');
  ok('点代码框复制 CSS', copied === cssText(), JSON.stringify(copied));
  ok('复制后代码框有状态标记',
     d.getElementById('gg-css').getAttribute('data-copied') === 'true');
  ok('复制不会把代码框内容换成提示文字',
     cssText().startsWith('background: '), cssText());

  copied = null;
  await click('#gg-copy');
  ok('点复制按钮复制 CSS', copied === cssText(), JSON.stringify(copied));

  /* ---------- 8. 随机 ---------- */
  section('8. 随机');
  const beforeRandom = colors().join(',');
  await click('#gg-random');
  ok('随机后色标变了', colors().join(',') !== beforeRandom, colors().join(','));
  ok('随机出 2 或 3 个色标',
     [2, 3].includes(positions().length), String(positions().length));
  ok('随机的首尾色标落在 0% 与 100%',
     positions()[0] === 0 && positions()[positions().length - 1] === 100,
     JSON.stringify(positions()));

  /* 随机色应该是有彩色 —— 上游完全随机取 RGB，经常得到两个几乎一样的灰 */
  const satOf = (hex) => C.rgbToHsl(...Object.values(C.hexToRgb(hex))).s;
  ok('随机色都是有彩色的（饱和度 ≥ 43）',
     colors().every((c) => satOf(c) >= 43),
     JSON.stringify(colors().map(satOf)));

  let outOfRange = null;
  for (let i = 0; i < 30; i++) {
    await click('#gg-random', 0);
    const bad = colors().find((c) => {
      const h = C.rgbToHsl(...Object.values(C.hexToRgb(c)));
      return h.s < 43 || h.s > 97 || h.l < 33 || h.l > 72;
    });
    if (bad) { outOfRange = bad + ' ' + JSON.stringify(C.rgbToHsl(...Object.values(C.hexToRgb(bad)))); break; }
  }
  ok('连续 30 次随机都落在设定区间内', outOfRange === null, outOfRange);

  /* ---------- 9. 快捷键 ---------- */
  section('9. 快捷键');
  const beforeR = colors().join(',');
  d.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  await sleep(40);
  ok('按 R 随机', colors().join(',') !== beforeR);

  const beforeTyping = colors().join(',');
  const angleEl = d.getElementById('gg-angle');
  angleEl.focus();
  angleEl.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  await sleep(40);
  ok('焦点在输入框里时 R 不触发', colors().join(',') === beforeTyping);

  /* ---------- 10. 页面结构 ---------- */
  section('10. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为颜色分类的品红',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d6409f',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('页面注明了来源与许可',
     d.querySelector('.tool-notes').textContent.includes('jamalofski/praticulus') &&
     d.querySelector('.tool-notes').textContent.includes('MIT'));
  ok('页面说明了添加色标的上游缺陷',
     d.querySelector('.tool-notes').textContent.includes('空隙最大的区间中点'));
  ok('页面说明了圆锥渐变的兼容性',
     d.querySelector('.tool-notes').textContent.includes('老版本浏览器'));
}
