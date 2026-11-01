'use strict';
// Step 1 screens: login, change password, and the super-admin panel (open/suspend clients).
// No build step and no libraries; text is put on the page with textContent, never innerHTML.

const root = document.getElementById('app');
const ERR = {
  wrong_username_or_password: 'ইউজারনেম বা পাসওয়ার্ড ভুল।',
  too_many_attempts: 'অনেকবার ভুল হয়েছে। ১৫ মিনিট পরে আবার চেষ্টা করুন।',
  shop_suspended: 'এই অ্যাকাউন্ট বন্ধ আছে। যোগাযোগ করুন।',
  plan_expired: 'অ্যাকাউন্টের মেয়াদ শেষ। যোগাযোগ করুন।',
  username_taken: 'এই ইউজারনেম আগেই নেওয়া হয়েছে।',
  invalid: 'তথ্য ঠিক নেই। ইউজারনেম ৩-৬৪ অক্ষরের (ফোন নম্বর বা ইমেইল), নাম অন্তত ২ অক্ষরের।',
  wrong_password: 'বর্তমান পাসওয়ার্ড ভুল।',
  not_logged_in: 'আবার লগইন করুন।',
  forbidden: 'এই কাজের অনুমতি নেই।',
  server_error: 'সার্ভারে সমস্যা হয়েছে। একটু পরে চেষ্টা করুন।',
  not_pending: 'এই অনুরোধ আগেই দেখা হয়েছে।',
  invalid_claim: 'এই লিংক কাজ করছে না (মেয়াদ শেষ, বা আগেই ব্যবহার হয়েছে)। যোগাযোগ করুন।',
};
const PAY = { bkash: 'বিকাশ', nagad: 'নগদ', bank: 'ব্যাংক' };
const TYPE = { pharmacy: 'ফার্মেসি', grocery: 'গ্রোসারি', restaurant: 'রেস্টুরেন্ট' };
const DAY = 86400000;

const msg = (d) => ERR[d && d.error] || 'কিছু একটা ভুল হয়েছে।';
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('bn-BD') : '—');
const num = (n) => Number(n || 0).toLocaleString('bn-BD');

async function api(path, method = 'GET', body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body === undefined ? {} : body);
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const show = (...nodes) => root.replaceChildren(...nodes);
function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 2200);
}
const field = (label, input) => h('label', null, label, input);

function topbar(user) {
  return h('header', { class: 'bar' },
    h('h1', null, 'ইনভেন্টরি'),
    h('span', null, user.name + ' ',
      h('button', { class: 'btn alt', type: 'button', onclick: () => showChangePassword(user, false) }, 'পাসওয়ার্ড বদলান'), ' ',
      h('button', { class: 'btn alt', type: 'button', onclick: logout }, 'লগআউট')));
}
async function logout() { await api('/api/auth/logout', 'POST'); showLogin(); }

function route(user) {
  if (user.mustChangePassword) return showChangePassword(user, true);
  if (user.role === 'super_admin') return showAdmin(user);
  return showHome(user);
}

function showLogin() {
  const err = h('p', { class: 'err' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'লগইন');
  const u = h('input', { name: 'username', autocomplete: 'username', required: true });
  const p = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    const r = await api('/api/auth/login', 'POST', { username: u.value, password: p.value });
    btn.disabled = false;
    if (r.ok) route(r.data.user); else err.textContent = msg(r.data);
  } }, field('ইউজারনেম (ফোন নম্বর বা ইমেইল)', u), field('পাসওয়ার্ড', p), btn, err);
  show(h('div', { class: 'card narrow' }, h('h2', null, 'ইনভেন্টরি: লগইন'), form));
  u.focus();
}

