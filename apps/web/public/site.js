'use strict';
// Public website: shows plans and prices, takes a purchase request, and checks its status.
const $ = (id) => document.getElementById(id);
const bn = (n) => Number(n || 0).toLocaleString('bn-BD');
const TYPE = { pharmacy: 'ফার্মেসি', grocery: 'গ্রোসারি', restaurant: 'রেস্টুরেন্ট' };
const ERR = {
  invalid: 'তথ্য ঠিক নেই। ফোন নম্বর (শুধু সংখ্যা), TrxID (অন্তত ৬ অক্ষর) আর বাকি ঘর আবার দেখুন।',
  trx_used: 'এই TrxID দিয়ে আগেই অনুরোধ পাঠানো হয়েছে।',
  too_many_attempts: 'অনেকবার চেষ্টা হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।',
  sales_closed: 'কেনা এখনো চালু হয়নি।',
  unknown_plan: 'প্যাকেজটা পাওয়া যায়নি। পাতা নতুন করে খুলুন।',
};
const STATUS = {
  pending: 'আপনার পেমেন্ট যাচাই চলছে। যাচাই হলে ফোনে লিংক পাবেন।',
  approved: 'যাচাই হয়েছে। অ্যাকাউন্ট খোলার লিংক আপনার ফোনে পাঠানো হয়েছে বা হবে। লিংক না পেলে যোগাযোগ করুন।',
  rejected: 'এই অনুরোধ বাতিল হয়েছে। যোগাযোগ করুন।',
  claimed: 'আপনার অ্যাকাউন্ট খোলা হয়ে গেছে। লগইন পাতায় গিয়ে ফোন নম্বর ও পাসওয়ার্ড দিন।',
};

async function api(path, method = 'GET', body) {
  const init = { method, headers: {} };
  if (method !== 'GET') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, data };
}
function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

let PLANS = [];
function pick(code) {
  $('f_plan').value = code;
  const p = PLANS.find((x) => x.code === code);
  if (p) $('f_amount').value = p.price_taka;
  $('buy').scrollIntoView({ behavior: 'smooth' });
}

(async function init() {
  const r = await api('/api/public/plans');
  const box = $('plans');
  if (!r.ok) { box.replaceChildren(el('p', 'note', 'দাম এখন দেখানো যাচ্ছে না। একটু পরে চেষ্টা করুন।')); return; }
  PLANS = r.data.plans;
  const open = r.data.sales_open;
  const pay = r.data.payment || {};
  box.replaceChildren(...PLANS.map((p) => {
    const priced = p.price_taka > 0;
    const card = el('div', 'plan', el('b', null, p.name), el('span', 'note', TYPE[p.business_type] + ', ' + bn(p.days) + ' দিন'));
    card.append(el('div', 'price', priced ? '৳' + bn(p.price_taka) : 'দাম শীঘ্রই', priced ? el('small', null, ' / বছর') : ''));
    if (open && priced) {
      const b = el('button', 'btn', 'কিনুন');
      b.type = 'button'; b.addEventListener('click', () => pick(p.code));
      card.append(b);
    }
    return card;
  }));

  const haveNumber = pay.bkash || pay.nagad;
  if (open && haveNumber) {
    $('buy').hidden = false;
    $('f_plan').replaceChildren(...PLANS.filter((p) => p.price_taka > 0).map((p) => { const o = el('option', null, p.name + ' (৳' + bn(p.price_taka) + ')'); o.value = p.code; return o; }));
    const first = PLANS.find((p) => p.price_taka > 0);
    if (first) $('f_amount').value = first.price_taka;
    $('f_plan').addEventListener('change', () => { const p = PLANS.find((x) => x.code === $('f_plan').value); if (p) $('f_amount').value = p.price_taka; });
    const lines = [];
    if (pay.bkash) lines.push('বিকাশ: ' + pay.bkash);
    if (pay.nagad) lines.push('নগদ: ' + pay.nagad);
    $('payinfo').replaceChildren(el('strong', null, 'টাকা পাঠান এখানে: '), lines.join('   |   '));
  } else {
    $('closed').hidden = false;
  }
})();

$('buyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('f_err').textContent = '';
  $('f_btn').disabled = true;
  const r = await api('/api/public/requests', 'POST', {
    plan_code: $('f_plan').value, business_name: $('f_biz').value, owner_name: $('f_owner').value, phone: $('f_phone').value,
    payment_method: $('f_method').value, trx_id: $('f_trx').value, amount_taka: Number($('f_amount').value), website: $('f_web').value,
  });
  $('f_btn').disabled = false;
  if (!r.ok) { $('f_err').textContent = ERR[r.data && r.data.error] || 'কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।'; return; }
  $('buyForm').hidden = true;
  const done = $('buyDone');
  done.hidden = false;
  done.replaceChildren(el('strong', null, 'অনুরোধ পাঠানো হয়েছে। আপনার কোড: '), el('code', null, r.data.ref),
    el('p', 'note', 'কোডটা লিখে রাখুন। পেমেন্ট মিলিয়ে দেখে আমরা আপনার ফোন নম্বরে লিংক পাঠাব। নিচে কোড আর ফোন নম্বর দিয়ে অবস্থা দেখতে পারবেন।'));
});

$('statForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api('/api/public/requests/' + encodeURIComponent($('s_ref').value.trim()) + '?phone=' + encodeURIComponent($('s_phone').value.trim()));
  $('s_out').textContent = r.ok ? (STATUS[r.data.status] || '') : 'এই কোড ও ফোন নম্বরে কোনো অনুরোধ পাওয়া যায়নি।';
});
