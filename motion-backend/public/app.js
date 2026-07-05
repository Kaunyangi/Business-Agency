/* =========================================================
   UTIL
   ========================================================= */
const API = '/api';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmtKES = c => 'KES ' + Math.round(c / 100).toLocaleString('en-KE');
const fmtKESraw = n => 'KES ' + Math.round(n).toLocaleString('en-KE');

/* Escape untrusted strings (event names, organizer input, etc.) before interpolating into innerHTML. */
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(str) { return String(str ?? '').replace(/[&<>"']/g, c => ESCAPE_MAP[c]); }

/* Only allow a real base64 image data URL through into a CSS background — poster_data_url
   is organizer-supplied and the API does not constrain its format, so anything else is dropped
   rather than interpolated into a style attribute. */
function safePosterCSS(dataUrl) {
  if (typeof dataUrl === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    return `background-image:url("${dataUrl}")`;
  }
  return '';
}

let session = { token: localStorage.getItem('motion_token') || null, user: JSON.parse(localStorage.getItem('motion_user') || 'null') };

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (session.token) headers['Authorization'] = 'Bearer ' + session.token;
  const res = await fetch(API + path, { ...opts, headers });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json() : await res.blob();
  if (!res.ok) throw Object.assign(new Error(body.error || 'Request failed'), { status: res.status, detail: body });
  return body;
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast'); $('#toastMsg').textContent = msg;
  t.classList.toggle('err', !!isErr); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function errBoxHTML(err) {
  return `<div class="error-box">${err.message}${err.detail && err.detail.details ? ': ' + err.detail.details.map(d => d.message).join(', ') : ''}</div>`;
}

async function downloadDoc(docId, label) {
  try {
    const blob = await api(`/documents/${docId}/download`);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    toast(`${label} opened in a new tab`);
  } catch (err) { toast(err.message, true); }
}

/* =========================================================
   TICKET / BOARDING PASS / VOUCHER RENDERER (shared visual)
   ========================================================= */
function seeded(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

function renderQR(svg) {
  svg.innerHTML = '';
  const size = 11, cell = 10;
  const rnd = seeded(svg.dataset.seed ? +svg.dataset.seed : 7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isFinder = (x < 3 && y < 3) || (x > size - 4 && y < 3) || (x < 3 && y > size - 4);
      if (isFinder) continue;
      if (rnd() > 0.52) {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x * cell); r.setAttribute('y', y * cell);
        r.setAttribute('width', cell - 1.5); r.setAttribute('height', cell - 1.5);
        r.setAttribute('fill', '#fffcf7'); r.setAttribute('rx', 1);
        svg.appendChild(r);
      }
    }
  }
  [[0, 0], [size - 3, 0], [0, size - 3]].forEach(([fx, fy]) => {
    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    outer.setAttribute('x', fx * cell); outer.setAttribute('y', fy * cell);
    outer.setAttribute('width', cell * 3 - 1.5); outer.setAttribute('height', cell * 3 - 1.5);
    outer.setAttribute('fill', 'none'); outer.setAttribute('stroke', '#fffcf7'); outer.setAttribute('stroke-width', '3');
    svg.appendChild(outer);
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    inner.setAttribute('x', fx * cell + 7); inner.setAttribute('y', fy * cell + 7);
    inner.setAttribute('width', cell - 3); inner.setAttribute('height', cell - 3);
    inner.setAttribute('fill', '#fffcf7');
    svg.appendChild(inner);
  });
}

function ticketHTML(data, opts = {}) {
  const docLink = opts.receiptId
    ? `<button class="doc-link" data-doc="${opts.receiptId}" data-label="Receipt">Download receipt (PDF) ↓</button>`
    : '<span></span>';
  return `
  <div class="ticket">
    <div class="ticket-top">
      <div class="watermark"><span>motion</span><span>trybe</span><span>motion</span></div>
      <div class="ticket-brandrow">
        <div class="left">
          <div class="dot"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="#0b6e6e" stroke-width="1.6"/><path d="M6 15V9l3 3 3-4 3 4 3-3v6" stroke="#0b6e6e" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <b>Issued via Motion</b>
        </div>
        <div class="right">${esc(data.kind || 'GENERAL ADMISSION')}</div>
      </div>
      <div class="ticket-event"><h3>${esc(data.title)}</h3><p>${esc(data.sub)}</p></div>
    </div>
    <div class="ticket-perf"><div class="notch l"></div><div class="dash"></div><div class="notch r"></div></div>
    <div class="ticket-bottom">
      <div class="tk-detail">
        <div><span class="lbl">Holder</span><span class="val">${esc(data.holder)}</span></div>
        <div><span class="lbl">Category</span><span class="val">${esc(data.section)}</span></div>
        <div><span class="lbl">Ticket type</span><span class="val">${esc(data.type)}</span></div>
        <div><span class="lbl">Paid via</span><span class="val">${esc(data.paidVia)}</span></div>
      </div>
      <div class="qr-box"><svg class="qrsvg" data-seed="${data.seed}" width="110" height="110" viewBox="0 0 110 110"></svg></div>
    </div>
    <div class="ticket-foot">
      <span class="id">TICKET ID · ${esc(data.ticketId)}</span>
      ${docLink}
      <div class="badges"><span style="background:#dd3a24"></span><span style="background:#5b7fc7"></span><span style="background:#a8d97a"></span></div>
    </div>
  </div>`;
}
function mountTicketInto(el, data, opts) {
  el.innerHTML = ticketHTML(data, opts);
  renderQR(el.querySelector('.qrsvg'));
  const btn = el.querySelector('.doc-link');
  if (btn) btn.addEventListener('click', () => downloadDoc(btn.dataset.doc, btn.dataset.label));
}

/* Sample ticket shown on the public marketing landing page (illustrative only) */
mountTicketInto($('#sampleTicketWrap'), {
  title: 'Sun Festival — Diani', sub: 'SAT 12 SEP 2026 · GATES 14:00 · DIANI BEACH GROUNDS',
  holder: 'K. Timothy', section: 'GA — Beachfront', type: 'Early Bird', paidVia: 'Motion Pay',
  ticketId: 'MTN-SF26-88231-KE', seed: 42,
});

/* =========================================================
   MARKETING LANDING — demo phone tab switcher
   ========================================================= */
$('#demoTabBar').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  $$('#demoTabBar button').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  $$('.app-view').forEach(v => v.classList.remove('active'));
  $('#demo-' + btn.dataset.tab).classList.add('active');
});

/* =========================================================
   MARKETING LANDING — "Country" dropdown (all African countries)
   ========================================================= */