function showChangePassword(user, forced) {
  const err = h('p', { class: 'err' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (n1.value !== n2.value) { err.textContent = 'দুই জায়গায় নতুন পাসওয়ার্ড মেলেনি।'; return; }
    const r = await api('/api/auth/change-password', 'POST', { current: cur.value, next: n1.value });
    if (!r.ok) { err.textContent = msg(r.data); return; }
    toast('পাসওয়ার্ড বদলেছে'); boot();
  } }, field(forced ? 'অস্থায়ী পাসওয়ার্ড' : 'বর্তমান পাসওয়ার্ড', cur), field('নতুন পাসওয়ার্ড (অন্তত ৮ অক্ষর)', n1), field('নতুন পাসওয়ার্ড আবার', n2),
    h('button', { class: 'btn', type: 'submit' }, 'পাসওয়ার্ড বদলান'), err);
  const back = forced ? null : h('p', null, h('button', { class: 'btn alt', type: 'button', onclick: () => route(user) }, 'ফিরে যান'));
  show(h('div', { class: 'card narrow' }, h('h2', null, forced ? 'প্রথমে নিজের পাসওয়ার্ড দিন' : 'পাসওয়ার্ড বদলান'),
    forced ? h('p', { class: 'note' }, 'আপনাকে একটা অস্থায়ী পাসওয়ার্ড দেওয়া হয়েছিল। এখন নিজের পাসওয়ার্ড বানান।') : null, form, back));
}

function showHome(user) {
  show(topbar(user), h('main', null, h('div', { class: 'card' },
    h('h2', null, 'স্বাগতম, ' + user.name),
    h('p', null, 'লগইন কাজ করছে। পণ্য, মাল কেনা আর বিক্রির স্ক্রিন পরের ধাপে আসছে.'),
    h('p', { class: 'note' }, 'ভূমিকা: ' + (user.role === 'owner' ? 'মালিক' : 'সেলসম্যান')))));
}

