/* ==========================================================================
   颜色工具函数（js/color-utils.js）
   移植自 Praticulus 的 color-utils.js。这里验证换算正确性，
   以及移植时修掉的两个点：hexToRgb 的静默失败、parseColor 的覆盖面。
   ========================================================================== */

import { ok, section, loadPage, sleep } from './_harness.mjs';

export default async function run() {
  /* color-utils 挂在 TOOLBOX.color 上，借取色器页面把它加载起来 */
  const ctx = await loadPage('tools/color-picker/index.html');
  const w = ctx.w;
  const C = w.TOOLBOX.color;

  ok('颜色工具已挂载到 TOOLBOX.color', !!C);
  if (!C) return;

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const H = (hex) => C.hexToRgb(hex);
  const X = (rgb) => C.rgbToHex(rgb.r, rgb.g, rgb.b);

  /* ---------- 1. hexToRgb ---------- */
  section('1. hexToRgb');
  ok('#rrggbb 解析正确', eq(C.hexToRgb('#6c5ce7'), { r: 108, g: 92, b: 231 }),
     JSON.stringify(C.hexToRgb('#6c5ce7')));
  ok('#rgb 三位简写', eq(C.hexToRgb('#abc'), { r: 170, g: 187, b: 204 }),
     JSON.stringify(C.hexToRgb('#abc')));
  ok('不带 # 也接受', eq(C.hexToRgb('6c5ce7'), { r: 108, g: 92, b: 231 }));
  ok('大小写不敏感', eq(C.hexToRgb('#6C5CE7'), { r: 108, g: 92, b: 231 }));

  /* 回归：上游对非法输入静默返回黑色，这里必须返回 null */
  section('2. 回归：非法输入不再静默变黑');
  ok('含非法字符返回 null', C.hexToRgb('#gggggg') === null, JSON.stringify(C.hexToRgb('#gggggg')));
  ok('长度不对返回 null', C.hexToRgb('#12345') === null, JSON.stringify(C.hexToRgb('#12345')));
  ok('空字符串返回 null', C.hexToRgb('') === null);
  ok('null 返回 null', C.hexToRgb(null) === null);
  ok('undefined 返回 null', C.hexToRgb(undefined) === null);
  ok('中文返回 null', C.hexToRgb('红色') === null);
  ok('上游行为对照：parseInt 会把非法值变成 0',
     Number.isNaN(parseInt('gggggg', 16)) && ((parseInt('gggggg', 16) >> 16) & 255) === 0);

  /* ---------- 3. rgbToHex ---------- */
  section('3. rgbToHex');
  ok('常规换算', C.rgbToHex(108, 92, 231) === '#6c5ce7', C.rgbToHex(108, 92, 231));
  ok('个位数补零', C.rgbToHex(1, 2, 3) === '#010203', C.rgbToHex(1, 2, 3));
  ok('超出范围会裁剪', C.rgbToHex(300, -20, 128) === '#ff0080', C.rgbToHex(300, -20, 128));
  ok('小数会四舍五入', C.rgbToHex(107.6, 92.4, 231.5) === '#6c5ce8',
     C.rgbToHex(107.6, 92.4, 231.5));

  /* ---------- 4. HSL ---------- */
  section('4. HSL 换算');
  ok('rgbToHsl 正确', eq(C.rgbToHsl(108, 92, 231), { h: 247, s: 74, l: 63 }),
     JSON.stringify(C.rgbToHsl(108, 92, 231)));
  ok('白色', eq(C.rgbToHsl(255, 255, 255), { h: 0, s: 0, l: 100 }));
  ok('黑色', eq(C.rgbToHsl(0, 0, 0), { h: 0, s: 0, l: 0 }));
  ok('纯红 h=0', eq(C.rgbToHsl(255, 0, 0), { h: 0, s: 100, l: 50 }));
  ok('纯绿 h=120', eq(C.rgbToHsl(0, 255, 0), { h: 120, s: 100, l: 50 }));
  ok('纯蓝 h=240', eq(C.rgbToHsl(0, 0, 255), { h: 240, s: 100, l: 50 }));

  /* 回归：h 必须落在 [0, 360) */
  const nearRed = C.rgbToHsl(255, 0, 1);
  ok('接近正红时 h 归一为 0 而不是 360', nearRed.h === 0, String(nearRed.h));

  /* 注意：HSL 按整数显示，往返换算会有 ±1 的取整误差，属正常 */
  ok('hslToRgb 正确（整数 HSL 有 ±1 取整误差）', eq(C.hslToRgb(247, 74, 63), { r: 107, g: 91, b: 230 }),
     JSON.stringify(C.hslToRgb(247, 74, 63)));
  ok('hsl 超过 360 会绕回', eq(C.hslToRgb(367, 74, 63), C.hslToRgb(7, 74, 63)));
  ok('hsl 负数角度会绕回', eq(C.hslToRgb(-113, 74, 63), C.hslToRgb(247, 74, 63)),
     JSON.stringify(C.hslToRgb(-113, 74, 63)));

  const roundTrip = C.hslToRgb.apply(null, Object.values(C.rgbToHsl(108, 92, 231)));
  ok('HSL 往返误差在 1 以内',
     Math.abs(roundTrip.r - 108) <= 1 && Math.abs(roundTrip.g - 92) <= 1 && Math.abs(roundTrip.b - 231) <= 1,
     JSON.stringify(roundTrip));

  /* ---------- 5. CMYK ---------- */
  section('5. CMYK 换算');
  ok('rgbToCmyk 正确', eq(C.rgbToCmyk(108, 92, 231), { c: 53, m: 60, y: 0, k: 9 }),
     JSON.stringify(C.rgbToCmyk(108, 92, 231)));
  ok('黑色 k=100', eq(C.rgbToCmyk(0, 0, 0), { c: 0, m: 0, y: 0, k: 100 }));
  ok('白色全 0', eq(C.rgbToCmyk(255, 255, 255), { c: 0, m: 0, y: 0, k: 0 }));
  ok('cmykToRgb 往返一致',
     eq(C.cmykToRgb(53, 60, 0, 9), C.hexToRgb('#6c5ce7')) ||
     Math.abs(C.cmykToRgb(53, 60, 0, 9).r - 108) <= 1,
     JSON.stringify(C.cmykToRgb(53, 60, 0, 9)));

  /* ---------- 6. 对比度 ---------- */
  section('6. 对比度');
  ok('白色亮度为 1', Math.abs(C.luminance(255, 255, 255) - 1) < 1e-9, String(C.luminance(255, 255, 255)));
  ok('黑色亮度为 0', C.luminance(0, 0, 0) === 0);
  ok('黑白对比度为 21', Math.abs(C.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 1e-9,
     String(C.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })));
  ok('同色对比度为 1',
     Math.abs(C.contrastRatio({ r: 108, g: 92, b: 231 }, { r: 108, g: 92, b: 231 }) - 1) < 1e-9);
  ok('对比度与顺序无关',
     Math.abs(C.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) -
              C.contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })) < 1e-9);

  const lv = C.wcagLevels(4.5);
  ok('wcagLevels 返回 4 档', lv.length === 4, String(lv.length));
  ok('4.5 刚好过 AA 正文', lv[0].pass === true && lv[1].pass === true);
  ok('4.5 不过 AAA 正文', lv[2].pass === false);
  ok('4.5 刚好过 AAA 大字', lv[3].pass === true);
  ok('7:1 过全部四档', C.wcagLevels(7).every((x) => x.pass));
  ok('2:1 一档都不过', C.wcagLevels(2).every((x) => !x.pass));

  /* ---------- 6b. 对比度上限与达标修复（新增） ---------- */

  /* maxContrast：给定背景，任何颜色对它的对比度上限 */
  ok('maxContrast 白底为 21', Math.abs(C.maxContrast(H('#ffffff')) - 21) < 1e-9,
     String(C.maxContrast(H('#ffffff'))));
  ok('maxContrast 黑底为 21', Math.abs(C.maxContrast(H('#000000')) - 21) < 1e-9);
  ok('maxContrast 中灰约 5.32',
     Math.abs(C.maxContrast(H('#808080')) - 5.32) < 0.01,
     C.maxContrast(H('#808080')).toFixed(3));
  ok('maxContrast 就是黑底与白底之中较大的那个',
     [0, 40, 90, 128, 180, 220, 255].every((v) => {
       const bg = { r: v, g: v, b: v };
       const byBlack = C.contrastRatio({ r: 0, g: 0, b: 0 }, bg);
       const byWhite = C.contrastRatio({ r: 255, g: 255, b: 255 }, bg);
       return Math.abs(C.maxContrast(bg) - Math.max(byBlack, byWhite)) < 1e-9;
     }));

  /* fixContrast：两个参数都可以是 hex 或 {r,g,b} */
  const toRgb = (c) => (c && typeof c === 'object') ? c : H(c);
  const F = (a, b, t) => C.fixContrast(toRgb(a), toRgb(b), t);

  ok('已达标时返回 already', (() => {
    const r = F('#ffffff', '#000000', 4.5);
    return r.ok === false && r.reason === 'already';
  })(), JSON.stringify(F('#ffffff', '#000000', 4.5)));

  /* 回归：上游只朝一个方向调明度（背景亮度 ≤ 0.5 就提亮），
     中灰背景提亮到白也只有 3.95:1，会漏掉往暗调的解。 */
  ok('中灰底 + 黄字能修出解（上游会报无法修复）', (() => {
    const r = F('#ffff00', '#808080', 4.5);
    return r.ok === true && C.contrastRatio(r.rgb, H('#808080')) >= 4.5;
  })(), JSON.stringify(F('#ffff00', '#808080', 4.5)));

  ok('这条修复是往暗调走的', (() => {
    const r = F('#ffff00', '#808080', 4.5);
    return r.ok && C.luminance(r.rgb.r, r.rgb.g, r.rgb.b) < C.luminance(255, 255, 0);
  })());

  /* 凡是理论上可达成的背景，都应该能修出解 —— 这是方向缺陷的直接反例集。
     前景用中灰：它对下面每一个背景都不到 4.5:1，必须真的去调。 */
  const unreachable = ['#707070', '#808080', '#999999', '#b0b0b0', '#bcbcbc', '#333333', '#eeeeee']
    .filter((bgHex) => {
      const bg = H(bgHex);
      if (C.maxContrast(bg) < 4.5) return false;      /* 理论就不可达，跳过 */
      const r = F('#808080', bg, 4.5);
      return !(r.ok && C.contrastRatio(r.rgb, bg) >= 4.5);
    });
  ok('理论上可达 4.5 的背景都能修出解', unreachable.length === 0, unreachable.join(', '));

  /* #707070 尤其关键：往暗调到黑只有 4.24，必须往亮调才有解 */
  ok('#707070 背景要往亮调才有解', (() => {
    const bg = H('#707070');
    const r = F('#808080', bg, 4.5);
    return r.ok && C.luminance(r.rgb.r, r.rgb.g, r.rgb.b) > C.luminance(128, 128, 128);
  })(), JSON.stringify(F('#808080', H('#707070'), 4.5)));

  ok('确实无解时如实报告 impossible', (() => {
    const r = F('#808080', '#808080', 7);
    return r.ok === false && r.reason === 'impossible';
  })());

  ok('修复后色相与饱和度不变', (() => {
    const r = F('#ff0000', '#b0b0b0', 4.5);
    if (!r.ok) return false;
    const before = C.rgbToHsl(255, 0, 0);
    const after = C.rgbToHsl(r.rgb.r, r.rgb.g, r.rgb.b);
    return Math.abs(before.h - after.h) <= 2 && Math.abs(before.s - after.s) <= 2;
  })());

  ok('取的是改动最小的解（再少改一点就不达标）', (() => {
    const bg = H('#808080');
    const r = F('#ffff00', bg, 4.5);
    if (!r.ok) return false;
    const hsl = C.rgbToHsl(255, 255, 0);
    return [hsl.l - (r.delta - 1), hsl.l + (r.delta - 1)].every((l) => {
      if (l < 0 || l > 100) return true;
      return C.contrastRatio(C.hslToRgb(hsl.h, hsl.s, l), bg) < 4.5;
    });
  })());

  ok('目标越高，明度改动越大', (() => {
    const a = F('#808080', '#808080', 3);
    const b = F('#808080', '#808080', 4.5);
    return a.ok && b.ok && b.delta > a.delta;
  })(), `${JSON.stringify(F('#808080', '#808080', 3))} vs ${JSON.stringify(F('#808080', '#808080', 4.5))}`);

  /* ---------- 7. blendColors（线性插值） ---------- */
  section('7. 混合');
  ok('ratio 0 得到原色',
     eq(C.blendColors({ r: 100, g: 100, b: 100 }, { r: 255, g: 255, b: 255 }, 0), { r: 100, g: 100, b: 100 }));
  ok('ratio 1 得到目标色',
     eq(C.blendColors({ r: 100, g: 100, b: 100 }, { r: 255, g: 255, b: 255 }, 1), { r: 255, g: 255, b: 255 }));
  ok('ratio 0.5 取中间',
     eq(C.blendColors({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5), { r: 128, g: 128, b: 128 }));

  /* ---------- 8. 混合模式（新增） ---------- */
  section('8. 混合模式（W3C Compositing and Blending Level 1）');

  const B = (a, b, m) => C.blendMode(H(a), H(b), m);

  ok('模式表 16 项', C.blendModes.length === 16, String(C.blendModes.length));
  ok('模式 id 与 CSS 的 mix-blend-mode 完全一致',
     C.blendModes.map((m) => m.id).join(',') ===
     'normal,multiply,screen,overlay,darken,lighten,color-dodge,color-burn,' +
     'hard-light,soft-light,difference,exclusion,hue,saturation,color,luminosity',
     C.blendModes.map((m) => m.id).join(','));
  ok('每个模式都有中文名与说明', C.blendModes.every((m) => m.name && m.note));

  /* 与规范逐条对照。白与黑是最容易手算的两个端点。 */
  ok('正片叠底 × 白 = 原色', X(B('#ffffff', '#808080', 'multiply')) === '#808080');
  ok('正片叠底 × 黑 = 黑', X(B('#000000', '#808080', 'multiply')) === '#000000');
  ok('正片叠底 红×蓝 = 黑', X(B('#ff0000', '#0000ff', 'multiply')) === '#000000');
  ok('滤色 + 黑 = 原色', X(B('#000000', '#808080', 'screen')) === '#808080');
  ok('滤色 + 白 = 白', X(B('#ffffff', '#123456', 'screen')) === '#ffffff');
  ok('滤色 红+蓝 = 品红', X(B('#ff0000', '#0000ff', 'screen')) === '#ff00ff');
  ok('叠加 中灰+中灰 = 中灰', X(B('#808080', '#808080', 'overlay')) === '#808080');
  ok('变暗取较暗值', X(B('#ff0000', '#0000ff', 'darken')) === '#000000');
  ok('变亮取较亮值', X(B('#ff0000', '#0000ff', 'lighten')) === '#ff00ff');
  ok('差值 同色 = 黑', X(B('#6c5ce7', '#6c5ce7', 'difference')) === '#000000');
  ok('差值 红/蓝 = 品红', X(B('#ff0000', '#0000ff', 'difference')) === '#ff00ff');
  ok('排除 同色 = 中灰（比差值弱）', X(B('#808080', '#808080', 'exclusion')) === '#7f7f7f',
     X(B('#808080', '#808080', 'exclusion')));
  ok('正常 = 叠色', X(B('#ff0000', '#00cec9', 'normal')) === '#00cec9');
  ok('颜色减淡 黑底不变', X(B('#000000', '#ffffff', 'color-dodge')) === '#000000');
  ok('颜色加深 白底不变', X(B('#ffffff', '#000000', 'color-burn')) === '#ffffff');
  ok('强光 白叠色 = 白', X(B('#808080', '#ffffff', 'hard-light')) === '#ffffff');
  ok('色相：灰底 + 红叠 = 灰（饱和度取自底色，为 0）',
     X(B('#808080', '#ff0000', 'hue')) === '#808080', X(B('#808080', '#ff0000', 'hue')));
  ok('色相：手算对照 #336699 + #ff0000 = #a43e3e',
     X(B('#336699', '#ff0000', 'hue')) === '#a43e3e', X(B('#336699', '#ff0000', 'hue')));
  ok('明度：取叠色明度', X(B('#336699', '#ffffff', 'luminosity')) === '#ffffff');

  /* 规范里的结构性关系 —— 比硬编码期望值更能兜住回归 */
  const inv = (h) => { const c = H(h); return C.rgbToHex(255 - c.r, 255 - c.g, 255 - c.b); };
  ok('overlay(a,b) = hard-light(b,a)',
     [['#336699', '#ff0000'], ['#ffffff', '#123456'], ['#0a0b0c', '#f1e2d3']]
       .every(([a, b]) => X(B(a, b, 'overlay')) === X(B(b, a, 'hard-light'))));
  ok('滤色与正片叠底对偶',
     X(B('#336699', '#ff0000', 'screen')) === inv(X(B(inv('#336699'), inv('#ff0000'), 'multiply'))));
  ok('可交换的模式满足交换律',
     ['multiply', 'screen', 'darken', 'lighten', 'difference', 'exclusion']
       .every((m) => X(B('#336699', '#ff0000', m)) === X(B('#ff0000', '#336699', m))));
  ok('叠加不满足交换律（分方向）',
     X(B('#336699', '#ff0000', 'overlay')) !== X(B('#ff0000', '#336699', 'overlay')));
  ok('变暗 ≤ 两者 ≤ 变亮', (() => {
    const a = H('#336699'), b = H('#ff0000');
    const d = B('#336699', '#ff0000', 'darken');
    const l = B('#336699', '#ff0000', 'lighten');
    return d.r <= Math.min(a.r, b.r) && d.g <= Math.min(a.g, b.g) && d.b <= Math.min(a.b, b.b) &&
           l.r >= Math.max(a.r, b.r) && l.g >= Math.max(a.g, b.g) && l.b >= Math.max(a.b, b.b);
  })());
  ok('所有模式的输出都是 0–255 的整数',
     C.blendModes.every((m) => {
       const o = B('#123456', '#abcdef', m.id);
       return [o.r, o.g, o.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
     }));
  ok('未知模式回落到 normal', X(B('#ff0000', '#00cec9', 'zzz')) === '#00cec9');

  /* ---------- 9. parseColor ---------- */
  section('8. parseColor');
  const p = (s) => C.parseColor(s);

  ok('hex', eq(p('#6c5ce7'), { r: 108, g: 92, b: 231 }));
  ok('hex 简写', eq(p('#abc'), { r: 170, g: 187, b: 204 }));
  ok('rgb 逗号', eq(p('rgb(108,92,231)'), { r: 108, g: 92, b: 231 }));
  ok('rgb 带空格', eq(p('rgb(108, 92, 231)'), { r: 108, g: 92, b: 231 }));
  ok('rgb 空格分隔（CSS Color 4）', eq(p('rgb(108 92 231)'), { r: 108, g: 92, b: 231 }),
     JSON.stringify(p('rgb(108 92 231)')));
  ok('rgb 百分比', eq(p('rgb(100%,0%,0%)'), { r: 255, g: 0, b: 0 }), JSON.stringify(p('rgb(100%,0%,0%)')));
  ok('rgba 忽略透明度', eq(p('rgba(108,92,231,0.5)'), { r: 108, g: 92, b: 231 }));
  ok('hsl', eq(p('hsl(247,74%,63%)'), { r: 107, g: 91, b: 230 }), JSON.stringify(p('hsl(247,74%,63%)')));
  ok('hsl 空格分隔', eq(p('hsl(247 74% 63%)'), { r: 107, g: 91, b: 230 }),
     JSON.stringify(p('hsl(247 74% 63%)')));
  ok('hsla 忽略透明度', eq(p('hsla(247,74%,63%,0.5)'), { r: 107, g: 91, b: 230 }));

  /* 这几条是新增能力：交给浏览器解析 */
  ok('颜色名 tomato', eq(p('tomato'), { r: 255, g: 99, b: 71 }), JSON.stringify(p('tomato')));
  ok('颜色名 rebeccapurple', eq(p('rebeccapurple'), { r: 102, g: 51, b: 153 }),
     JSON.stringify(p('rebeccapurple')));
  ok('#rrggbbaa 忽略透明度', eq(p('#6c5ce780'), { r: 108, g: 92, b: 231 }),
     JSON.stringify(p('#6c5ce780')));

  ok('无法解析返回 null', p('不是颜色') === null, JSON.stringify(p('不是颜色')));
  ok('空串返回 null', p('') === null);
  ok('null 返回 null', p(null) === null);
  ok('前后空白会被去掉', eq(p('  #6c5ce7  '), { r: 108, g: 92, b: 231 }));

  /* ---------- 10. HWB ---------- */
  section('10. HWB 换算');
  ok('rgbToHwb 正确', eq(C.rgbToHwb(108, 92, 231), { h: 247, w: 36, b: 9 }),
     JSON.stringify(C.rgbToHwb(108, 92, 231)));
  ok('纯白 w=100', eq(C.rgbToHwb(255, 255, 255), { h: 0, w: 100, b: 0 }),
     JSON.stringify(C.rgbToHwb(255, 255, 255)));
  ok('纯黑 b=100', eq(C.rgbToHwb(0, 0, 0), { h: 0, w: 0, b: 100 }),
     JSON.stringify(C.rgbToHwb(0, 0, 0)));
  ok('纯红 w=b=0', eq(C.rgbToHwb(255, 0, 0), { h: 0, w: 0, b: 0 }),
     JSON.stringify(C.rgbToHwb(255, 0, 0)));

  ok('hwbToRgb 纯色', eq(C.hwbToRgb(0, 0, 0), { r: 255, g: 0, b: 0 }),
     JSON.stringify(C.hwbToRgb(0, 0, 0)));
  ok('hwbToRgb 白黑相加超 100% 时按灰度',
     eq(C.hwbToRgb(0, 60, 60), { r: 128, g: 128, b: 128 }),
     JSON.stringify(C.hwbToRgb(0, 60, 60)));
  const hwbRound = C.hwbToRgb.apply(null, Object.values(C.rgbToHwb(108, 92, 231)));
  ok('HWB 往返误差在 2 以内',
     Math.abs(hwbRound.r - 108) <= 2 && Math.abs(hwbRound.g - 92) <= 2 && Math.abs(hwbRound.b - 231) <= 2,
     JSON.stringify(hwbRound));

  /* ---------- 11. 命名颜色 ---------- */
  section('11. CSS 命名颜色');
  const names = Object.keys(C.namedColors);
  ok('命名颜色表 148 项', names.length === 148, String(names.length));

  /* 关键：把表里每个颜色名都交给浏览器解析一遍，逐个交叉验证 */
  const mismatched = [];
  for (const name of names) {
    const parsed = C.parseColor(name);
    const table = C.namedColors[name];
    if (!parsed || parsed.r !== table[0] || parsed.g !== table[1] || parsed.b !== table[2]) {
      mismatched.push(name + ' 表=' + table.join(',') + ' 浏览器=' + (parsed ? [parsed.r, parsed.g, parsed.b].join(',') : 'null'));
    }
  }
  ok('表里的每个颜色名都与浏览器一致', mismatched.length === 0, mismatched.slice(0, 4).join(' | '));

  ok('namedToRgb 按名字查表', eq(C.namedToRgb('tomato'), { r: 255, g: 99, b: 71 }),
     JSON.stringify(C.namedToRgb('tomato')));
  ok('namedToRgb 大小写不敏感', eq(C.namedToRgb('TOMATO'), { r: 255, g: 99, b: 71 }));
  ok('namedToRgb 未知名字返回 null', C.namedToRgb('notacolor') === null);

  const exact = C.closestName({ r: 255, g: 99, b: 71 });
  ok('closestName 精确匹配', exact.name === 'tomato' && exact.exact === true && exact.distance === 0,
     JSON.stringify({ name: exact.name, exact: exact.exact, distance: exact.distance }));

  const near = C.closestName({ r: 108, g: 92, b: 231 });
  ok('closestName 返回最近的色名', typeof near.name === 'string' && near.distance > 0,
     JSON.stringify({ name: near.name, distance: near.distance }));
  ok('closestName 距离非负', near.distance >= 0, String(near.distance));

  /* 表里每个颜色名找自己都应该距离为 0 */
  const selfMismatch = names.filter((n) => {
    const c = C.namedColors[n];
    return C.closestName({ r: c[0], g: c[1], b: c[2] }).distance !== 0;
  });
  ok('每个颜色名都能找到距离为 0 的自己', selfMismatch.length === 0,
     selfMismatch.slice(0, 4).join(', '));

  /* ---------- 12. 与页面渲染一致 ---------- */
  section('12. 页面里的色值');
  await sleep(30);
  const valueRows = [...ctx.d.querySelectorAll('#cp-values .value-row')].map((r) => r.textContent);
  ok('页面渲染出 4 行色值', valueRows.length === 4, String(valueRows.length));
  ok('HEX 行正确', valueRows[0].includes('#6c5ce7'), valueRows[0]);
  ok('RGB 行正确', valueRows[1].includes('rgb(108, 92, 231)'), valueRows[1]);
  ok('HSL 行正确', valueRows[2].includes('hsl(247, 74%, 63%)'), valueRows[2]);
  ok('CMYK 行正确', valueRows[3].includes('cmyk(53%, 60%, 0%, 9%)'), valueRows[3]);
}
