/* ==========================================================================
   取色器
   移植自 Praticulus 的 color-picker。重点验证移植时修掉的「非法输入静默变黑」，
   以及新增的复制反馈、色阶切换、前后景交换。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/color-picker/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const C = w.TOOLBOX.color;

  const $ = (sel) => d.querySelector(sel);
  const hexEl = () => d.getElementById('cp-hex');
  const swatchBg = () => d.getElementById('cp-swatch').style.background;
  const rows = () => [...d.querySelectorAll('#cp-values .value-row')];
  const shades = () => [...d.querySelectorAll('#cp-shades .shade-swatch')];
  const badges = () => [...d.querySelectorAll('#cp-badges .badge')].map((b) => b.textContent);

  const typeHex = async (v, wait = 40) => {
    const el = hexEl();
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(wait);
  };
  const click = async (sel, wait = 50) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setBgText = async (v) => {
    const el = d.getElementById('cp-bg-text');
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(40);
  };

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('颜色引擎可用', !!C);
  ok('系统取色盘的值是默认色', d.getElementById('cp-picker').value === '#6c5ce7',
     d.getElementById('cp-picker').value);
  ok('色值列表 4 行', rows().length === 4, String(rows().length));
  ok('HEX 行', rows()[0].textContent.includes('#6c5ce7'), rows()[0].textContent);
  ok('RGB 行', rows()[1].textContent.includes('rgb(108, 92, 231)'), rows()[1].textContent);
  ok('HSL 行', rows()[2].textContent.includes('hsl(247, 74%, 63%)'), rows()[2].textContent);
  ok('CMYK 行', rows()[3].textContent.includes('cmyk(53%, 60%, 0%, 9%)'), rows()[3].textContent);
  ok('色块已着色', swatchBg().replace(/\s/g, '') === 'rgb(108,92,231)', swatchBg());
  ok('色阶 11 块', shades().length === 11, String(shades().length));
  ok('对比度徽章有值', /^\d+(\.\d+)?:1$/.test(d.getElementById('cp-ratio').textContent),
     d.getElementById('cp-ratio').textContent);
  ok('WCAG 徽章 4 个', badges().length === 4, String(badges().length));

  /* ---------- 2. 对比度数值 ---------- */
  section('2. 对比度数值');
  const expectedRatio = Math.round(
    C.contrastRatio(C.hexToRgb('#6c5ce7'), { r: 255, g: 255, b: 255 }) * 100
  ) / 100;
  ok('显示值与公式一致',
     d.getElementById('cp-ratio').textContent === expectedRatio + ':1',
     `${d.getElementById('cp-ratio').textContent} vs ${expectedRatio}:1`);
  ok('数值落在合理范围（约 4.86）', expectedRatio > 4.8 && expectedRatio < 4.9,
     String(expectedRatio));
  ok('该配色通过 AA 正文',
     badges().some((b) => b.includes('AA 正文') && b.includes('✓')), JSON.stringify(badges()));
  ok('该配色不通过 AAA 正文',
     badges().some((b) => b.includes('AAA 正文') && b.includes('✗')), JSON.stringify(badges()));

  /* 注意：#6c5ce7 是中调紫，白底(4.86)比黑底(4.32)的对比度更高 */
  await setBgText('#000000');
  const onBlack = Math.round(
    C.contrastRatio(C.hexToRgb('#6c5ce7'), { r: 0, g: 0, b: 0 }) * 100
  ) / 100;
  ok('换成黑底后对比度随之变化（中调紫在白底上对比度更高）',
     d.getElementById('cp-ratio').textContent === onBlack + ':1' && onBlack < expectedRatio,
     `${d.getElementById('cp-ratio').textContent}（黑底）vs ${expectedRatio}:1（白底）`);
  await setBgText('#ffffff');
  ok('换回白底恢复原值',
     d.getElementById('cp-ratio').textContent === expectedRatio + ':1',
     d.getElementById('cp-ratio').textContent);

  /* ---------- 3. 输入各种格式 ---------- */
  section('3. 输入各种颜色格式');
  await typeHex('#ff0000');
  ok('hex 输入生效', hexEl().value === '#ff0000' && d.getElementById('cp-picker').value === '#ff0000',
     hexEl().value);
  ok('RGB 行跟着变', rows()[1].textContent.includes('rgb(255, 0, 0)'), rows()[1].textContent);

  await typeHex('rgb(0,128,255)');
  ok('rgb() 输入生效', rows()[0].textContent.includes('#0080ff'), rows()[0].textContent);

  await typeHex('hsl(120, 100%, 50%)');
  ok('hsl() 输入生效', rows()[0].textContent.includes('#00ff00'), rows()[0].textContent);

  await typeHex('tomato');
  ok('颜色名输入生效', rows()[0].textContent.includes('#ff6347'), rows()[0].textContent);

  await typeHex('#abc');
  ok('三位简写生效', rows()[0].textContent.includes('#aabbcc'), rows()[0].textContent);

  await typeHex('rgb(255 0 0)');
  ok('空格分隔的 rgb 生效', rows()[0].textContent.includes('#ff0000'), rows()[0].textContent);

  /* ---------- 4. 回归：非法输入不静默变黑 ---------- */
  section('4. 回归：非法输入');
  await typeHex('#6c5ce7');
  const beforeBg = swatchBg();

  await typeHex('#gggggg');
  ok('非法输入时输入框标红', hexEl().classList.contains('input--invalid'),
     hexEl().className);
  ok('非法输入不改变当前颜色', swatchBg() === beforeBg, `${swatchBg()} vs ${beforeBg}`);
  ok('非法输入时保留用户输入的内容', hexEl().value === '#gggggg', hexEl().value);

  await typeHex('不是颜色');
  ok('中文非法输入也标红', hexEl().classList.contains('input--invalid'));

  await typeHex('#12345');
  ok('长度不对也标红', hexEl().classList.contains('input--invalid'));

  /* 失焦时回退到当前颜色 */
  hexEl().dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(30);
  ok('失焦后回退为当前颜色', hexEl().value === '#6c5ce7', hexEl().value);
  ok('失焦后清除标红', !hexEl().classList.contains('input--invalid'));

  /* ---------- 5. 复制色值 ---------- */
  section('5. 点击复制');
  copied = null;
  rows()[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('点击 HEX 行复制 HEX', copied === '#6c5ce7', JSON.stringify(copied));
  ok('复制后该行有状态标记', rows()[0].getAttribute('data-copied') === 'true',
     rows()[0].getAttribute('data-copied'));

  copied = null;
  rows()[1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('点击 RGB 行复制 RGB', copied === 'rgb(108, 92, 231)', JSON.stringify(copied));

  copied = null;
  rows()[2].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('点击 HSL 行复制 HSL', copied === 'hsl(247, 74%, 63%)', JSON.stringify(copied));

  copied = null;
  rows()[3].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  ok('点击 CMYK 行复制 CMYK', copied === 'cmyk(53%, 60%, 0%, 9%)', JSON.stringify(copied));

  ok('复制不会破坏行内的结构',
     rows()[0].querySelector('.value-label') !== null &&
     rows()[0].querySelector('.value-text') !== null);

  /* ---------- 6. 明暗色阶 ---------- */
  section('6. 明暗色阶');
  ok('第一块是白色', shades()[0].getAttribute('data-color') === '#ffffff',
     shades()[0].getAttribute('data-color'));
  ok('最后一块是黑色', shades()[10].getAttribute('data-color') === '#000000',
     shades()[10].getAttribute('data-color'));
  ok('中间那块是当前色', shades()[5].getAttribute('data-color') === '#6c5ce7',
     shades()[5].getAttribute('data-color'));
  ok('每块都带背景色样式', shades().every((s) => s.style.background.length > 0));

  /* 先记下目标色再点 —— 点完色阶会以新色为中心重新生成 */
  const target = shades()[8].getAttribute('data-color');
  await click('#cp-shades .shade-swatch:nth-child(9)');
  ok('点击色阶会切换颜色', rows()[0].textContent.includes(target),
     `${rows()[0].textContent} vs ${target}`);
  ok('切换后色阶以新色为中心重新生成',
     shades()[5].getAttribute('data-color') === target,
     `${shades()[5].getAttribute('data-color')} vs ${target}`);

  await typeHex('#6c5ce7');

  /* ---------- 7. 背景色与交换 ---------- */
  section('7. 背景色与前后景交换');
  ok('背景色输入同步到取色盘',
     d.getElementById('cp-bg').value === '#ffffff', d.getElementById('cp-bg').value);

  await setBgText('rgb(0,0,0)');
  ok('背景色支持任意格式输入', d.getElementById('cp-bg').value === '#000000',
     d.getElementById('cp-bg').value);

  await setBgText('乱写');
  ok('背景色非法时标红', d.getElementById('cp-bg-text').classList.contains('input--invalid'));

  const bgTextEl = d.getElementById('cp-bg-text');
  bgTextEl.dispatchEvent(new w.Event('blur', { bubbles: true }));
  await sleep(30);
  ok('背景色失焦后回退', bgTextEl.value === '#000000', bgTextEl.value);
  ok('背景色失焦后清除标红', !bgTextEl.classList.contains('input--invalid'));

  await setBgText('#ffffff');
  await click('#cp-swap');
  ok('交换后前景变成原来的背景',
     d.getElementById('cp-fg').textContent === '#ffffff',
     d.getElementById('cp-fg').textContent);
  ok('交换后背景变成原来的前景',
     d.getElementById('cp-bg').value === '#6c5ce7', d.getElementById('cp-bg').value);
  ok('交换后色块也换色', swatchBg().replace(/\s/g, '') === 'rgb(255,255,255)', swatchBg());

  await click('#cp-swap');
  await typeHex('#6c5ce7');
  ok('可以再换回来', d.getElementById('cp-fg').textContent === '#6c5ce7',
     d.getElementById('cp-fg').textContent);

  /* ---------- 8. 预览区跟随 ---------- */
  section('8. 预览区');
  const preview = d.getElementById('cp-preview');
  ok('预览区前景色跟随', preview.style.color.replace(/\s/g, '') === 'rgb(108,92,231)',
     preview.style.color);
  ok('预览区背景色跟随', preview.style.backgroundColor.replace(/\s/g, '') === 'rgb(255,255,255)',
     preview.style.backgroundColor);

  /* ---------- 9. 屏幕取色按钮 ---------- */
  section('9. 屏幕取色');
  const eyeBtn = d.getElementById('cp-eyedrop');
  ok('jsdom 无 EyeDropper 时按钮保持隐藏', eyeBtn.hidden === true, String(eyeBtn.hidden));

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
  ok('页面说明了 EyeDropper 的浏览器支持',
     d.querySelector('.tool-notes').textContent.includes('EyeDropper'));
}