async function showAdmin(user, notice) {
  const [r, rq, pl] = await Promise.all([api('/api/admin/shops'), api('/api/admin/requests?status=pending'), api('/api/admin/plans')]);
  if (!r.ok) { if (r.status === 401) return showLogin(); toast(msg(r.data)); }
  const shops = (r.data && r.data.shops) || [];
  const requests = (rq.data && rq.data.requests) || [];
  const plans = (pl.data && pl.data.plans) || [];

  async function approve(q) {
    if (!window.confirm(q.business_name + ': ট্রানজেকশন ' + q.trx_id + ' কি আপনার বিকাশ/নগদ/ব্যাংকে মিলিয়ে দেখেছেন?')) return;
    const x = await api('/api/admin/requests/' + encodeURIComponent(q.id) + '/approve', 'POST');
    if (x.ok) showAdmin(user, { shop: q.business_name, link: location.origin + x.data.claim_path }); else toast(msg(x.data));
  }
  async function reject(q) {
    const reason = window.prompt('বাতিলের কারণ (ঐচ্ছিক):');
    if (reason === null) return;
    const x = await api('/api/admin/requests/' + encodeURIComponent(q.id) + '/reject', 'POST', { reason });
    if (x.ok) { toast('বাতিল করা হয়েছে'); showAdmin(user); } else toast(msg(x.data));
  }
  const reqRows = requests.map((q) => {
    const tag = !q.plan_price ? h('span', { class: 'tag w' }, 'দাম ঠিক করা হয়নি')
      : q.amount >= q.plan_price ? h('span', { class: 'tag g' }, 'পরিমাণ ঠিক') : h('span', { class: 'tag b' }, 'কম দিয়েছেন');
    return h('tr', null, h('td', null, q.ref), h('td', null, q.business_name), h('td', null, q.owner_name + ' (' + q.phone + ')'),
      h('td', null, q.plan_name || q.plan_code), h('td', null, (PAY[q.payment_method] || q.payment_method) + ' ' + q.trx_id),
      h('td', null, '৳' + num(q.amount / 100) + ' ', tag), h('td', null, fmtDate(q.created_at)),
      h('td', null, h('div', { class: 'acts' },
        h('button', { class: 'btn alt', type: 'button', onclick: () => approve(q) }, 'যাচাই হয়েছে, অনুমোদন'),
        h('button', { class: 'btn alt', type: 'button', onclick: () => reject(q) }, 'বাতিল'))));
  });
  const reqCard = h('div', { class: 'card' }, h('h2', null, 'কেনার অনুরোধ, যাচাই বাকি (' + num(requests.length) + ')'),
    requests.length ? h('div', { class: 'tw' }, h('table', null,
      h('thead', null, h('tr', null, ['কোড', 'দোকান', 'মালিক', 'প্যাকেজ', 'পেমেন্ট', 'টাকা', 'তারিখ', ''].map((t) => h('th', null, t)))),
      h('tbody', null, reqRows))) : h('p', { class: 'note' }, 'কোনো নতুন অনুরোধ নেই।'));

  const planRows = plans.map((p) => {
    const inp = h('input', { type: 'number', min: '0', step: '1', value: String(p.price / 100), style: 'width:120px' });
    return h('tr', null, h('td', null, p.name), h('td', null, h('span', { class: 'note' }, p.code)), h('td', null, inp, ' টাকা / ' + num(p.days) + ' দিন'),
      h('td', null, h('button', { class: 'btn alt', type: 'button', onclick: async () => {
        const x = await api('/api/admin/plans/' + encodeURIComponent(p.code), 'PATCH', { price_taka: Number(inp.value) });
        if (x.ok) { toast('দাম সংরক্ষিত'); showAdmin(user); } else toast(msg(x.data));
      } }, 'সংরক্ষণ')));
  });
  const planCard = h('div', { class: 'card' }, h('h2', null, 'প্যাকেজের দাম'),
    h('div', { class: 'tw' }, h('table', null, h('tbody', null, planRows))),
    h('p', { class: 'note' }, 'দাম ০ থাকলে ওয়েবসাইটে "দাম শীঘ্রই" দেখায় এবং কেনা যায় না।'));

  async function patch(s, body, okText) {
    const x = await api('/api/admin/shops/' + encodeURIComponent(s.id), 'PATCH', body);
    if (x.ok) { toast(okText); showAdmin(user); } else toast(msg(x.data));
  }
  async function resetPw(s) {
    if (!window.confirm(s.name + ': মালিকের পাসওয়ার্ড রিসেট করবেন? তিনি সব ডিভাইস থেকে লগআউট হয়ে যাবেন।')) return;
    const x = await api('/api/admin/shops/' + encodeURIComponent(s.id) + '/reset-owner-password', 'POST');
    if (x.ok) showAdmin(user, { shop: s.name, username: x.data.owner.username, password: x.data.owner.temp_password });
    else toast(msg(x.data));
  }

  const rows = shops.map((s) => {
    const expired = s.plan_until !== null && s.plan_until < Date.now();
    return h('tr', null,
      h('td', null, s.name),
      h('td', null, TYPE[s.business_type] || s.business_type),
      h('td', null, h('span', { class: 'tag ' + (s.status === 'active' ? 'g' : 'b') }, s.status === 'active' ? 'চালু' : 'বন্ধ')),
      h('td', null, fmtDate(s.plan_until), ' ', expired ? h('span', { class: 'tag b' }, 'মেয়াদ শেষ') : null),
      h('td', null, num(s.user_count)),
      h('td', null, fmtDate(s.last_login_at)),
      h('td', null, num(s.sales_30d)),
      h('td', null, h('div', { class: 'acts' },
        h('button', { class: 'btn alt', type: 'button', onclick: () => patch(s, { status: s.status === 'active' ? 'suspended' : 'active' }, s.status === 'active' ? 'বন্ধ করা হয়েছে' : 'চালু করা হয়েছে') }, s.status === 'active' ? 'বন্ধ করুন' : 'চালু করুন'),
        h('button', { class: 'btn alt', type: 'button', onclick: () => patch(s, { plan_until: Math.max(Date.now(), s.plan_until || 0) + 30 * DAY }, 'মেয়াদ ৩০ দিন বেড়েছে') }, '+৩০ দিন'),
        h('button', { class: 'btn alt', type: 'button', onclick: () => resetPw(s) }, 'পাসওয়ার্ড রিসেট'))));
  });

  const err = h('p', { class: 'err' });
  const f = {
    name: h('input', { required: true, minlength: '2', maxlength: '100' }),
    type: h('select', null, Object.entries(TYPE).map(([k, v]) => h('option', { value: k }, v))),
    owner: h('input', { required: true, minlength: '2', maxlength: '100' }),
    user: h('input', { required: true, minlength: '3', maxlength: '64', autocomplete: 'off', placeholder: '01XXXXXXXXX বা ইমেইল' }),
    days: h('input', { type: 'number', min: '1', max: '3650', value: '30' }),
  };
  const create = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const x = await api('/api/admin/shops', 'POST', {
      name: f.name.value, business_type: f.type.value, owner_name: f.owner.value,
      owner_username: f.user.value, plan_days: Number(f.days.value) || undefined,
    });
    if (x.ok) showAdmin(user, { shop: x.data.shop.name, username: x.data.owner.username, password: x.data.owner.temp_password });
    else err.textContent = msg(x.data);
  } },
    h('div', { class: 'row' }, field('দোকানের নাম', f.name), field('ধরন', f.type), field('মালিকের নাম', f.owner)),
    h('div', { class: 'row' }, field('মালিকের ইউজারনেম (ফোন বা ইমেইল)', f.user), field('কত দিনের জন্য চালু', f.days), h('button', { class: 'btn', type: 'submit' }, 'ক্লায়েন্ট খুলুন')), err);

  const box = notice && notice.link ? linkBox(notice) : notice ? h('div', { class: 'secret' },
    h('strong', null, notice.shop + ': '), 'ইউজারনেম ', h('code', null, notice.username), ' অস্থায়ী পাসওয়ার্ড ', h('code', null, notice.password),
    h('button', { class: 'btn alt', type: 'button', onclick: () => navigator.clipboard.writeText(notice.password).then(() => toast('কপি হয়েছে')) }, 'কপি'),
    h('p', { class: 'note' }, 'এটা এখনই মালিককে দিন। এই পাসওয়ার্ড সংরক্ষিত থাকে না, আর দ্বিতীয়বার দেখানো যাবে না।')) : null;

  show(topbar(user), h('main', null, box,
    reqCard,
    h('div', { class: 'card' }, h('h2', null, 'নতুন ক্লায়েন্ট (হাতে খোলা)'), create),
    h('div', { class: 'card' }, h('h2', null, 'ক্লায়েন্ট তালিকা (' + num(shops.length) + ')'),
      shops.length ? h('div', { class: 'tw' }, h('table', null,
        h('thead', null, h('tr', null, ['দোকান', 'ধরন', 'অবস্থা', 'মেয়াদ', 'ইউজার', 'শেষ লগইন', 'বিল (৩০ দিন)', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows))) : h('p', { class: 'note' }, 'এখনো কোনো ক্লায়েন্ট নেই।')),
    planCard));
}

function linkBox(n) {
  return h('div', { class: 'secret' }, h('strong', null, n.shop + ': '), 'এই লিংক গ্রাহককে পাঠান (৭ দিন চলবে): ', h('code', { class: 'lk' }, n.link),
    h('button', { class: 'btn alt', type: 'button', onclick: () => navigator.clipboard.writeText(n.link).then(() => toast('কপি হয়েছে')) }, 'কপি'),
    h('p', { class: 'note' }, 'লিংকটা আর দেখানো যাবে না। গ্রাহক এতে নিজের পাসওয়ার্ড বানিয়ে অ্যাকাউন্ট খুলবেন।'));
}

function showClaim(token) {
  const err = h('p', { class: 'err' });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'অ্যাকাউন্ট খুলুন');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (n1.value !== n2.value) { err.textContent = 'দুই জায়গায় পাসওয়ার্ড মেলেনি।'; return; }
    btn.disabled = true;
    const r = await api('/api/public/claim', 'POST', { token, password: n1.value });
    btn.disabled = false;
    if (!r.ok) { err.textContent = msg(r.data); return; }
    history.replaceState(null, '', '/app/');
    route(r.data.user);
  } }, field('আপনার পাসওয়ার্ড (অন্তত ৮ অক্ষর)', n1), field('পাসওয়ার্ড আবার', n2), btn, err);
  show(h('div', { class: 'card narrow' }, h('h2', null, 'আপনার অ্যাকাউন্ট খুলুন'),
    h('p', { class: 'note' }, 'পেমেন্ট যাচাই হয়েছে। নিজের একটা পাসওয়ার্ড দিন। ইউজারনেম হবে আপনার ফোন নম্বর।'), form));
}

async function boot() {
  const m = /^#claim=([A-Za-z0-9]+)$/.exec(location.hash);
  if (m) return showClaim(m[1]);
  const r = await api('/api/auth/me');
  if (r.ok) route(r.data.user); else showLogin();
}
boot();
