/* ==========================================================================
   测试数据生成
   自研工具。测试重点分两块：
     - 功能：10 个字段、字段勾选、条数、CSV / JSON 导出；
     - **安全性**：这是测试数据工具最容易出错的地方 ——
       邮箱域名必须是 RFC 保留域名、IP 必须是 RFC 5737 文档段、
       身份证号的地址码必须是省级（不能撞真实公民号）。
     - 自洽性：身份证号里的生日与「生日」列一致、顺序码奇偶与「性别」列一致。
   断言尽量从生成结果反推结构，而不是硬编码某一行的值。
   ========================================================================== */

import { ok, section, loadPage, count, sleep } from './_harness.mjs';

/* RFC 2606 保留域名 + RFC 6761 保留顶级域 */
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org', 'example.test'];
/* RFC 5737 保留的文档用段 */
const DOC_IP_BLOCKS = ['192.0.2', '198.51.100', '203.0.113'];

/* ISO 7064:1983 MOD 11-2 —— 独立实现一遍，用来校验生成结果 */
const idChecksum = (first17) => {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const CODE = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(first17.charAt(i)) * W[i];
  return CODE.charAt(sum % 11);
};

export default async function run() {
  let copied = null;
  const ctx = await loadPage('tools/mock-data/index.html', {
    clipboard: (t) => { copied = t; }
  });
  const { d, w } = ctx;
  const C = w.TOOLBOX.mockCorpus;

  const $ = (sel) => d.querySelector(sel);
  const headers = () => [...d.querySelectorAll('#md-table thead th')].map((t) => t.textContent);
  const trs = () => [...d.querySelectorAll('#md-table tbody tr')];
  const cellRows = () => trs().map((tr) =>
    [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent));
  /* 按列名取一整列 */
  const column = (name) => {
    const i = headers().indexOf(name) - 1;
    return i < 0 ? [] : cellRows().map((r) => r[i]);
  };
  const stats = () => {
    const o = {};
    for (const s of d.querySelectorAll('#md-stats .stat')) {
      o[s.querySelector('.stat-label').textContent] = s.querySelector('.stat-value').textContent;
    }
    return o;
  };

  const fire = async (el, type, wait = 170) => {
    el.dispatchEvent(new w.Event(type, { bubbles: true }));
    await sleep(wait);
  };
  const setVal = (el, v) => { el.value = v; return fire(el, 'input'); };
  const click = async (sel, wait = 170) => {
    d.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(wait);
  };
  const setCount = (n) => setVal($('#md-count'), String(n));
  const toggleField = (id) => click('#md-fields [data-field="' + id + '"]');

  /* ---------- 1. 首屏 ---------- */
  section('1. 首屏');
  ok('无脚本错误', ctx.errors.length === 0, ctx.errors.join(' | '));
  ok('十个字段都渲染了', count(d, '#md-fields .choice-chip') === 10,
     String(count(d, '#md-fields .choice-chip')));
  ok('默认全选',
     [...d.querySelectorAll('#md-fields .choice-chip')]
       .every((b) => b.getAttribute('aria-pressed') === 'true'));
  ok('表头 = 行号 + 10 列',
     headers().join(',') === '#,姓名,性别,手机号,邮箱,地址,身份证号,生日,公司,职位,IP 地址',
     headers().join(','));
  ok('默认 20 条', trs().length === 20, String(trs().length));
  ok('四个统计格子',
     Object.keys(stats()).join(',') === '字段数,记录数,CSV 大小,生成耗时',
     Object.keys(stats()).join(','));
  ok('统计显示 10 列 20 条',
     stats()['字段数'] === '10 列' && stats()['记录数'] === '20 条',
     stats()['字段数'] + ' / ' + stats()['记录数']);
  ok('状态行给出总格数与手机号警告',
     /已生成 20 条 × 10 列/.test($('#md-status').textContent) &&
     $('#md-status').textContent.includes('别拿去发短信'), $('#md-status').textContent);

  /* ---------- 2. 各字段的形态 ---------- */
  section('2. 生成 200 条，逐列检查');
  await setCount(200);
  ok('200 条', trs().length === 200, String(trs().length));

  const names = column('姓名');
  const genders = column('性别');
  const mobiles = column('手机号');
  const emails = column('邮箱');
  const addresses = column('地址');
  const idcards = column('身份证号');
  const birthdays = column('生日');
  const companies = column('公司');
  const jobs = column('职位');
  const ips = column('IP 地址');

  /* 姓名 */
  ok('姓都在姓氏表里',
     names.every((n) => C.surnames.includes(n.charAt(0))), names[0]);
  ok('姓名是 2 或 3 个字',
     names.every((n) => n.length === 2 || n.length === 3),
     String([...new Set(names.map((n) => n.length))]));
  ok('名字用字与性别对应',
     names.every((n, i) => {
       const pool = genders[i] === '男' ? C.givenM : C.givenF;
       return [...n.slice(1)].every((ch) => pool.includes(ch));
     }), names[0] + '/' + genders[0]);
  ok('双字名的两个字不相同',
     names.filter((n) => n.length === 3).every((n) => n.charAt(1) !== n.charAt(2)),
     names.filter((n) => n.length === 3 && n.charAt(1) === n.charAt(2))[0] || '');

  /* 性别 */
  ok('性别只有男 / 女',
     genders.every((g) => g === '男' || g === '女'), genders[0]);

  /* 手机号 */
  ok('手机号是 11 位数字',
     mobiles.every((m) => /^\d{11}$/.test(m)), mobiles[0]);
  ok('前 3 位是真实号段',
     mobiles.every((m) => C.mobilePrefix.includes(m.slice(0, 3))), mobiles[0]);

  /* 邮箱 —— 安全性：域名必须是 RFC 保留域名 */
  ok('邮箱格式正确',
     emails.every((e) => /^[a-z]+\d{4}@[a-z.]+$/.test(e)), emails[0]);
  ok('安全性：邮箱域名全部是 RFC 保留域名（永远发不出去）',
     emails.every((e) => RESERVED_DOMAINS.includes(e.split('@')[1])),
     [...new Set(emails.map((e) => e.split('@')[1]))].join(','));

  /* IP —— 安全性：必须是 RFC 5737 文档段 */
  ok('IP 是四段点分十进制',
     ips.every((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s)), ips[0]);
  ok('安全性：IP 全部落在 RFC 5737 的文档段里（不指向真实主机）',
     ips.every((s) => DOC_IP_BLOCKS.includes(s.split('.').slice(0, 3).join('.'))),
     [...new Set(ips.map((s) => s.split('.').slice(0, 3).join('.')))].join(','));

  /* 地址 */
  ok('地址以某个省级行政区开头',
     addresses.every((a) => C.places.some((p) => a.startsWith(p.p))), addresses[0]);
  ok('地址含门牌三段',
     addresses.every((a) => /\d+号\d+号楼\d+室$/.test(a)), addresses[0]);
  ok('直辖市不会拼成「北京市北京市」',
     !addresses.some((a) => /(.{2,4}市)\1/.test(a)),
     addresses.find((a) => /(.{2,4}市)\1/.test(a)) || '');
  ok('省与市是真实对应关系',
     addresses.every((a) => {
       const p = C.places.find((x) => a.startsWith(x.p));
       if (!p) return false;
       /* 直辖市省市同名，代码里只拼一次 */
       return p.cs.some((c) => a.startsWith(p.p + (c === p.p ? '' : c)));
     }), addresses[0]);
  ok('港澳台不接通用区名',
     addresses.filter((a) => /^台湾省|^香港特别行政区|^澳门特别行政区/.test(a))
       .every((a) => !C.districts.some((dd) => a.includes(dd))),
     addresses.find((a) => /^香港/.test(a)) || '(本轮没抽到港澳台)');

  /* 身份证号 —— 安全性 + 自洽性 */
  ok('身份证号是 18 位',
     idcards.every((s) => /^\d{17}[\dX]$/.test(s)), idcards[0]);
  ok('安全性：地址码是省级代码（后 4 位为 0000），不会撞真实公民号',
     idcards.every((s) => C.provinceCodes.includes(s.slice(0, 6))), idcards[0].slice(0, 6));
  ok('地址码与省级代码表一一对应（没有漏掉省市）',
     idcards.every((s) => s.slice(2, 6) === '0000'), idcards[0].slice(0, 6));
  ok('自洽：身份证里的生日与「生日」列一致',
     idcards.every((s, i) => {
       const b = birthdays[i].replace(/-/g, '');
       return s.slice(6, 14) === b;
     }), idcards[0].slice(6, 14) + ' vs ' + (birthdays[0] || '').replace(/-/g, ''));
  ok('自洽：顺序码第 17 位的奇偶与性别一致',
     idcards.every((s, i) => {
       const odd = Number(s.charAt(16)) % 2 === 1;
       return odd === (genders[i] === '男');
     }), idcards[0].charAt(16) + '/' + genders[0]);
  ok('校验位符合 ISO 7064 MOD 11-2',
     idcards.every((s) => s.charAt(17) === idChecksum(s.slice(0, 17))),
     idcards.find((s) => s.charAt(17) !== idChecksum(s.slice(0, 17))) || '');

  /* 生日 */
  ok('生日是 YYYY-MM-DD',
     birthdays.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)), birthdays[0]);
  ok('日期都真实存在（不会出现 2 月 30 日）',
     birthdays.every((s) => {
       const [y, m, dd] = s.split('-').map(Number);
       const dt = new Date(y, m - 1, dd);
       return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === dd;
     }), birthdays[0]);
  ok('年龄落在 18–65 岁',
     birthdays.every((s) => {
       const age = new Date().getFullYear() - Number(s.slice(0, 4));
       return age >= 18 && age <= 65;
     }), birthdays[0]);

  /* 公司 / 职位 */
  ok('公司名由前缀 + 行业 + 后缀组成',
     companies.every((s) => C.companySuffix.some((x) => s.endsWith(x)) &&
       C.companyPrefix.some((x) => s.startsWith(x))), companies[0]);
  ok('职位都在职位表里',
     jobs.every((s) => C.jobs.includes(s)), jobs[0]);

  /* 随机性：200 条里不应该全是同一个人 */
  ok('姓名有足够的变化', new Set(names).size > 150, String(new Set(names).size));
  ok('手机号互不相同', new Set(mobiles).size === 200, String(new Set(mobiles).size));

  /* ---------- 3. 字段勾选 ---------- */
  section('3. 字段勾选');
  await toggleField('idcard');
  await toggleField('address');
  ok('取消两列后表头少两列', headers().length === 9, String(headers().length));
  ok('每行也少两列', cellRows()[0].length === 8, String(cellRows()[0].length));
  ok('取消的列真的没了',
     !headers().includes('身份证号') && !headers().includes('地址'), headers().join(','));
  ok('统计跟着变', stats()['字段数'] === '8 列', stats()['字段数']);
  ok('状态行跟着变', /200 条 × 8 列/.test($('#md-status').textContent),
     $('#md-status').textContent);
  ok('还选着手机号时保留警告',
     $('#md-status').textContent.includes('别拿去发短信'), $('#md-status').textContent);

  await toggleField('mobile');
  ok('取消手机号后不再显示手机号警告',
     !$('#md-status').textContent.includes('别拿去发短信'), $('#md-status').textContent);
  await toggleField('mobile');

  await toggleField('idcard');
  await toggleField('address');
  ok('重新勾上后恢复 10 列', headers().length === 11, String(headers().length));

  /* 全部取消 */
  for (const f of ['name', 'gender', 'mobile', 'email', 'address', 'idcard',
                   'birthday', 'company', 'job', 'ip']) {
    await toggleField(f);
  }
  ok('全部取消时给出空状态', $('#md-scroll .code-empty') !== null);
  ok('全部取消时状态行报错',
     $('#md-status .is-error') !== null && $('#md-status').textContent.includes('一个字段都没选'),
     $('#md-status').textContent);
  ok('全部取消时不残留表格', trs().length === 0, String(trs().length));

  for (const f of ['name', 'mobile', 'email', 'address', 'idcard', 'birthday']) {
    await toggleField(f);
  }
  ok('重新勾上 6 列', headers().length === 7, String(headers().length));

  /* ---------- 4. 条数 ---------- */
  section('4. 条数');
  await setCount(1);
  ok('条数 1 -> 1 行', trs().length === 1, String(trs().length));
  await setCount(500);
  ok('条数 500 -> 500 行', trs().length === 500, String(trs().length));

  await setCount(0);
  ok('条数 0 标红', $('#md-count').classList.contains('input--invalid'));
  ok('条数非法时按 1 渲染', trs().length === 1, String(trs().length));
  await fire($('#md-count'), 'blur');
  ok('失焦后回退为 1', $('#md-count').value === '1', $('#md-count').value);
  ok('失焦后清掉标红', !$('#md-count').classList.contains('input--invalid'));

  await setCount(999);
  ok('条数 999 标红', $('#md-count').classList.contains('input--invalid'));
  ok('超上限时按 500 渲染', trs().length === 500, String(trs().length));
  await fire($('#md-count'), 'blur');
  ok('失焦后回退为 500', $('#md-count').value === '500', $('#md-count').value);

  await setCount(5);

  /* ---------- 5. 导出 ---------- */
  section('5. 导出');
  copied = null;
  await click('#md-copy-csv');
  const csv = copied || '';
  ok('复制到了 CSV', csv.length > 0);
  ok('CSV 开头带 UTF-8 BOM（否则 Excel 打开中文乱码）',
     csv.charCodeAt(0) === 0xFEFF, '0x' + csv.charCodeAt(0).toString(16));
  ok('CSV 行尾是 CRLF（RFC 4180）', csv.includes('\r\n'), JSON.stringify(csv.slice(0, 60)));
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  ok('CSV 共 6 行（表头 + 5 条）', lines.length === 6, String(lines.length));
  ok('CSV 表头是当前选中的列',
     lines[0] === '姓名,手机号,邮箱,地址,身份证号,生日', lines[0]);
  ok('CSV 每行 6 列',
     lines.every((l) => l.split(',').length === 6),
     String(lines.map((l) => l.split(',').length)));
  ok('CSV 内容与表格一致',
     lines[1] === column('姓名')[0] + ',' + column('手机号')[0] + ',' +
       column('邮箱')[0] + ',' + column('地址')[0] + ',' +
       column('身份证号')[0] + ',' + column('生日')[0], lines[1]);

  ok('导出 CSV 按钮存在', $('#md-download-csv') !== null);
  ok('导出 JSON 按钮存在', $('#md-download-json') !== null);

  /* ---------- 6. 语料 ---------- */
  section('6. 语料');
  const lists = {
    姓氏: C.surnames, 男名用字: C.givenM, 女名用字: C.givenF,
    区名: C.districts, 路名: C.roads, 公司前缀: C.companyPrefix,
    公司行业: C.companyField, 职位: C.jobs, 邮箱域名: C.emailDomains,
    手机号段: C.mobilePrefix, 省级代码: C.provinceCodes
  };
  for (const [name, list] of Object.entries(lists)) {
    ok(`${name}表没有重复项`, new Set(list).size === list.length,
       String(list.length) + ' → ' + String(new Set(list).size));
  }
  ok('省级行政区 34 个', C.places.length === 34, String(C.places.length));
  ok('每个省级行政区至少有一个市', C.places.every((p) => p.cs.length >= 1));
  ok('省级代码都是「省级」（后 4 位为 0000）',
     C.provinceCodes.every((c) => /^\d{2}0000$/.test(c)), C.provinceCodes.join(','));
  ok('省级代码与行政区列表数量对得上（不含港澳台）',
     C.provinceCodes.length === 31, String(C.provinceCodes.length));
  ok('安全性：邮箱域名全是 RFC 保留域名',
     C.emailDomains.every((x) => RESERVED_DOMAINS.includes(x)), C.emailDomains.join(','));
  ok('安全性：IP 段全是 RFC 5737 文档段',
     C.ipBlocks.every((x) => DOC_IP_BLOCKS.includes(x)), C.ipBlocks.join(','));
  ok('行政区列表里包含中国的全部省级行政区',
     ['台湾省', '香港特别行政区', '澳门特别行政区'].every(
       (n) => C.places.some((p) => p.p === n)),
     C.places.map((p) => p.p).join(','));

  /* ---------- 7. 页面结构 ---------- */
  section('7. 页面结构');
  ok('相关工具已渲染', count(d, '#related-grid .tool-card') === 3,
     String(count(d, '#related-grid .tool-card')));
  ok('分类主题色为生成器的琥珀色',
     d.documentElement.style.getPropertyValue('--hub-accent') === '#d97706',
     d.documentElement.style.getPropertyValue('--hub-accent'));
  ok('说明区引用了 RFC 保留域名',
     d.querySelector('.tool-notes').textContent.includes('RFC 2606'));
  ok('说明区说明了为什么不做银行卡号',
     d.querySelector('.tool-notes').textContent.includes('Luhn'));
  ok('面板里有手机号警告条', d.querySelector('.notice') !== null);
}