const AFRICAN_COUNTRIES = [
  ['DZ', 'Algeria', '213'], ['AO', 'Angola', '244'], ['BJ', 'Benin', '229'], ['BW', 'Botswana', '267'],
  ['BF', 'Burkina Faso', '226'], ['BI', 'Burundi', '257'], ['CV', 'Cabo Verde', '238'], ['CM', 'Cameroon', '237'],
  ['CF', 'Central African Republic', '236'], ['TD', 'Chad', '235'], ['KM', 'Comoros', '269'],
  ['CG', 'Congo-Brazzaville', '242'], ['CD', 'Congo-Kinshasa', '243'], ['CI', "Cote d'Ivoire", '225'],
  ['DJ', 'Djibouti', '253'], ['EG', 'Egypt', '20'], ['GQ', 'Equatorial Guinea', '240'], ['ER', 'Eritrea', '291'],
  ['SZ', 'Eswatini', '268'], ['ET', 'Ethiopia', '251'], ['GA', 'Gabon', '241'], ['GM', 'Gambia', '220'],
  ['GH', 'Ghana', '233'], ['GN', 'Guinea', '224'], ['GW', 'Guinea-Bissau', '245'], ['KE', 'Kenya', '254'],
  ['LS', 'Lesotho', '266'], ['LR', 'Liberia', '231'], ['LY', 'Libya', '218'], ['MG', 'Madagascar', '261'],
  ['MW', 'Malawi', '265'], ['ML', 'Mali', '223'], ['MR', 'Mauritania', '222'], ['MU', 'Mauritius', '230'],
  ['MA', 'Morocco', '212'], ['MZ', 'Mozambique', '258'], ['NA', 'Namibia', '264'], ['NE', 'Niger', '227'],
  ['NG', 'Nigeria', '234'], ['RW', 'Rwanda', '250'], ['ST', 'Sao Tome and Principe', '239'],
  ['SN', 'Senegal', '221'], ['SC', 'Seychelles', '248'], ['SL', 'Sierra Leone', '232'], ['SO', 'Somalia', '252'],
  ['ZA', 'South Africa', '27'], ['SS', 'South Sudan', '211'], ['SD', 'Sudan', '249'], ['TZ', 'Tanzania', '255'],
  ['TG', 'Togo', '228'], ['TN', 'Tunisia', '216'], ['UG', 'Uganda', '256'], ['ZM', 'Zambia', '260'],
  ['ZW', 'Zimbabwe', '263'],
];
function flagEmoji(iso2) {
  return String.fromCodePoint(...[...iso2.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
}
$('#countryTagPanel').innerHTML = AFRICAN_COUNTRIES.map(([iso, name, dial]) => `
  <div class="hero-tag-option" data-iso="${iso}" data-name="${esc(name)}" data-dial="${dial}">
    <span class="flag">${flagEmoji(iso)}</span><span>${esc(name)}</span><span class="code">+${dial}</span>
  </div>`).join('');
$('#countryTagBtn').addEventListener('click', e => {
  e.stopPropagation();
  const panel = $('#countryTagPanel');
  const open = panel.classList.toggle('open');
  $('#countryTagBtn').setAttribute('aria-expanded', String(open));
});
$('#countryTagPanel').addEventListener('click', e => {
  const opt = e.target.closest('.hero-tag-option'); if (!opt) return;
  $('#countryTagFlag').textContent = flagEmoji(opt.dataset.iso);
  $('#countryTagLabel').textContent = `${opt.dataset.name} +${opt.dataset.dial}`;
  $('#countryTagPanel').classList.remove('open');
  $('#countryTagBtn').setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#countryTagWrap')) { $('#countryTagPanel').classList.remove('open'); $('#countryTagBtn').setAttribute('aria-expanded', 'false'); }
});

/* =========================================================
   MARKETING LANDING — "Flights and stays" preview (public API, no login)
   ========================================================= */
let staysPreviewLoaded = false;
$('#staysTagBtn').addEventListener('click', async () => {
  $('#staysPreviewModal').classList.remove('hidden');
  if (staysPreviewLoaded) return;
  try {
    const { properties: props } = await api('/stays');
    staysPreviewLoaded = true;
    const counts = {};
    props.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
    $('#staysPreviewSummary').innerHTML = `<span>${props.length} properties</span>` +
      Object.entries(counts).map(([type, n]) => `<span>${n} ${esc(type)}${n !== 1 ? 's' : ''}</span>`).join('');
    $('#staysPreviewGrid').innerHTML = props.map((p, i) => {
      const fromCents = Math.min(...p.rooms.map(r => r.price_cents));
      return `<div class="stays-mini-card">
        <div class="art" style="background:linear-gradient(150deg,${AIRLINE_COLORS[i % AIRLINE_COLORS.length]},#14181a)"></div>
        <div class="info">
          <span class="type-badge">${esc(p.type)}</span>
          <b>${esc(p.name)}</b>
          <span class="loc">${esc(p.location)}${p.country ? ', ' + esc(p.country) : ''}</span>
          <div class="from-price">from ${fmtKES(fromCents)}/night</div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    $('#staysPreviewGrid').innerHTML = errBoxHTML(err);
  }
});
$('#staysPreviewCloseBtn').addEventListener('click', () => $('#staysPreviewModal').classList.add('hidden'));
$('#staysPreviewModal').addEventListener('click', e => { if (e.target.id === 'staysPreviewModal') $('#staysPreviewModal').classList.add('hidden'); });

/* =========================================================
   AUTH MODAL
   ========================================================= */
let authMode = 'login';
function updateFreeToListNote() {
  const role = $('#authRole').value;
  $('#freeToListNote').classList.toggle('hidden', !(authMode === 'register' && (role === 'organizer' || role === 'host')));
}
function openAuthModal(mode) {
  authMode = mode || 'login';
  $$('.auth-tabs button').forEach(b => b.classList.toggle('active', b.dataset.mode === authMode));
  $('#roleField').classList.toggle('hidden', authMode !== 'register');
  $('#nameField').classList.toggle('hidden', authMode !== 'register');
  $('#phoneField').classList.toggle('hidden', authMode !== 'register');
  $('#termsField').classList.toggle('hidden', authMode !== 'register');
  $('#authTerms').checked = false;
  $('#authSubmit').textContent = authMode === 'register' ? 'Create account' : 'Log in';
  $('#authError').innerHTML = '';
  updateFreeToListNote();
  $('#authModal').classList.remove('hidden');
}
function closeAuthModal() { $('#authModal').classList.add('hidden'); }

$('#navLoginBtn').addEventListener('click', () => openAuthModal('login'));
$('#navGetStartedBtn').addEventListener('click', () => openAuthModal('register'));
$('#heroGetStartedBtn').addEventListener('click', () => openAuthModal('register'));
$('#authCloseBtn').addEventListener('click', closeAuthModal);
$('#authModal').addEventListener('click', e => { if (e.target.id === 'authModal') closeAuthModal(); });
$$('.auth-tabs button').forEach(b => b.addEventListener('click', () => openAuthModal(b.dataset.mode)));
$('#authRole').addEventListener('change', updateFreeToListNote);

$('#termsLink').addEventListener('click', e => { e.preventDefault(); $('#termsModal').classList.remove('hidden'); });
$('#termsCloseBtn').addEventListener('click', () => $('#termsModal').classList.add('hidden'));
$('#termsAcceptBtn').addEventListener('click', () => { $('#authTerms').checked = true; $('#termsModal').classList.add('hidden'); });
$('#termsModal').addEventListener('click', e => { if (e.target.id === 'termsModal') $('#termsModal').classList.add('hidden'); });

$('#authSubmit').addEventListener('click', async () => {
  $('#authError').innerHTML = '';
  const name = $('#authName').value.trim();
  const email = $('#authEmail').value.trim();
  const phone = $('#authPhone').value.trim();
  const password = $('#authPassword').value;
  const role = $('#authRole').value;
  const btn = $('#authSubmit');
  if (authMode === 'register' && !$('#authTerms').checked) {
    $('#authError').innerHTML = '<div class="error-box">Please accept the Terms &amp; Conditions to continue.</div>';
    return;
  }
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const body = authMode === 'register'
      ? await api('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, phone, role, termsAccepted: true }) })
      : await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    session = { token: body.token, user: body.user };
    localStorage.setItem('motion_token', body.token);
    localStorage.setItem('motion_user', JSON.stringify(body.user));
    closeAuthModal();
    bootApp();
  } catch (err) {
    $('#authError').innerHTML = errBoxHTML(err);
  } finally {
    btn.disabled = false; btn.textContent = authMode === 'register' ? 'Create account' : 'Log in';
  }
});

$('#logoutBtn').addEventListener('click', () => {
  session = { token: null, user: null };
  localStorage.removeItem('motion_token'); localStorage.removeItem('motion_user');
  location.reload();
});

/* =========================================================
   APP SHELL / ROLE-AWARE TABS
   ========================================================= */
function tabsForRole(role) {
  const tabs = [
    { key: 'buy', label: "What's on" },
    { key: 'flight', label: 'Book a Flight' },
    { key: 'bus', label: 'Book a Bus' },
    { key: 'sgr', label: 'Book SGR' },
    { key: 'stay', label: 'Book a Stay' },
    { key: 'wallet', label: 'Motion Pay' },
    { key: 'tickets', label: 'My Tickets' },
  ];
  if (role === 'host' || role === 'admin') tabs.unshift({ key: 'host', label: 'List a Stay' });
  if (role === 'organizer' || role === 'admin') tabs.unshift({ key: 'organizer', label: 'Organizer Studio' });
  if (role === 'admin') tabs.push({ key: 'admin', label: 'Revenue Admin' });
  return tabs;
}
function renderTabs() {
  const tabs = tabsForRole(session.user.role);
  $('#mainTabs').innerHTML = tabs.map((t, i) => `<button data-panel="${t.key}" class="${i === 0 ? 'active' : ''}">${t.label}</button>`).join('');
  $$('.panel').forEach(p => p.classList.remove('active'));
  $('#panel-' + tabs[0].key).classList.add('active');
  loadPanel(tabs[0].key);
}
function loadPanel(key) {
  if (key === 'buy') loadEvents();
  if (key === 'wallet') loadWallet();
  if (key === 'admin') { loadRules(); loadSummary(); }
  if (key === 'organizer') loadMyEvents();
  if (key === 'host') loadMyProperties();
  if (key === 'tickets') renderMyTickets();
}
document.addEventListener('click', e => {
  const btn = e.target.closest('#mainTabs button'); if (!btn) return;
  $$('#mainTabs button').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  $$('.panel').forEach(p => p.classList.remove('active'));
  $('#panel-' + btn.dataset.panel).classList.add('active');
  loadPanel(btn.dataset.panel);
});

async function refreshWalletPill() {
  try {
    const w = await api('/wallet');
    $('#walletBalanceLabel').textContent = 'Motion Pay · ' + fmtKES(w.balanceCents);
    $('#walletHeroBalance').textContent = fmtKES(w.balanceCents);
  } catch (_) {}
}

async function bootApp() {
  $('#landing').classList.add('hidden');
  $('#marketingNav').classList.add('hidden');
  $('#loggedOutActions').classList.add('hidden');
  $('#mainTabs').classList.remove('hidden');
  $('#loggedInActions').classList.remove('hidden');
  $('#appShell').classList.remove('hidden');
  renderTabs();
  await refreshWalletPill();
  if (session.user.role === 'organizer' || session.user.role === 'admin') renderTierEditor();
  prefillBuyerDetails();
  loadAirlines();
  loadProperties();
  loadBusRoutes();
  loadSgrRoutes();
}

/* =========================================================
   BUYER DETAILS — shared across ticket/flight/stay checkout
   ========================================================= */
function prefillBuyerDetails() {
  ['ticket', 'flight', 'bus', 'sgr', 'stay'].forEach(prefix => {
    $('#' + prefix + 'BuyerName').value = session.user.name || '';
    $('#' + prefix + 'BuyerPhone').value = session.user.phone || '';
    $('#' + prefix + 'BuyerEmail').value = session.user.email || '';
  });
}
function readBuyerDetails(prefix) {
  return {
    buyerName: $('#' + prefix + 'BuyerName').value.trim(),
    buyerPhone: $('#' + prefix + 'BuyerPhone').value.trim(),
    buyerEmail: $('#' + prefix + 'BuyerEmail').value.trim(),
    buyerIdNumber: $('#' + prefix + 'BuyerId').value.trim() || undefined,
  };
}
function buyerDetailsValid(prefix) {
  const d = readBuyerDetails(prefix);
  return !!(d.buyerName && d.buyerPhone && d.buyerEmail);
}

/* =========================================================
   ORGANIZER STUDIO
   ========================================================= */
let tierSeq = 0;
let tiers = [{ id: ++tierSeq, name: 'Early Bird', price: 2500, qty: 150 }, { id: ++tierSeq, name: 'Regular', price: 4200, qty: 400 }];
let orgBuyerQty = {};
let posterDataUrl = null;
let orgState = { name: '', category: 'Music', city: '', venue: '', date: '', time: '' };

function renderTierEditor() {
  $('#tierList').innerHTML = tiers.map(t => `
    <div class="tier-row" data-id="${t.id}">
      <input class="text-input tier-name" value="${t.name}" placeholder="Category name">
      <input class="text-input tier-price" type="number" min="0" value="${t.price}" placeholder="Price">
      <input class="text-input tier-qty" type="number" min="0" value="${t.qty}" placeholder="Qty">
      <button class="tier-remove" title="Remove">✕</button>
    </div>`).join('');
  tiers.forEach(t => { orgBuyerQty[t.id] = orgBuyerQty[t.id] || 0; });
  renderOrgPreview();
}
$('#tierList').addEventListener('input', e => {
  const row = e.target.closest('.tier-row'); if (!row) return;
  const t = tiers.find(x => x.id === +row.dataset.id); if (!t) return;
  if (e.target.classList.contains('tier-name')) t.name = e.target.value || 'Untitled category';
  if (e.target.classList.contains('tier-price')) t.price = +e.target.value || 0;
  if (e.target.classList.contains('tier-qty')) t.qty = +e.target.value || 0;
  renderOrgPreview();
});
$('#tierList').addEventListener('click', e => {
  if (!e.target.classList.contains('tier-remove')) return;
  const row = e.target.closest('.tier-row');
  tiers = tiers.filter(t => t.id !== +row.dataset.id);
  renderTierEditor();
});
$('#addTierBtn').addEventListener('click', () => {
  tiers.push({ id: ++tierSeq, name: 'New category', price: 1000, qty: 100 });
  renderTierEditor();
});

$('#posterInput').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    posterDataUrl = ev.target.result;
    $('#posterPlaceholder').classList.add('hidden');
    $('#replaceTag').classList.remove('hidden');
    $('#dropzone').classList.add('has-image');
    let img = $('#dropzone img');
    if (!img) { img = document.createElement('img'); $('#dropzone').prepend(img); }
    img.src = posterDataUrl;
    renderOrgPreview();
  };
  reader.readAsDataURL(file);
});

['fEventName', 'fCategory', 'fCity', 'fVenue', 'fDate', 'fTime'].forEach(id => {
  $('#' + id).addEventListener('input', () => {
    orgState.name = $('#fEventName').value;
    orgState.category = $('#fCategory').value;
    orgState.city = $('#fCity').value;
    orgState.venue = $('#fVenue').value;
    orgState.date = $('#fDate').value;
    orgState.time = $('#fTime').value;
    renderOrgPreview();
  });
});

function renderOrgPreview() {
  const posterEl = $('#previewPoster');
  if (posterDataUrl) {
    posterEl.style.backgroundImage = `url(${posterDataUrl})`;
    $('#previewPosterPh').classList.add('hidden');
  } else {
    posterEl.style.backgroundImage = '';
    $('#previewPosterPh').classList.remove('hidden');
  }
  $('#previewCategory').textContent = orgState.category;
  $('#previewTitle').textContent = orgState.name || 'Untitled event';
  const dateStr = orgState.date ? new Date(orgState.date + 'T00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Date TBC';
  $('#previewMeta').textContent = `${dateStr}${orgState.time ? ' · Gates ' + orgState.time : ''} · ${orgState.venue || 'Venue TBC'}${orgState.city ? ', ' + orgState.city : ''}`;

  $('#previewTiers').innerHTML = tiers.map(t => {
    const q = orgBuyerQty[t.id] || 0;
    return `<div class="buy-row" data-id="${t.id}">
      <div><div class="name">${esc(t.name)}</div><div class="avail">${t.qty} available</div></div>
      <div class="price">${fmtKESraw(t.price)}</div>
      <div class="stepper">
        <button class="qminus" ${q <= 0 ? 'disabled' : ''}>−</button>
        <span>${q}</span>
        <button class="qplus" ${q >= t.qty ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  }).join('') || '<div class="buy-row"><span class="avail">Add a ticket category to preview checkout</span></div>';

  const total = tiers.reduce((sum, t) => sum + (orgBuyerQty[t.id] || 0) * t.price, 0);
  $('#previewTotal').textContent = fmtKESraw(total);
  $('#publishBtn').disabled = !(orgState.name && orgState.venue && orgState.date && tiers.length > 0);
}
$('#previewTiers').addEventListener('click', e => {
  const row = e.target.closest('.buy-row'); if (!row || !row.dataset.id) return;
  const id = +row.dataset.id;
  const t = tiers.find(x => x.id === id); if (!t) return;
  if (e.target.classList.contains('qplus') && orgBuyerQty[id] < t.qty) orgBuyerQty[id]++;
  if (e.target.classList.contains('qminus') && orgBuyerQty[id] > 0) orgBuyerQty[id]--;
  renderOrgPreview();
});
renderOrgPreview();

$('#publishBtn').addEventListener('click', async () => {
  $('#orgError').innerHTML = '';
  const payload = {
    name: orgState.name, category: orgState.category, city: orgState.city,
    venue: orgState.venue, event_date: orgState.date, gate_time: orgState.time,
    description: $('#fDesc').value, poster_data_url: posterDataUrl || undefined,
    tiers: tiers.map(t => ({ name: t.name, price_cents: Math.round(t.price * 100), quantity_total: t.qty })),
  };
  const btn = $('#publishBtn');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    await api('/events', { method: 'POST', body: JSON.stringify(payload) });
    toast('Event published to the live catalogue');
    loadMyEvents(); loadEvents();
  } catch (err) {
    $('#orgError').innerHTML = errBoxHTML(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Publish event'; renderOrgPreview();
  }
});

async function loadMyEvents() {
  try {
    const { events } = await api('/events/mine/dashboard');
    $('#myEvents').innerHTML = events.length ? events.map(e => `
      <div class="event-card">
        <b>${esc(e.name)}</b>
        <div class="meta">${esc(e.venue)} · ${esc(e.event_date)} · gross ${fmtKES(e.grossCents)}</div>
        ${e.tiers.map(t => `<div class="hint">${esc(t.name)}: ${t.quantity_sold}/${t.quantity_total} sold</div>`).join('')}
      </div>`).join('') : '<span class="hint">No events published yet.</span>';
  } catch (err) { $('#myEvents').innerHTML = errBoxHTML(err); }
}

/* =========================================================
   HOST STUDIO — "List a Stay"
   ========================================================= */
let roomSeq = 0;
let hostRooms = [{ id: ++roomSeq, name: 'Garden Room', price: 6500, capacity: 2, tags: 'Fan, Garden view, Breakfast' }];
let hostState = { name: '', type: 'Villa', location: '', country: '' };

$('#hCountry').innerHTML = '<option value="">Select country</option>' + AFRICAN_COUNTRIES.map(([, name]) => `<option>${esc(name)}</option>`).join('');

function renderHostRoomEditor() {
  $('#hRoomList').innerHTML = hostRooms.map(r => `
    <div class="tier-row" data-id="${r.id}">
      <input class="text-input room-name" value="${esc(r.name)}" placeholder="Room name">
      <input class="text-input room-price" type="number" min="0" value="${r.price}" placeholder="Price/night">
      <input class="text-input room-cap" type="number" min="1" value="${r.capacity}" placeholder="Sleeps">
      <button class="tier-remove" title="Remove">✕</button>
    </div>
    <div class="field" style="margin:-6px 0 10px"><input class="text-input room-tags" data-id="${r.id}" value="${esc(r.tags)}" placeholder="Amenities, comma separated (e.g. AC, Sea view, Breakfast)"></div>`).join('');
  renderHostPreview();
}
$('#hRoomList').addEventListener('input', e => {
  const row = e.target.closest('[data-id]'); if (!row) return;
  const r = hostRooms.find(x => x.id === +row.dataset.id); if (!r) return;
  if (e.target.classList.contains('room-name')) r.name = e.target.value || 'Untitled room';
  if (e.target.classList.contains('room-price')) r.price = +e.target.value || 0;
  if (e.target.classList.contains('room-cap')) r.capacity = +e.target.value || 1;
  if (e.target.classList.contains('room-tags')) r.tags = e.target.value;
  renderHostPreview();
});
$('#hRoomList').addEventListener('click', e => {
  if (!e.target.classList.contains('tier-remove')) return;
  const row = e.target.closest('[data-id]');
  hostRooms = hostRooms.filter(r => r.id !== +row.dataset.id);
  renderHostRoomEditor();
});
$('#hAddRoomBtn').addEventListener('click', () => {
  hostRooms.push({ id: ++roomSeq, name: 'New room', price: 5000, capacity: 2, tags: '' });
  renderHostRoomEditor();
});

['hName', 'hType', 'hLocation', 'hCountry'].forEach(id => {
  $('#' + id).addEventListener('input', () => {
    hostState.name = $('#hName').value;
    hostState.type = $('#hType').value;
    hostState.location = $('#hLocation').value;
    hostState.country = $('#hCountry').value;
    renderHostPreview();
  });
});

function renderHostPreview() {
  $('#hPreviewType').textContent = hostState.type;
  $('#hPreviewTitle').textContent = hostState.name || 'Untitled property';
  $('#hPreviewMeta').textContent = `${hostState.location || 'City TBC'}${hostState.country ? ', ' + hostState.country : ''}`;
  $('#hPreviewRooms').innerHTML = hostRooms.map(r => `
    <div class="buy-row"><div><div class="name">${esc(r.name)}</div><div class="avail">Sleeps ${r.capacity}</div></div><div class="price">${fmtKESraw(r.price)}/night</div></div>
  `).join('') || '<div class="buy-row"><span class="avail">Add a room to preview</span></div>';
  $('#hPublishBtn').disabled = !(hostState.name && hostState.location && hostState.country && hostRooms.length > 0 && hostRooms.every(r => r.name && r.price > 0));
}
renderHostRoomEditor();

$('#hPublishBtn').addEventListener('click', async () => {
  $('#hostError').innerHTML = '';
  const payload = {
    name: hostState.name, location: hostState.location, country: hostState.country, type: hostState.type,
    rooms: hostRooms.map(r => ({
      name: r.name, price_cents: Math.round(r.price * 100), capacity: r.capacity,
      tags: r.tags.split(',').map(t => t.trim()).filter(Boolean),
    })),
  };
  const btn = $('#hPublishBtn');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    await api('/stays', { method: 'POST', body: JSON.stringify(payload) });
    toast('Stay published to the live catalogue');
    loadMyProperties(); loadProperties();
  } catch (err) {
    $('#hostError').innerHTML = errBoxHTML(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Publish stay'; renderHostPreview();
  }
});

async function loadMyProperties() {
  try {
    const { properties } = await api('/stays/mine/dashboard');
    $('#myProperties').innerHTML = properties.length ? properties.map(p => `
      <div class="event-card">
        <b>${esc(p.name)}</b>
        <div class="meta">${esc(p.type)} · ${esc(p.location)}${p.country ? ', ' + esc(p.country) : ''} · ${p.bookingsCount} booking${p.bookingsCount !== 1 ? 's' : ''}</div>
        ${p.rooms.map(r => `<div class="hint">${esc(r.name)}: ${fmtKES(r.price_cents)}/night</div>`).join('')}
      </div>`).join('') : '<span class="hint">No stays listed yet.</span>';
  } catch (err) { $('#myProperties').innerHTML = errBoxHTML(err); }
}

/* =========================================================
   BUY TICKETS ("What's on")
   ========================================================= */
let eventsCache = [];
let eventCart = {};

async function loadEvents() {
  try {
    const { events } = await api('/events');
    eventsCache = events;
    $('#eventsList').innerHTML = events.map(e => {
      eventCart[e.id] = eventCart[e.id] || {};
      return `
      <div class="card event-buy-card" data-event="${e.id}">
        <div class="poster" style="${safePosterCSS(e.poster_data_url) || `background:linear-gradient(150deg,#0b6e6e,#123f3f)`}"></div>
        <div>
          <span class="preview-chip">${esc(e.category)}</span>
          <div style="font-family:var(--font-display);font-size:17px;font-weight:600">${esc(e.name)}</div>
          <div class="hint">${esc(e.venue)}${e.city ? ', ' + esc(e.city) : ''} · ${esc(e.event_date)}${e.gate_time ? ' · gates ' + esc(e.gate_time) : ''}</div>
          <div style="margin-top:10px">
            ${e.tiers.map(t => {
              const remaining = t.quantity_total - t.quantity_sold;
              const q = eventCart[e.id][t.id] || 0;
              return `<div class="buy-row" data-tier="${t.id}" data-price="${t.price_cents}" data-remaining="${remaining}">
                <div><div class="name">${esc(t.name)}</div><div class="avail">${fmtKES(t.price_cents)} · ${remaining} left</div></div>
                <div class="stepper"><button class="qm" ${q <= 0 ? 'disabled' : ''}>−</button><span>${q}</span><button class="qp" ${q >= remaining ? 'disabled' : ''}>+</button></div>
              </div>`;
            }).join('') || '<span class="hint">No ticket categories left.</span>'}
          </div>
          <div class="event-buy-foot">
            <b class="event-total" id="total-${e.id}">${fmtKES(0)}</b>
            <select class="text-input" id="pay-${e.id}"><option value="wallet">Motion Pay wallet</option><option value="mpesa">M-Pesa</option><option value="card">Card</option></select>
            <input class="text-input hidden" style="width:150px" id="ref-${e.id}" placeholder="254712345678">
            <button class="btn-primary buy-btn" style="width:auto" data-event="${e.id}">Buy tickets</button>
          </div>
        </div>
      </div>`;
    }).join('') || '<div class="card"><span class="hint">No events published yet — check the Organizer Studio, or come back soon.</span></div>';

    $$('#eventsList select').forEach(sel => sel.addEventListener('change', () => {
      const eventId = sel.id.replace('pay-', '');
      $('#ref-' + eventId).classList.toggle('hidden', sel.value === 'wallet');
    }));
  } catch (err) { $('#eventsList').innerHTML = errBoxHTML(err); }
}

document.addEventListener('click', e => {
  const row = e.target.closest('.buy-row');
  if (row && row.closest('#eventsList') && (e.target.classList.contains('qm') || e.target.classList.contains('qp'))) {
    const card = row.closest('[data-event]');
    const eventId = card.dataset.event;
    const tierId = row.dataset.tier;
    const remaining = +row.dataset.remaining;
    eventCart[eventId][tierId] = eventCart[eventId][tierId] || 0;
    if (e.target.classList.contains('qp') && eventCart[eventId][tierId] < remaining) eventCart[eventId][tierId]++;
    if (e.target.classList.contains('qm') && eventCart[eventId][tierId] > 0) eventCart[eventId][tierId]--;
    row.querySelector('.stepper span').textContent = eventCart[eventId][tierId];
    row.querySelector('.qm').disabled = eventCart[eventId][tierId] <= 0;
    row.querySelector('.qp').disabled = eventCart[eventId][tierId] >= remaining;
    let total = 0;
    card.querySelectorAll('.buy-row').forEach(r => { total += (eventCart[eventId][r.dataset.tier] || 0) * (+r.dataset.price); });
    document.getElementById('total-' + eventId).textContent = fmtKES(total);
  }
  const buyBtn = e.target.closest('.buy-btn');
  if (buyBtn) purchaseTickets(buyBtn.dataset.event, buyBtn);
});

async function purchaseTickets(eventId, btnEl) {
  const items = Object.entries(eventCart[eventId] || {}).filter(([, q]) => q > 0).map(([tierId, quantity]) => ({ tierId, quantity }));
  if (!items.length) return toast('Select at least one ticket', true);
  if (!buyerDetailsValid('ticket')) return toast('Fill in your name, phone, and email above first', true);
  const paymentMethod = document.getElementById('pay-' + eventId).value;
  const payerRef = paymentMethod === 'wallet' ? session.user.id : (document.getElementById('ref-' + eventId).value.trim() || '254712345678');
  const buyer = readBuyerDetails('ticket');
  const event = eventsCache.find(e => e.id === eventId);
  try {
    btnEl.disabled = true; btnEl.innerHTML = '<span class="spinner" style="border-top-color:#0b6e6e"></span>';
    const order = await api('/tickets/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'ticket-' + eventId + '-' + Date.now() },
      body: JSON.stringify({ eventId, items, paymentMethod, payerRef, ...buyer }),
    });
    const tierNames = items.map(it => event.tiers.find(t => t.id === it.tierId)?.name).filter(Boolean).join(', ');
    const dateStr = event.event_date ? new Date(event.event_date + 'T00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : 'DATE TBC';
    saveTicket({
      title: event.name,
      sub: `${dateStr}${event.gate_time ? ' · GATES ' + event.gate_time.toUpperCase() : ''} · ${(event.venue || '').toUpperCase()}`,
      holder: buyer.buyerName, section: tierNames, type: tierNames, paidVia: paymentMethod === 'wallet' ? 'Motion Pay' : paymentMethod.toUpperCase(),
      ticketId: 'MTN-' + order.order.id.slice(-8).toUpperCase(), seed: Math.floor(Math.random() * 9999),
      receiptId: order.receiptId,
    });
    toast('Payment successful — ticket generated in My Tickets');
    eventCart[eventId] = {};
    await refreshWalletPill();
    loadEvents();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btnEl.disabled = false; btnEl.textContent = 'Buy tickets';
  }
}

/* =========================================================
   FLIGHTS — real dated schedule, search, one-way / round-trip
   ========================================================= */
const AIRLINE_COLORS = ['#dd3a24', '#e6262e', '#5b7fc7', '#a8d97a', '#f5e17a'];
let flightRoundTrip = false;
let flightLeg = 'outbound'; // outbound | return
const flightLegs = {
  outbound: { flight: null, seats: [], chosen: new Set() },
  return: { flight: null, seats: [], chosen: new Set() },
};

async function loadAirlines() {
  try {
    const { destinations } = await api('/flights/destinations');
    const opts = destinations.map(d => `<option value="${d}">${d}</option>`).join('');
    $('#flightOrigin').innerHTML = opts;
    $('#flightDestination').innerHTML = opts;
    if (destinations.includes('Nairobi JKIA')) $('#flightOrigin').value = 'Nairobi JKIA';
    if (destinations.includes('Mombasa Moi')) $('#flightDestination').value = 'Mombasa Moi';
    await searchFlights();
  } catch (err) { $('#flightResultsList').innerHTML = errBoxHTML(err); }
}
$('#tripOneWay').addEventListener('click', () => setTripMode(false));
$('#tripRoundTrip').addEventListener('click', () => setTripMode(true));
function setTripMode(roundTrip) {
  flightRoundTrip = roundTrip;
  $('#tripOneWay').classList.toggle('active', !roundTrip);
  $('#tripRoundTrip').classList.toggle('active', roundTrip);
  $('#flightReturnDateField').classList.toggle('hidden', !roundTrip);
}
$('#flightSearchBtn').addEventListener('click', () => { resetFlightSelection(); searchFlights(); });
function resetFlightSelection() {
  flightLeg = 'outbound';
  flightLegs.outbound = { flight: null, seats: [], chosen: new Set() };
  flightLegs.return = { flight: null, seats: [], chosen: new Set() };
  $('#routeBar').classList.add('hidden');
  $('#flightLayout').classList.add('hidden');
  $('#flightStepLabel').classList.add('hidden');
}
async function searchFlights() {
  const origin = $('#flightOrigin').value, destination = $('#flightDestination').value, date = $('#flightDate').value;
  try {
    const { flights } = await api(`/flights?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=${date}`);
    renderFlightResults(flights, 'outbound');
  } catch (err) { $('#flightResultsList').innerHTML = errBoxHTML(err); }
}
async function searchReturnFlights() {
  const origin = $('#flightDestination').value, destination = $('#flightOrigin').value, date = $('#flightReturnDate').value;
  try {
    const { flights } = await api(`/flights?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=${date}`);
    renderFlightResults(flights, 'return');
  } catch (err) { $('#flightResultsList').innerHTML = errBoxHTML(err); }
}
function renderFlightResults(list, legKind) {
  $('#flightStepLabel').classList.toggle('hidden', !flightRoundTrip);
  $('#flightStepLabel').textContent = flightRoundTrip
    ? (legKind === 'outbound' ? 'Step 1 of 2 — choose your outbound flight' : 'Step 2 of 2 — choose your return flight')
    : '';
  if (!list.length) {
    $('#flightResultsList').innerHTML = `<div class="empty-state">No flights match that route and date. Try another date or destination.</div>`;
    return;
  }
  $('#flightResultsList').innerHTML = list.map((f, i) => `
    <button class="trip-result-card" data-id="${f.id}">
      <span class="op-badge" style="background:${AIRLINE_COLORS[i % AIRLINE_COLORS.length]}">${f.airline.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
      <span><span class="rt">${f.departs_at} ${f.origin} → ${addMinutes(f.departs_at, f.duration_minutes)} ${f.destination}</span>
      <span class="sub">${f.airline} ${f.flight_no} · ${f.flight_date} · ${f.duration_minutes} min</span></span>
      <span class="price">${fmtKES(f.economy_fare_cents)}<span>per seat</span></span>
      <span style="font-size:18px;color:var(--motion-teal)">→</span>
    </button>`).join('');
  $('#flightResultsList').onclick = e => {
    const btn = e.target.closest('[data-id]'); if (!btn) return;
    const flight = list.find(f => f.id === btn.dataset.id);
    selectLegFlight(flight, legKind);
  };
}
function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor(total / 60) % 24, mm = total % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
async function selectLegFlight(flight, legKind) {
  flightLeg = legKind;
  flightLegs[legKind].flight = flight;
  flightLegs[legKind].chosen.clear();
  $('#routeBar').classList.remove('hidden');
  $('#flightLayout').classList.remove('hidden');
  $('#routeBar').innerHTML = `
    <div class="leg"><div><div class="city">${flight.origin}</div><div class="sub">DEPARTS ${flight.departs_at}</div></div>
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none"><path d="M1 7h22M17 1l6 6-6 6" stroke="#fffcf7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><div class="city">${flight.destination}</div><div class="sub">ARRIVES ${addMinutes(flight.departs_at, flight.duration_minutes)}</div></div></div>
    <div class="meta">${flight.airline} · ${flight.flight_no}<br>${flight.flight_date} · ${flight.duration_minutes} min</div>`;
  await renderCabin();
  renderFare();
}
async function renderCabin() {
  const leg = flightLegs[flightLeg];
  const { seats } = await api(`/flights/${leg.flight.id}/seats`);
  leg.seats = seats;
  const byRow = {};
  seats.forEach(s => { (byRow[s.row_no] = byRow[s.row_no] || []).push(s); });
  const cols = Math.max(...seats.map(s => s.letter.charCodeAt(0) - 64));
  const aisleAfter = cols > 4 ? 3 : 2;
  let html = '<div class="plane-nose"></div>';
  const rowNums = Object.keys(byRow).sort((a, b) => a - b);
  const businessRows = seats.some(s => s.cabin_class === 'business') ? Math.max(...seats.filter(s => s.cabin_class === 'business').map(s => s.row_no)) : 0;
  rowNums.forEach(r => {
    html += `<div class="seat-row"><span class="rownum">${r}</span>`;
    byRow[r].sort((a, b) => a.letter.localeCompare(b.letter)).forEach((s, ci) => {
      const cls = ['seat', s.status, s.cabin_class];
      if (leg.chosen.has(s.id)) cls[1] = 'selected';
      html += `<div class="${cls.join(' ')}" data-id="${s.id}">${s.letter}</div>`;
      if (ci + 1 === aisleAfter) html += `<div class="seat aisle-gap"></div>`;
    });
    html += `</div>`;
    if (businessRows && +r === businessRows) html += `<div style="height:10px;border-bottom:1px dashed var(--line);margin:4px 30px 10px"></div>`;
  });
  $('#cabin').innerHTML = html;
}
$('#cabin').addEventListener('click', e => {
  const el = e.target.closest('.seat:not(.aisle-gap)'); if (!el) return;
  const leg = flightLegs[flightLeg];
  const seat = leg.seats.find(s => s.id === el.dataset.id);
  if (seat.status === 'booked') {
    el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 300);
    return;
  }
  if (leg.chosen.has(seat.id)) leg.chosen.delete(seat.id);
  else {
    if (leg.chosen.size >= 9) { toast('Maximum 9 seats per booking', true); return; }
    leg.chosen.add(seat.id);
  }
  renderCabin(); renderFare();
});
function renderFare() {
  const out = flightLegs.outbound, ret = flightLegs.return;
  if (!out.flight && !ret.flight) return;
  const legFare = (leg) => {
    const chosen = [...leg.chosen].map(id => leg.seats.find(s => s.id === id));
    const base = chosen.reduce((s, seat) => s + (seat.cabin_class === 'business' ? leg.flight.business_fare_cents : leg.flight.economy_fare_cents), 0);
    return { chosen, base };
  };
  const outFare = out.flight ? legFare(out) : { chosen: [], base: 0 };
  const retFare = ret.flight ? legFare(ret) : { chosen: [], base: 0 };
  const totalSeats = outFare.chosen.length + retFare.chosen.length;
  const base = outFare.base + retFare.base;
  const taxes = totalSeats * 1200 * 100;
  let lines = '';
  if (out.flight) lines += `<div class="fare-line"><span>Outbound (${outFare.chosen.length} seat${outFare.chosen.length !== 1 ? 's' : ''})</span><span>${fmtKES(outFare.base)}</span></div>
    <div class="fare-line"><span>Outbound seats</span><span>${outFare.chosen.map(s => s.row_no + s.letter).join(', ') || '—'}</span></div>`;
  if (flightRoundTrip && ret.flight) lines += `<div class="fare-line"><span>Return (${retFare.chosen.length} seat${retFare.chosen.length !== 1 ? 's' : ''})</span><span>${fmtKES(retFare.base)}</span></div>
    <div class="fare-line"><span>Return seats</span><span>${retFare.chosen.map(s => s.row_no + s.letter).join(', ') || '—'}</span></div>`;
  lines += `<div class="fare-line"><span>Taxes & fees</span><span>${fmtKES(taxes)}</span></div>`;
  $('#fareLines').innerHTML = lines;
  $('#fareTotal').textContent = fmtKES(base + taxes);

  const btn = $('#flightPayBtn');
  const outboundReady = outFare.chosen.length > 0;
  if (flightRoundTrip && flightLeg === 'outbound') {
    btn.disabled = !outboundReady;
    btn.textContent = outboundReady ? 'Continue to return flight →' : 'Select seats to continue';
  } else {
    const ready = flightRoundTrip ? (outboundReady && retFare.chosen.length > 0) : outboundReady;
    btn.disabled = !ready;
    btn.textContent = ready ? `Pay ${fmtKES(base + taxes)} with Motion Pay` : 'Select seats to continue';
  }
}
$('#flightPayMethod').addEventListener('change', () => {
  $('#flightPayerRefField').classList.toggle('hidden', $('#flightPayMethod').value === 'wallet');
});
$('#flightPayBtn').addEventListener('click', async () => {
  if (flightRoundTrip && flightLeg === 'outbound') {
    flightLeg = 'return';
    $('#flightLayout').classList.add('hidden');
    $('#routeBar').classList.add('hidden');
    await searchReturnFlights();
    return;
  }
  if (!buyerDetailsValid('flight')) return toast('Fill in passenger name, phone, and email first', true);
  const paymentMethod = $('#flightPayMethod').value;
  const payerRef = paymentMethod === 'wallet' ? session.user.id : ($('#flightPayerRef').value.trim() || '254712345678');
  const buyer = readBuyerDetails('flight');
  const btn = $('#flightPayBtn');
  const out = flightLegs.outbound, ret = flightLegs.return;
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const body = {
      flightId: out.flight.id, seatIds: [...out.chosen], paymentMethod, payerRef, ...buyer,
    };
    if (flightRoundTrip && ret.flight) { body.returnFlightId = ret.flight.id; body.returnSeatIds = [...ret.chosen]; }
    const order = await api('/flights/checkout', {
      method: 'POST', headers: { 'Idempotency-Key': 'flight-' + Date.now() },
      body: JSON.stringify(body),
    });
    const outChosen = [...out.chosen].map(id => out.seats.find(s => s.id === id));
    const retChosen = flightRoundTrip && ret.flight ? [...ret.chosen].map(id => ret.seats.find(s => s.id === id)) : [];
    saveTicket({
      title: flightRoundTrip && ret.flight ? `${out.flight.origin} ⇄ ${out.flight.destination}` : `${out.flight.origin} → ${out.flight.destination}`,
      sub: `${out.flight.flight_date.toUpperCase()} · ${out.flight.flight_no} · DEPARTS ${out.flight.departs_at}${retChosen.length ? ` · RETURN ${ret.flight.flight_date.toUpperCase()} ${ret.flight.flight_no}` : ''}`,
      holder: buyer.buyerName, section: outChosen.map(s => s.row_no + s.letter).join(', ') + (retChosen.length ? ' / ' + retChosen.map(s => s.row_no + s.letter).join(', ') : ''),
      type: out.flight.airline,
      paidVia: paymentMethod === 'wallet' ? 'Motion Pay' : paymentMethod.toUpperCase(),
      ticketId: 'MTN-' + out.flight.flight_no.replace(' ', '') + '-' + order.order.id.slice(-6).toUpperCase(),
      seed: Math.floor(Math.random() * 9999), receiptId: order.receiptId, kind: 'BOARDING PASS',
    });
    toast(flightRoundTrip ? 'Round-trip booked — boarding passes ready in My Tickets' : 'Flight booked — boarding pass ready in My Tickets');
    resetFlightSelection();
    $('#flightResultsList').innerHTML = '';
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; await refreshWalletPill(); }
});

/* =========================================================
   BUS — real dated departures, single-leg seat map
   ========================================================= */
const BUS_COLORS = ['#0b6e6e', '#dd3a24', '#141414', '#5b7fc7'];
let busTrip = null, busSeats = [], busChosen = new Set();

async function loadBusRoutes() {
  try {
    const { trips } = await api('/bus');
    const cities = [...new Set(trips.flatMap(t => [t.origin, t.destination]))].sort();
    const opts = cities.map(c => `<option value="${c}">${c}</option>`).join('');
    $('#busOrigin').innerHTML = opts;
    $('#busDestination').innerHTML = opts;
    if (cities.includes('Nairobi')) $('#busOrigin').value = 'Nairobi';
    if (cities.includes('Mombasa')) $('#busDestination').value = 'Mombasa';
    await searchBuses();
  } catch (err) { $('#busResultsList').innerHTML = errBoxHTML(err); }
}
$('#busSearchBtn').addEventListener('click', () => { resetBusSelection(); searchBuses(); });
function resetBusSelection() {
  busTrip = null; busChosen.clear();
  $('#busRouteBar').classList.add('hidden');
  $('#busLayout').classList.add('hidden');
}
async function searchBuses() {
  const origin = $('#busOrigin').value, destination = $('#busDestination').value, date = $('#busDate').value;
  try {
    const { trips } = await api(`/bus?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=${date}`);
    renderBusResults(trips);
  } catch (err) { $('#busResultsList').innerHTML = errBoxHTML(err); }
}
function renderBusResults(list) {
  if (!list.length) {
    $('#busResultsList').innerHTML = `<div class="empty-state">No coaches match that route and date. Try another date or destination.</div>`;
    return;
  }
  $('#busResultsList').innerHTML = list.map((t, i) => `
    <button class="trip-result-card" data-id="${t.id}">
      <span class="op-badge" style="background:${BUS_COLORS[i % BUS_COLORS.length]}">${t.operator[0]}</span>
      <span><span class="rt">${t.departs_at} ${t.origin} → ${addMinutes(t.departs_at, t.duration_minutes)} ${t.destination}</span>
      <span class="sub">${t.operator} ${t.coach_no} · ${t.trip_date} · ${t.duration_minutes} min</span></span>
      <span class="price">${fmtKES(t.fare_cents)}<span>per seat</span></span>
      <span style="font-size:18px;color:var(--motion-teal)">→</span>
    </button>`).join('');
  $('#busResultsList').onclick = e => {
    const btn = e.target.closest('[data-id]'); if (!btn) return;
    selectBusTrip(list.find(t => t.id === btn.dataset.id));
  };
}
async function selectBusTrip(trip) {
  busTrip = trip; busChosen.clear();
  $('#busRouteBar').classList.remove('hidden');
  $('#busLayout').classList.remove('hidden');
  $('#busRouteBar').innerHTML = `
    <div class="leg"><div><div class="city">${trip.origin}</div><div class="sub">DEPARTS ${trip.departs_at}</div></div>
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none"><path d="M1 7h22M17 1l6 6-6 6" stroke="#fffcf7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><div class="city">${trip.destination}</div><div class="sub">ARRIVES ${addMinutes(trip.departs_at, trip.duration_minutes)}</div></div></div>
    <div class="meta">${trip.operator} · ${trip.coach_no}<br>${trip.trip_date} · ${trip.duration_minutes} min</div>`;
  await renderBusCabin();
  renderBusFare();
}
async function renderBusCabin() {
  const { seats } = await api(`/bus/${busTrip.id}/seats`);
  busSeats = seats;
  const byRow = {};
  seats.forEach(s => { (byRow[s.row_no] = byRow[s.row_no] || []).push(s); });
  let html = '<div class="plane-nose"></div>';
  Object.keys(byRow).sort((a, b) => a - b).forEach(r => {
    html += `<div class="seat-row"><span class="rownum">${r}</span>`;
    byRow[r].sort((a, b) => a.letter.localeCompare(b.letter)).forEach((s, ci) => {
      const cls = ['seat', s.status];
      if (busChosen.has(s.id)) cls[1] = 'selected';
      html += `<div class="${cls.join(' ')}" data-id="${s.id}">${s.letter}</div>`;
      if (ci === 1) html += `<div class="seat aisle-gap"></div>`;
    });
    html += `</div>`;
  });
  $('#busCabin').innerHTML = html;
}
$('#busCabin').addEventListener('click', e => {
  const el = e.target.closest('.seat:not(.aisle-gap)'); if (!el) return;
  const seat = busSeats.find(s => s.id === el.dataset.id);
  if (seat.status === 'booked') { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 300); return; }
  if (busChosen.has(seat.id)) busChosen.delete(seat.id);
  else { if (busChosen.size >= 9) { toast('Maximum 9 seats per booking', true); return; } busChosen.add(seat.id); }
  renderBusCabin(); renderBusFare();
});
function renderBusFare() {
  if (!busTrip) return;
  const chosen = [...busChosen].map(id => busSeats.find(s => s.id === id));
  const base = chosen.length * busTrip.fare_cents;
  $('#busFareLines').innerHTML = `
    <div class="fare-line"><span>Fare (${chosen.length} seat${chosen.length !== 1 ? 's' : ''})</span><span>${fmtKES(base)}</span></div>
    <div class="fare-line"><span>Seats</span><span>${chosen.map(s => s.row_no + s.letter).join(', ') || '—'}</span></div>`;
  $('#busFareTotal').textContent = fmtKES(base);
  const btn = $('#busPayBtn');
  btn.disabled = chosen.length === 0;
  btn.textContent = chosen.length ? `Pay ${fmtKES(base)} with Motion Pay` : 'Select seats to continue';
}
$('#busPayMethod').addEventListener('change', () => {
  $('#busPayerRefField').classList.toggle('hidden', $('#busPayMethod').value === 'wallet');
});
$('#busPayBtn').addEventListener('click', async () => {
  if (!buyerDetailsValid('bus')) return toast('Fill in passenger name, phone, and email first', true);
  const paymentMethod = $('#busPayMethod').value;
  const payerRef = paymentMethod === 'wallet' ? session.user.id : ($('#busPayerRef').value.trim() || '254712345678');
  const buyer = readBuyerDetails('bus');
  const btn = $('#busPayBtn');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const chosen = [...busChosen].map(id => busSeats.find(s => s.id === id));
    const order = await api('/bus/checkout', {
      method: 'POST', headers: { 'Idempotency-Key': 'bus-' + Date.now() },
      body: JSON.stringify({ tripId: busTrip.id, seatIds: [...busChosen], paymentMethod, payerRef, ...buyer }),
    });
    saveTicket({
      title: `${busTrip.origin} → ${busTrip.destination}`,
      sub: `${busTrip.trip_date.toUpperCase()} · ${busTrip.operator} ${busTrip.coach_no} · DEPARTS ${busTrip.departs_at}`,
      holder: buyer.buyerName, section: chosen.map(s => s.row_no + s.letter).join(', '), type: busTrip.operator,
      paidVia: paymentMethod === 'wallet' ? 'Motion Pay' : paymentMethod.toUpperCase(),
      ticketId: 'MTN-' + busTrip.coach_no.replace(/\s/g, '') + '-' + order.order.id.slice(-6).toUpperCase(),
      seed: Math.floor(Math.random() * 9999), receiptId: order.receiptId, kind: 'BUS TICKET',
    });
    toast('Bus booked — ticket ready in My Tickets');
    resetBusSelection(); $('#busResultsList').innerHTML = '';
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; await refreshWalletPill(); }
});

/* =========================================================
   SGR — real dated departures, First Class / Economy seat map
   ========================================================= */
let sgrTrip = null, sgrSeats = [], sgrChosen = new Set();

async function loadSgrRoutes() {
  try {
    const { trips } = await api('/sgr');
    const cities = [...new Set(trips.flatMap(t => [t.origin, t.destination]))].sort();
    const opts = cities.map(c => `<option value="${c}">${c}</option>`).join('');
    $('#sgrOrigin').innerHTML = opts;
    $('#sgrDestination').innerHTML = opts;
    if (cities.includes('Nairobi Terminus')) $('#sgrOrigin').value = 'Nairobi Terminus';
    if (cities.includes('Mombasa Terminus')) $('#sgrDestination').value = 'Mombasa Terminus';
    await searchSgr();
  } catch (err) { $('#sgrResultsList').innerHTML = errBoxHTML(err); }
}
$('#sgrSearchBtn').addEventListener('click', () => { resetSgrSelection(); searchSgr(); });
function resetSgrSelection() {
  sgrTrip = null; sgrChosen.clear();
  $('#sgrRouteBar').classList.add('hidden');
  $('#sgrLayout').classList.add('hidden');
}
async function searchSgr() {
  const origin = $('#sgrOrigin').value, destination = $('#sgrDestination').value, date = $('#sgrDate').value;
  try {
    const { trips } = await api(`/sgr?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&date=${date}`);
    renderSgrResults(trips);
  } catch (err) { $('#sgrResultsList').innerHTML = errBoxHTML(err); }
}
function renderSgrResults(list) {
  if (!list.length) {
    $('#sgrResultsList').innerHTML = `<div class="empty-state">No trains match that route and date. Try another date or destination.</div>`;
    return;
  }
  $('#sgrResultsList').innerHTML = list.map((t) => `
    <button class="trip-result-card" data-id="${t.id}">
      <span class="op-badge" style="background:#0b6e6e">${t.train_no.replace(/\D/g, '') || 'ME'}</span>
      <span><span class="rt">${t.departs_at} ${t.origin} → ${addMinutes(t.departs_at, t.duration_minutes)} ${t.destination}</span>
      <span class="sub">${t.train_no} · ${t.trip_date} · ${t.duration_minutes} min</span></span>
      <span class="price">${fmtKES(t.economy_fare_cents)}<span>economy · per seat</span></span>
      <span style="font-size:18px;color:var(--motion-teal)">→</span>
    </button>`).join('');
  $('#sgrResultsList').onclick = e => {
    const btn = e.target.closest('[data-id]'); if (!btn) return;
    selectSgrTrip(list.find(t => t.id === btn.dataset.id));
  };
}
async function selectSgrTrip(trip) {
  sgrTrip = trip; sgrChosen.clear();
  $('#sgrRouteBar').classList.remove('hidden');
  $('#sgrLayout').classList.remove('hidden');
  $('#sgrRouteBar').innerHTML = `
    <div class="leg"><div><div class="city">${trip.origin}</div><div class="sub">DEPARTS ${trip.departs_at}</div></div>
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none"><path d="M1 7h22M17 1l6 6-6 6" stroke="#fffcf7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><div class="city">${trip.destination}</div><div class="sub">ARRIVES ${addMinutes(trip.departs_at, trip.duration_minutes)}</div></div></div>
    <div class="meta">${trip.train_no}<br>${trip.trip_date} · ${trip.duration_minutes} min</div>`;
  await renderSgrCabin();
  renderSgrFare();
}
async function renderSgrCabin() {
  const { seats } = await api(`/sgr/${sgrTrip.id}/seats`);
  sgrSeats = seats;
  const byRow = {};
  seats.forEach(s => { (byRow[s.row_no] = byRow[s.row_no] || []).push(s); });
  const businessRows = seats.some(s => s.cabin_class === 'business') ? Math.max(...seats.filter(s => s.cabin_class === 'business').map(s => s.row_no)) : 0;
  let html = '<div class="plane-nose"></div>';
  Object.keys(byRow).sort((a, b) => a - b).forEach(r => {
    html += `<div class="seat-row"><span class="rownum">${r}</span>`;
    byRow[r].sort((a, b) => a.letter.localeCompare(b.letter)).forEach((s, ci) => {
      const cls = ['seat', s.status, s.cabin_class];
      if (sgrChosen.has(s.id)) cls[1] = 'selected';
      html += `<div class="${cls.join(' ')}" data-id="${s.id}">${s.letter}</div>`;
      if (ci === 2) html += `<div class="seat aisle-gap"></div>`;
    });
    html += `</div>`;
    if (businessRows && +r === businessRows) html += `<div style="height:10px;border-bottom:1px dashed var(--line);margin:4px 30px 10px"></div>`;
  });
  $('#sgrCabin').innerHTML = html;
}
$('#sgrCabin').addEventListener('click', e => {
  const el = e.target.closest('.seat:not(.aisle-gap)'); if (!el) return;
  const seat = sgrSeats.find(s => s.id === el.dataset.id);
  if (seat.status === 'booked') { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 300); return; }
  if (sgrChosen.has(seat.id)) sgrChosen.delete(seat.id);
  else { if (sgrChosen.size >= 9) { toast('Maximum 9 seats per booking', true); return; } sgrChosen.add(seat.id); }
  renderSgrCabin(); renderSgrFare();
});
function renderSgrFare() {
  if (!sgrTrip) return;
  const chosen = [...sgrChosen].map(id => sgrSeats.find(s => s.id === id));
  const base = chosen.reduce((s, seat) => s + (seat.cabin_class === 'business' ? sgrTrip.first_class_fare_cents : sgrTrip.economy_fare_cents), 0);
  $('#sgrFareLines').innerHTML = `
    <div class="fare-line"><span>Fare (${chosen.length} seat${chosen.length !== 1 ? 's' : ''})</span><span>${fmtKES(base)}</span></div>
    <div class="fare-line"><span>Seats</span><span>${chosen.map(s => s.row_no + s.letter).join(', ') || '—'}</span></div>`;
  $('#sgrFareTotal').textContent = fmtKES(base);
  const btn = $('#sgrPayBtn');
  btn.disabled = chosen.length === 0;
  btn.textContent = chosen.length ? `Pay ${fmtKES(base)} with Motion Pay` : 'Select seats to continue';
}
$('#sgrPayMethod').addEventListener('change', () => {
  $('#sgrPayerRefField').classList.toggle('hidden', $('#sgrPayMethod').value === 'wallet');
});
$('#sgrPayBtn').addEventListener('click', async () => {
  if (!buyerDetailsValid('sgr')) return toast('Fill in passenger name, phone, and email first', true);
  const paymentMethod = $('#sgrPayMethod').value;
  const payerRef = paymentMethod === 'wallet' ? session.user.id : ($('#sgrPayerRef').value.trim() || '254712345678');
  const buyer = readBuyerDetails('sgr');
  const btn = $('#sgrPayBtn');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const chosen = [...sgrChosen].map(id => sgrSeats.find(s => s.id === id));
    const order = await api('/sgr/checkout', {
      method: 'POST', headers: { 'Idempotency-Key': 'sgr-' + Date.now() },
      body: JSON.stringify({ tripId: sgrTrip.id, seatIds: [...sgrChosen], paymentMethod, payerRef, ...buyer }),
    });
    saveTicket({
      title: `${sgrTrip.origin} → ${sgrTrip.destination}`,
      sub: `${sgrTrip.trip_date.toUpperCase()} · ${sgrTrip.train_no} · DEPARTS ${sgrTrip.departs_at}`,
      holder: buyer.buyerName, section: chosen.map(s => s.row_no + s.letter).join(', '), type: 'Kenya Railways',
      paidVia: paymentMethod === 'wallet' ? 'Motion Pay' : paymentMethod.toUpperCase(),
      ticketId: 'MTN-' + sgrTrip.train_no.replace(/\s/g, '') + '-' + order.order.id.slice(-6).toUpperCase(),
      seed: Math.floor(Math.random() * 9999), receiptId: order.receiptId, kind: 'SGR TICKET',
    });
    toast('SGR ticket booked — ready in My Tickets');
    resetSgrSelection(); $('#sgrResultsList').innerHTML = '';
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; await refreshWalletPill(); }
});

/* =========================================================
   STAYS
   ========================================================= */
let properties = [], filteredProperties = [], selectedPropertyIdx = 0, selectedRoom = null;
let stayCountryFilterValue = '', stayTypeFilterValue = '';

async function loadProperties() {
  try {
    const { properties: props } = await api('/stays');
    properties = props;
    renderStayFilters();
    applyStayFilters();
  } catch (err) { $('#propertyStrip').innerHTML = errBoxHTML(err); }
}
function renderStayFilters() {
  const countries = [...new Set(properties.map(p => p.country).filter(Boolean))].sort();
  $('#stayCountryFilter').innerHTML = '<option value="">All countries</option>' + countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const types = [...new Set(properties.map(p => p.type).filter(Boolean))].sort();
  $('#stayTypeChips').innerHTML = ['<button class="stay-type-chip active" data-type="">All types</button>']
    .concat(types.map(t => `<button class="stay-type-chip" data-type="${esc(t)}">${esc(t)}</button>`)).join('');
}
$('#stayCountryFilter').addEventListener('change', () => {
  stayCountryFilterValue = $('#stayCountryFilter').value;
  applyStayFilters();
});
$('#stayTypeChips').addEventListener('click', e => {
  const btn = e.target.closest('.stay-type-chip'); if (!btn) return;
  stayTypeFilterValue = btn.dataset.type;
  $$('#stayTypeChips .stay-type-chip').forEach(b => b.classList.toggle('active', b === btn));
  applyStayFilters();
});
function applyStayFilters() {
  filteredProperties = properties.filter(p =>
    (!stayCountryFilterValue || p.country === stayCountryFilterValue) &&
    (!stayTypeFilterValue || p.type === stayTypeFilterValue)
  );
  selectedPropertyIdx = 0; selectedRoom = null;
  renderPropertyStrip(); renderRooms(); computeStayTotal();
}
function renderPropertyStrip() {
  $('#propertyStrip').innerHTML = filteredProperties.map((p, i) => `
    <div class="property-card ${i === selectedPropertyIdx ? 'active' : ''}" data-i="${i}">
      <div class="art" style="background:linear-gradient(150deg,${AIRLINE_COLORS[i % AIRLINE_COLORS.length]},#14181a)"><span class="type-pill">${esc(p.type || 'Stay')}</span></div>
      <div class="info"><b>${esc(p.name)}</b><span>${esc(p.location)}${p.country ? ', ' + esc(p.country) : ''}</span></div>
    </div>`).join('') || '<span class="hint">No properties match those filters.</span>';
  $('#propertyStripCount').textContent = `${filteredProperties.length} of ${properties.length} properties`;
}
$('#propertyStrip').addEventListener('click', e => {
  const card = e.target.closest('.property-card'); if (!card) return;
  selectedPropertyIdx = +card.dataset.i; selectedRoom = null;
  renderPropertyStrip(); renderRooms(); computeStayTotal();
});
function renderRooms() {
  const p = filteredProperties[selectedPropertyIdx];
  if (!p) { $('#roomList').innerHTML = '<h3>Available rooms</h3><span class="hint">Select a property above.</span>'; return; }
  $('#roomList').innerHTML = '<h3>Available rooms — ' + esc(p.name) + '</h3>' + p.rooms.map((r, i) => `
    <div class="room-card ${selectedRoom === i ? 'selected' : ''}" data-i="${i}">
      <div class="room-thumb" style="background:linear-gradient(150deg,#0b6e6e,#f3ede0)"></div>
      <div class="room-info">
        <b>${r.name}</b>
        <span style="font-size:11px;color:var(--ink-soft);font-family:var(--font-mono)">Sleeps ${r.capacity}</span>
        <div class="tags">${r.tags.map(t => `<span>${t}</span>`).join('')}</div>
      </div>
      <div class="room-price">
        <div class="amt">${fmtKES(r.price_cents)}</div>
        <div class="per">per night</div>
        <button class="room-select-btn">${selectedRoom === i ? 'Selected' : 'Select room'}</button>
      </div>
    </div>`).join('');
}
$('#roomList').addEventListener('click', e => {
  const card = e.target.closest('.room-card'); if (!card) return;
  selectedRoom = +card.dataset.i; renderRooms(); computeStayTotal();
});
function nights() {
  const inD = new Date($('#checkinDate').value), outD = new Date($('#checkoutDate').value);
  const diff = Math.round((outD - inD) / 86400000);
  return diff > 0 ? diff : 0;
}
function computeStayTotal() {
  const n = nights(); $('#nightsLabel').textContent = n + ' night' + (n !== 1 ? 's' : '');
  const prop = filteredProperties[selectedPropertyIdx];
  const room = (prop && selectedRoom !== null) ? prop.rooms[selectedRoom] : null;
  $('#selectedRoomLabel').textContent = room ? room.name : 'No room selected';
  const subtotal = room ? room.price_cents * n : 0;
  const fee = subtotal ? Math.round(subtotal * 0.08) : 0;
  $('#stayRoomTotal').textContent = fmtKES(subtotal);
  $('#stayFee').textContent = fmtKES(fee);
  $('#stayTotal').textContent = fmtKES(subtotal + fee);
  const btn = $('#stayPayBtn'); const ready = room && n > 0;
  btn.disabled = !ready;
  btn.textContent = ready ? `Pay ${fmtKES(subtotal + fee)} with Motion Pay` : (n <= 0 ? 'Choose valid dates' : 'Select a room to continue');
}
$('#checkinDate').addEventListener('change', computeStayTotal);
$('#checkoutDate').addEventListener('change', computeStayTotal);
$('#guestPlus').addEventListener('click', () => { $('#guestCount').textContent = +$('#guestCount').textContent + 1; });
$('#guestMinus').addEventListener('click', () => { const v = +$('#guestCount').textContent; if (v > 1) $('#guestCount').textContent = v - 1; });
$('#stayPayMethod').addEventListener('change', () => {
  $('#stayPayerRefField').classList.toggle('hidden', $('#stayPayMethod').value === 'wallet');
});
(function initDates() {
  const d1 = new Date(); d1.setDate(d1.getDate() + 7);
  const d2 = new Date(); d2.setDate(d2.getDate() + 9);
  $('#checkinDate').value = d1.toISOString().slice(0, 10);
  $('#checkoutDate').value = d2.toISOString().slice(0, 10);
})();

$('#stayPayBtn').addEventListener('click', async () => {
  if (!buyerDetailsValid('stay')) return toast('Fill in guest name, phone, and email first', true);
  const p = filteredProperties[selectedPropertyIdx]; const room = p.rooms[selectedRoom];
  const paymentMethod = $('#stayPayMethod').value;
  const payerRef = paymentMethod === 'wallet' ? session.user.id : ($('#stayPayerRef').value.trim() || '254712345678');
  const buyer = readBuyerDetails('stay');
  const n = nights();
  const btn = $('#stayPayBtn');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const order = await api('/stays/checkout', {
      method: 'POST', headers: { 'Idempotency-Key': 'stay-' + Date.now() },
      body: JSON.stringify({ roomId: room.id, checkin: $('#checkinDate').value, checkout: $('#checkoutDate').value, guests: +$('#guestCount').textContent, paymentMethod, payerRef, ...buyer }),
    });
    saveTicket({
      title: p.name + ' — ' + room.name,
      sub: `${$('#checkinDate').value} → ${$('#checkoutDate').value} · ${n} NIGHT${n !== 1 ? 'S' : ''} · ${$('#guestCount').textContent} GUEST${+$('#guestCount').textContent !== 1 ? 'S' : ''}`,
      holder: buyer.buyerName, section: room.name, type: 'Accommodation voucher',
      paidVia: paymentMethod === 'wallet' ? 'Motion Pay' : paymentMethod.toUpperCase(),
      ticketId: 'MTN-STAY-' + order.order.id.slice(-8).toUpperCase(), seed: Math.floor(Math.random() * 9999),
      receiptId: order.receiptId, kind: 'STAY VOUCHER',
    });
    toast('Stay booked — voucher ready in My Tickets');
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; await refreshWalletPill(); computeStayTotal(); }
});

/* =========================================================
   WALLET PANEL
   ========================================================= */
$('#topupBtn').addEventListener('click', async () => {
  const btn = $('#topupBtn');
  try {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    await api('/wallet/topup', { method: 'POST', body: JSON.stringify({ amountKES: +$('#topupAmount').value, method: $('#topupMethod').value, payerRef: $('#topupRef').value || '254700000000' }) });
    toast('Top-up successful'); await refreshWalletPill(); loadWallet();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Top up Motion Pay'; }
});
async function loadWallet() {
  try {
    const w = await api('/wallet');
    $('#walletHeroBalance').textContent = fmtKES(w.balanceCents);
    $('#walletHistory').innerHTML = w.history.length ? w.history.map(t => `
      <div class="doc-row"><div><b>${esc(t.type)}</b><div class="meta">${esc(t.created_at)} · ${esc(t.reference || '')}</div></div><b style="color:${t.amount_cents < 0 ? '#a12e1c' : '#0b6e6e'}">${t.amount_cents < 0 ? '-' : '+'}${fmtKES(Math.abs(t.amount_cents))}</b></div>`).join('') : '<span class="hint">No transactions yet.</span>';
  } catch (err) { $('#walletHistory').innerHTML = errBoxHTML(err); }
}

/* =========================================================
   MY TICKETS (client-side history of generated passes)
   ========================================================= */
function ticketStoreKey() { return 'motion_tickets_' + (session.user ? session.user.id : 'anon'); }
function saveTicket(data) {
  const list = JSON.parse(localStorage.getItem(ticketStoreKey()) || '[]');
  list.unshift({ ...data, createdAt: Date.now() });
  localStorage.setItem(ticketStoreKey(), JSON.stringify(list.slice(0, 50)));
}
function renderMyTickets() {
  const list = JSON.parse(localStorage.getItem(ticketStoreKey()) || '[]');
  const wrap = $('#myTicketsWrap');
  if (!list.length) {
    wrap.innerHTML = `<div class="ticket-empty">No tickets yet on this device — <a data-goto="buy">buy a ticket</a>, <a data-goto="flight">book a flight</a>, or <a data-goto="stay">book a stay</a> to generate one.</div>`;
    wrap.querySelectorAll('a[data-goto]').forEach(a => a.addEventListener('click', () => {
      const target = document.querySelector(`#mainTabs button[data-panel="${a.dataset.goto}"]`);
      if (target) target.click();
    }));
    return;
  }
  wrap.innerHTML = list.map((_, i) => `<div class="ticket-wrap" id="ticket-slot-${i}"></div>`).join('');
  list.forEach((data, i) => mountTicketInto($('#ticket-slot-' + i), data, { receiptId: data.receiptId }));
}

/* =========================================================
   ADMIN — REVENUE ENGINE
   ========================================================= */
async function loadRules() {
  try {
    const { rules } = await api('/revenue/rules');
    $('#ruleList').innerHTML = rules.map(r => `
      <div class="rule-row" data-key="${r.rule_key}">
        <span>${r.label}</span>
        <input class="text-input rule-rate" type="number" step="0.5" value="${r.rate_percent}">
        <input class="text-input rule-flat" type="number" value="${(r.flat_fee_cents / 100).toFixed(0)}">
        <label style="display:flex;align-items:center;gap:6px"><input class="rule-active" type="checkbox" ${r.active ? 'checked' : ''}> <span class="hint">on</span></label>
      </div>`).join('') + `<button class="btn-ghost" id="saveRulesBtn" style="margin-top:12px">Save changes</button>`;
    $('#saveRulesBtn').addEventListener('click', saveRules);
  } catch (err) { $('#ruleList').innerHTML = errBoxHTML(err); }
}
async function saveRules() {
  const rows = $$('#ruleList .rule-row');
  try {
    for (const row of rows) {
      const key = row.dataset.key;
      const rate_percent = +row.querySelector('.rule-rate').value;
      const flat_fee_cents = Math.round(+row.querySelector('.rule-flat').value * 100);
      const active = row.querySelector('.rule-active').checked;
      await api(`/revenue/rules/${key}`, { method: 'PATCH', body: JSON.stringify({ rate_percent, flat_fee_cents, active }) });
    }
    toast('Commission rules updated — effective on the next order');
    loadSummary();
  } catch (err) { toast(err.message, true); }
}
async function loadSummary() {
  try {
    const s = await api('/revenue/summary');
    $('#revenueSummary').innerHTML = (s.byLine.length ? s.byLine.map(l => `
      <div class="doc-row"><span>${l.rule_key} <span class="hint">(${l.transactions} txns)</span></span><b>${fmtKES(l.total_cents)}</b></div>`).join('') : '<span class="hint">No revenue recorded yet.</span>')
      + `<div class="doc-row" style="border-top:2px solid var(--ink);margin-top:8px;padding-top:12px"><b>Total platform revenue</b><b>${fmtKES(s.totalCents)}</b></div>`;
  } catch (err) { $('#revenueSummary').innerHTML = errBoxHTML(err); }
}

/* =========================================================
   BOOT
   ========================================================= */
if (session.token && session.user) { bootApp(); }
