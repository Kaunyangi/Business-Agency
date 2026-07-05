/* =====================================================
   MOTION APP — state, data, and render engine
   Efficiency notes: views render on demand only; event
   delegation on stable containers; DOM writes batched
   via innerHTML templates; no polling, no timers.
===================================================== */
const fmt = n => 'KES ' + n.toLocaleString('en-KE');
const $ = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const uid = p => p + '-' + Math.random().toString(36).slice(2,7).toUpperCase();

const state = {
  balance: 185000,
  view: 'home',
  wallet: [],            // every independent purchased ticket lives here
  sel: {},               // transient selections per flow
  events: [
    {id:'ev1', title:'RHYTHM OF THE CITY 2026', venue:'Uhuru Gardens', city:'Nairobi', date:'2026-11-14', time:'2:00 PM',
     poster:'linear-gradient(160deg,#1a1a1a 0%,#43213c 45%,#DC3A21 100%)', tag:'Festival', organizer:'Motion Experiences',
     cats:[{n:'Early Bird', p:2500, q:0, note:'Sold in phase 1', left:0},{n:'General Admission', p:3500, q:0, left:420},{n:'VIP', p:8500, q:0, left:64},{n:'VVIP Cabana (4 pax)', p:45000, q:0, left:6}]},
    {id:'ev2', title:'SOL FEST — SAUTI SOL & FRIENDS', venue:'Carnivore Grounds', city:'Nairobi', date:'2026-08-22', time:'4:00 PM',
     poster:'linear-gradient(155deg,#F7E874 0%,#e88f3a 50%,#141414 100%)', tag:'Concert', organizer:'Sol Generation',
     cats:[{n:'Regular', p:2000, q:0, left:800},{n:'VIP', p:5000, q:0, left:120},{n:'Golden Circle', p:12000, q:0, left:18}]},
    {id:'ev3', title:'BLANKETS & WINE Nº 92', venue:'Loresho Gardens', city:'Nairobi', date:'2026-07-19', time:'12:00 PM',
     poster:'linear-gradient(150deg,#6C8FD6 0%,#8fd0d6 55%,#B5DF8B 100%)', tag:'Picnic', organizer:'B&W Collective',
     cats:[{n:'Advance', p:3000, q:0, left:260},{n:'Group of 4', p:10500, q:0, left:40},{n:'VIP Lounge', p:7000, q:0, left:32}]},
    {id:'ev4', title:'MOMBASA ROOFTOP SUNDOWNER', venue:'Tapas Cielo', city:'Mombasa', date:'2026-07-25', time:'5:30 PM',
     poster:'linear-gradient(160deg,#0C7378 0%,#0f5c4a 60%,#B5DF8B 100%)', tag:'Nightlife', organizer:'Coast Social Club',
     cats:[{n:'Entry', p:1500, q:0, left:150},{n:'Table of 6 + bottle', p:15000, q:0, left:9}]},
  ],
  flights: [
    {id:'f1', op:'Jambojet', code:'JM 8402', col:'#DC3A21', from:'Nairobi (JKIA)', to:'Mombasa (MBA)', dep:'07:10', arr:'08:10', dur:'1h 00m', price:6200, craft:'Dash 8-Q400', layout:[2,2], rows:19, prem:2},
    {id:'f2', op:'Kenya Airways', code:'KQ 604', col:'#B5122E', from:'Nairobi (JKIA)', to:'Mombasa (MBA)', dep:'09:45', arr:'10:45', dur:'1h 00m', price:11800, craft:'Boeing 737-800', layout:[3,3], rows:16, prem:3},
    {id:'f3', op:'Safarilink', code:'SLK 052', col:'#0C7378', from:'Nairobi (Wilson)', to:'Diani (Ukunda)', dep:'08:30', arr:'09:45', dur:'1h 15m', price:14500, craft:'Dash 8-100', layout:[2,2], rows:10, prem:2},
    {id:'f4', op:'Jambojet', code:'JM 8620', col:'#DC3A21', from:'Nairobi (JKIA)', to:'Diani (Ukunda)', dep:'11:20', arr:'12:35', dur:'1h 15m', price:9800, craft:'Dash 8-Q400', layout:[2,2], rows:19, prem:2},
    {id:'f5', op:'Safarilink', code:'SLK 071', col:'#0C7378', from:'Nairobi (Wilson)', to:'Lamu (Manda)', dep:'10:00', arr:'11:25', dur:'1h 25m', price:16900, craft:'Cessna Caravan', layout:[1,2], rows:8, prem:1},
    {id:'f6', op:'Jambojet', code:'JM 8710', col:'#DC3A21', from:'Nairobi (JKIA)', to:'Kisumu (KIS)', dep:'06:40', arr:'07:35', dur:'0h 55m', price:5400, craft:'Dash 8-Q400', layout:[2,2], rows:19, prem:2},
    {id:'f7', op:'Kenya Airways', code:'KQ 656', col:'#B5122E', from:'Nairobi (JKIA)', to:'Kisumu (KIS)', dep:'17:15', arr:'18:10', dur:'0h 55m', price:9200, craft:'Embraer E190', layout:[2,2], rows:16, prem:3},
    {id:'f8', op:'Safarilink', code:'SLK 034', col:'#0C7378', from:'Nairobi (Wilson)', to:'Malindi (MYD)', dep:'12:15', arr:'13:35', dur:'1h 20m', price:15200, craft:'Dash 8-100', layout:[2,2], rows:10, prem:2},
    {id:'f9', op:'Skyward Express', code:'SEK 210', col:'#6C8FD6', from:'Nairobi (Wilson)', to:'Samburu (UAS)', dep:'09:15', arr:'10:20', dur:'1h 05m', price:13600, craft:'Dash 8-100', layout:[2,2], rows:9, prem:1},
  ],
  sgr: [
    {id:'s1', name:'Madaraka Express — Morning', from:'Nairobi Terminus', to:'Mombasa Terminus', dep:'08:00', arr:'13:02', dur:'5h 02m', stops:'Non-stop express',
     classes:[{n:'First Class', p:4500, left:38},{n:'Economy', p:1500, left:412}]},
    {id:'s2', name:'Madaraka Express — Afternoon (Inter-county)', from:'Nairobi Terminus', to:'Mombasa Terminus', dep:'14:35', arr:'20:19', dur:'5h 44m', stops:'Athi River · Emali · Kibwezi · Mtito Andei · Voi · Miasenyi · Mariakani',
     classes:[{n:'First Class', p:4500, left:12},{n:'Economy', p:1500, left:288}]},
    {id:'s3', name:'Madaraka Express — Morning (Up train)', from:'Mombasa Terminus', to:'Nairobi Terminus', dep:'08:00', arr:'13:02', dur:'5h 02m', stops:'Non-stop express',
     classes:[{n:'First Class', p:4500, left:22},{n:'Economy', p:1500, left:365}]},
  ],
  buses: [
    {id:'b1', op:'Tahmeed', col:'#0C7378', from:'Nairobi', to:'Mombasa', dep:'21:00', arr:'06:00 +1', dur:'9h', price:1800, cls:'VIP Sleeper-ish recliner', tags:['AC','USB charging','Night coach'], layout:[2,2], rows:11},
    {id:'b2', op:'Mash Poa', col:'#DC3A21', from:'Nairobi', to:'Mombasa', dep:'09:30', arr:'18:00', dur:'8h 30m', price:1600, cls:'Business', tags:['AC','Snack','Day coach'], layout:[2,2], rows:11},
    {id:'b3', op:'Dreamline', col:'#141414', from:'Nairobi', to:'Mombasa', dep:'22:30', arr:'06:30 +1', dur:'8h', price:2400, cls:'Luxury 1st Class', tags:['AC','Reclining 2x1','WiFi'], layout:[2,1], rows:10},
    {id:'b4', op:'Buscar', col:'#6C8FD6', from:'Nairobi', to:'Kisumu', dep:'10:00', arr:'16:30', dur:'6h 30m', price:1400, cls:'Executive', tags:['AC','USB charging'], layout:[2,2], rows:11},
    {id:'b5', op:'Tahmeed', col:'#0C7378', from:'Mombasa', to:'Dar es Salaam', dep:'07:00', arr:'17:30', dur:'10h 30m', price:2800, cls:'Cross-border VIP', tags:['Border assist','AC'], layout:[2,2], rows:11},
    {id:'b6', op:'Mash Poa', col:'#DC3A21', from:'Nairobi', to:'Kampala', dep:'19:00', arr:'07:30 +1', dur:'12h 30m', price:3200, cls:'Cross-border Business', tags:['Night coach','Border assist'], layout:[2,2], rows:11},
    {id:'b7', op:'Dreamline', col:'#141414', from:'Nairobi', to:'Malindi', dep:'20:30', arr:'06:00 +1', dur:'9h 30m', price:2600, cls:'Luxury 2x1', tags:['Reclining','WiFi'], layout:[2,1], rows:10},
    {id:'b8', op:'Buscar', col:'#6C8FD6', from:'Nairobi', to:'Kigali', dep:'17:00', arr:'11:00 +1', dur:'18h', price:4500, cls:'Cross-border Executive', tags:['Border assist','2 drivers'], layout:[2,2], rows:11},
    {id:'b9', op:'Tahmeed', col:'#0C7378', from:'Nairobi', to:'Voi', dep:'08:00', arr:'13:30', dur:'5h 30m', price:1100, cls:'Business', tags:['AC'], layout:[2,2], rows:11},
  ],
  stays: [
    {id:'st1', dest:'Diani', name:'Almanara Luxury Resort', type:'Resort', vis:'linear-gradient(150deg,#6C8FD6,#8fd0d6 55%,#F7E874)', rating:4.9, from:24500, amen:['Beachfront','Pool','Chef'],
     rooms:[{n:'Garden Suite', d:'King bed · Garden view · B&B', p:24500, left:3},{n:'Ocean Villa', d:'2BR · Private plunge pool', p:52000, left:2},{n:'Penthouse Sky Villa', d:'3BR · Rooftop terrace', p:88000, left:1}]},
    {id:'st2', dest:'Diani', name:'Tribe & Tide Airbnb Loft', type:'Airbnb', vis:'linear-gradient(150deg,#B5DF8B,#0C7378)', rating:4.8, from:7800, amen:['Self check-in','WiFi','Kitchen'],
     rooms:[{n:'Entire Loft', d:'1BR · 2 guests · 200m to beach', p:7800, left:4},{n:'Loft + Rooftop', d:'1BR · rooftop lounge access', p:9500, left:2}]},
    {id:'st3', dest:'Lamu', name:'Forodhani Swahili House', type:'Villa', vis:'linear-gradient(150deg,#F7E874,#e88f3a 55%,#141414)', rating:4.9, from:18500, amen:['Rooftop majlis','Chef','Dhow trips'],
     rooms:[{n:'Baraza Room', d:'Queen · Courtyard view', p:18500, left:2},{n:'Whole House (sleeps 8)', d:'4BR · staff included', p:65000, left:1}]},
    {id:'st4', dest:'Naivasha', name:'Kiboko Lakefront Cabins', type:'Resort', vis:'linear-gradient(150deg,#0C7378,#0f5c4a 60%,#B5DF8B)', rating:4.7, from:12500, amen:['Lake view','Bonfire','Boat rides'],
     rooms:[{n:'Lake Cabin', d:'Double · deck over papyrus', p:12500, left:5},{n:'Family Cabin', d:'2BR · sleeps 5', p:21000, left:3}]},
    {id:'st5', dest:'Kisumu', name:'Dunga Hill Airbnb Suites', type:'Airbnb', vis:'linear-gradient(150deg,#DC3A21,#a03a72 55%,#6C8FD6)', rating:4.6, from:5600, amen:['Self check-in','Lake sunset','Parking'],
     rooms:[{n:'Studio Suite', d:'2 guests · sunset balcony', p:5600, left:6},{n:'1BR Executive', d:'Work desk · fast WiFi', p:8200, left:4}]},
    {id:'st6', dest:'Samburu', name:'Saruni Ndoto Tented Camp', type:'Resort', vis:'linear-gradient(150deg,#e88f3a,#43213c)', rating:4.9, from:38000, amen:['Full board','Game drives','Guide'],
     rooms:[{n:'Classic Tent', d:'Full board · 2 game drives', p:38000, left:4},{n:'Riverside Suite Tent', d:'Full board · private deck', p:56000, left:2}]},
    {id:'st7', dest:'Voi', name:'Red Elephant Safari Lodge', type:'Villa', vis:'linear-gradient(150deg,#DC3A21,#141414)', rating:4.5, from:9800, amen:['Tsavo gate 10min','Pool','Half board'],
     rooms:[{n:'Savannah Banda', d:'Double · half board', p:9800, left:7},{n:'Family Banda', d:'Triple · half board', p:14500, left:3}]},
    {id:'st8', dest:'Malindi', name:'Che Shale Beach Bandas', type:'Airbnb', vis:'linear-gradient(150deg,#F7E874,#0C7378)', rating:4.8, from:11200, amen:['Barefoot luxury','Kitesurf','B&B'],
     rooms:[{n:'Beach Banda', d:'Double · steps to sand', p:11200, left:3},{n:'Honeymoon Banda', d:'King · outdoor shower', p:16800, left:1}]},
  ],
  posterChoices:[
    'linear-gradient(160deg,#1a1a1a,#43213c 45%,#DC3A21)','linear-gradient(155deg,#F7E874,#e88f3a 50%,#141414)',
    'linear-gradient(150deg,#6C8FD6,#8fd0d6 55%,#B5DF8B)','linear-gradient(160deg,#0C7378,#0f5c4a 60%,#B5DF8B)',
    'linear-gradient(150deg,#DC3A21,#a03a72 55%,#6C8FD6)','linear-gradient(150deg,#141414,#38571f 60%,#B5DF8B)'
  ],
};
// deterministic "taken" seats so maps feel real but stable
function takenSeats(id, rows, perRow){
  let h=0; for(const c of id) h=(h*31+c.charCodeAt(0))>>>0;
  const t=new Set(), total=rows*perRow, n=Math.floor(total*0.34);
  for(let i=0;i<n;i++){ h=(h*1103515245+12345)>>>0; t.add(h%total); }
  return t;
}
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const dParts=d=>{const x=new Date(d+'T00:00:00');return{day:x.getDate(),mon:MONTHS[x.getMonth()],full:x.toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}};
const WM=`<div class="wm" title="Motion × Trybe verified"><span class="wm-m">M</span><span class="wm-x">×</span><span class="wm-t">trybe</span></div>`;

/* ---------- navigation ---------- */
const views=['home','events','organizer','flights','sgr','bus','stays','wallet'];
const rendered={};
function nav(v){
  state.view=v;
  $$('.tab').forEach(t=>t.classList.toggle('on',t.dataset.v===v));
  $$('.bn').forEach(t=>t.classList.toggle('on',t.dataset.v===v||(t.dataset.v==='flights'&&['sgr','bus'].includes(v))));
  views.forEach(x=>$('#v-'+x).classList.toggle('on',x===v));
  if(!rendered[v]||['events','wallet','stays','flights','sgr','bus'].includes(v)){RENDER[v]();rendered[v]=true;}
  window.scrollTo({top:0});
}
$('#tabRow').addEventListener('click',e=>{const t=e.target.closest('.tab');if(t)nav(t.dataset.v)});
$('.bottomnav').addEventListener('click',e=>{const t=e.target.closest('.bn');if(t)nav(t.dataset.v)});

function toast(msg){const t=$('#toast');t.innerHTML=msg;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2600)}
function syncBal(){$('#balTop').textContent=fmt(state.balance);const n=state.wallet.length;[$('#wCnt'),$('#wCnt2')].forEach(c=>{c.textContent=n;c.style.display=n?'grid':'none'})}
$('#btnTopup').addEventListener('click',()=>{state.balance+=50000;syncBal();toast('Motion Pay topped up <b>+ KES 50,000</b> via M-Pesa')});

/* ---------- HOME ---------- */
function renderHome(){
  $('#v-home').innerHTML=`
  <div class="vhead"><span class="eyebrow">One wallet · One checkout · Every journey</span>
  <h1>Where to today?</h1><p>Book each leg on its own or bundle a whole trip — events, flights, SGR, buses, and stays, all paid with Motion Pay. Every ticket lands in <b>My Tickets</b>, independently scannable.</p></div>
  <div class="home-grid">
    <button class="hcard" data-go="events"><span class="hi" style="background:var(--red);color:#fff">🎟</span><h3>Events</h3><p>Live shows, festivals & experiences with per-category ticketing.</p><span class="go">Browse events →</span></button>
    <button class="hcard" data-go="organizer"><span class="hi" style="background:var(--yellow)">⬆</span><h3>Organizer Studio</h3><p>Upload your event, set ticket tiers, go live in minutes.</p><span class="go">Publish an event →</span></button>
    <button class="hcard" data-go="flights"><span class="hi" style="background:var(--blue);color:#fff">✈</span><h3>Flights</h3><p>Jambojet, Safarilink, Kenya Airways, Skyward — with live seat maps.</p><span class="go">Find a flight →</span></button>
    <button class="hcard" data-go="sgr"><span class="hi" style="background:var(--red);color:#fff">🚄</span><h3>SGR Train</h3><p>Madaraka Express first class & economy, Nairobi ⇄ Mombasa.</p><span class="go">Check departures →</span></button>
    <button class="hcard" data-go="bus"><span class="hi" style="background:var(--teal);color:#fff">🚌</span><h3>Buses — East Africa</h3><p>Tahmeed, Mash Poa, Dreamline, Buscar across the region.</p><span class="go">Pick a route →</span></button>
    <button class="hcard" data-go="stays"><span class="hi" style="background:var(--green)">🏝</span><h3>Stays</h3><p>Resorts, villas & Airbnbs — Diani, Lamu, Naivasha, Samburu & more.</p><span class="go">Find a stay →</span></button>
  </div>`;
  $('#v-home').onclick=e=>{const c=e.target.closest('[data-go]');if(c)nav(c.dataset.go)};
}

/* ---------- EVENTS (buyer) ---------- */
function posterHTML(ev,extra=''){
  const d=dParts(ev.date);
  const bg=ev.poster.startsWith('data:')?`background-image:url(${ev.poster})`:`background:${ev.poster}`;
  return `<div class="poster" style="${bg}" ${extra}>
    <div class="pdate"><b>${d.day}</b><span>${d.mon}</span></div>
    <span class="ptag">${ev.tag}</span>
    <div class="ptitle">${ev.title}</div></div>`;
}
function renderEvents(){
  const el=$('#v-events');
  if(state.sel.eventId){renderEventDetail(state.sel.eventId);return}
  el.innerHTML=`<div class="vhead"><span class="eyebrow">Official tickets · Motion × Trybe verified</span>
  <h1>Live & upcoming events</h1><p>Every ticket sold here is the event's own standard ticket, carrying the authentic Motion × Trybe watermark. Tap an event to pick your categories.</p></div>
  <div class="ev-grid">${state.events.map(ev=>`
    <button class="ev-card" data-ev="${ev.id}">
      ${posterHTML(ev)}
      <div class="ev-body"><span class="loc">${ev.venue} · ${ev.city}</span>
      <span class="from">from ${fmt(Math.min(...ev.cats.filter(c=>c.left>0).map(c=>c.p)))}</span></div>
    </button>`).join('')}
  </div>`;
  el.onclick=e=>{const c=e.target.closest('[data-ev]');if(c){state.sel.eventId=c.dataset.ev;renderEventDetail(c.dataset.ev)}};
}
function renderEventDetail(id){
  const ev=state.events.find(x=>x.id===id), d=dParts(ev.date);
  const el=$('#v-events');
  const total=()=>ev.cats.reduce((s,c)=>s+c.p*c.q,0), count=()=>ev.cats.reduce((s,c)=>s+c.q,0);
  el.innerHTML=`<button class="back" id="evBack">← All events</button>
  <div class="detail">
    <div>${posterHTML(ev)}</div>
    <div class="panel">
      <span class="eyebrow">${ev.tag} · by ${ev.organizer}</span>
      <h2>${ev.title}</h2>
      <div class="meta-row"><span>📍 <b>${ev.venue}, ${ev.city}</b></span><span>🗓 <b>${d.full}</b></span><span>🕑 <b>${ev.time}</b></span></div>
      <h3 style="font-size:15px;margin:20px 0 4px">Select tickets</h3>
      <div id="catList">${ev.cats.map((c,i)=>`
        <div class="catline">
          <div class="cn"><b>${c.n}</b><span>${c.left>0?(c.left<=10?`only ${c.left} left`:`${c.left} available`):'—'}${c.note?` · ${c.note}`:''}</span></div>
          <span class="cp">${fmt(c.p)}</span>
          ${c.left>0?`<div class="stepper"><button data-i="${i}" data-d="-1" aria-label="fewer ${c.n}">−</button><span class="q">${c.q}</span><button data-i="${i}" data-d="1" aria-label="more ${c.n}">+</button></div>`:`<span class="soldout">Sold out</span>`}
        </div>`).join('')}
      </div>
      <div class="pricebar" id="evBar" style="display:none">
        <div><div class="tt" id="evCount"></div><div class="amt" id="evTotal"></div></div>
        <button class="btn teal" id="evPay">Checkout tickets →</button>
      </div>
    </div>
  </div>`;
  $('#evBack').onclick=()=>{ev.cats.forEach(c=>c.q=0);state.sel.eventId=null;renderEvents()};
  $('#catList').onclick=e=>{
    const b=e.target.closest('button[data-i]');if(!b)return;
    const c=ev.cats[+b.dataset.i];c.q=Math.max(0,Math.min(c.left,c.q+ +b.dataset.d));
    b.parentElement.querySelector('.q').textContent=c.q;refresh();
  };
  function refresh(){const n=count();$('#evBar').style.display=n?'flex':'none';
    $('#evCount').textContent=n+' ticket'+(n>1?'s':'')+' selected';$('#evTotal').textContent=fmt(total())}
  $('#evPay').onclick=()=>{
    const items=ev.cats.filter(c=>c.q>0).map(c=>({label:`${c.n} × ${c.q}`,amt:c.p*c.q}));
    checkout({title:ev.title,sub:'Event tickets — issued individually, each QR valid once',items,
      onPaid:()=>{ev.cats.filter(c=>c.q>0).forEach(c=>{
        for(let k=0;k<c.q;k++)state.wallet.unshift({type:'event',band:'band-event',tt:'Event Ticket · '+c.n,title:ev.title,
          meta:[['Date',d.full+' · '+ev.time],['Venue',ev.venue+', '+ev.city],['Holder','Wanjiru K.'],['Category',c.n]],
          price:c.p,sn:uid('EV'),status:'Valid · Scan at gate'});
        c.left-=c.q;c.q=0;});
        state.sel.eventId=null;}});
  };
}

/* ---------- ORGANIZER STUDIO ---------- */
function renderOrganizer(){
  const el=$('#v-organizer');
  const draft=state.sel.draft??(state.sel.draft={title:'',venue:'',city:'Nairobi',date:'2026-09-12',time:'6:00 PM',tag:'Concert',poster:state.posterChoices[0],
    cats:[{n:'Regular',p:2000,left:300},{n:'VIP',p:5000,left:60}]});
  el.innerHTML=`<div class="vhead"><span class="eyebrow">Organizer Studio · Free to list</span>
  <h1>Publish your event</h1><p>Upload your poster, set your ticket categories and prices, and go live instantly. Sales settle to your organiser wallet with payout-on-demand.</p></div>
  <div class="org-grid">
    <div class="panel">
      <div class="field"><label for="oTitle">Event name</label><input id="oTitle" placeholder="e.g. Amapiano Nights Vol. 4" value="${draft.title}"></div>
      <div class="f2">
        <div class="field"><label for="oVenue">Venue</label><input id="oVenue" placeholder="e.g. The Alchemist" value="${draft.venue}"></div>
        <div class="field"><label for="oCity">City</label><select id="oCity">${['Nairobi','Mombasa','Diani','Kisumu','Nakuru','Naivasha','Malindi','Kampala','Dar es Salaam','Kigali'].map(c=>`<option ${c===draft.city?'selected':''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="f2">
        <div class="field"><label for="oDate">Date</label><input id="oDate" type="date" value="${draft.date}"></div>
        <div class="field"><label for="oTime">Start time</label><input id="oTime" value="${draft.time}"></div>
      </div>
      <div class="field"><label for="oTag">Category</label><select id="oTag">${['Concert','Festival','Nightlife','Picnic','Sports','Theatre','Conference'].map(c=>`<option ${c===draft.tag?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Event poster</label>
        <div class="dropzone" id="dz" role="button" tabindex="0"><b>⬆ Upload poster image</b><span>PNG or JPG · shown exactly as uploaded on your event card</span></div>
        <input type="file" id="oFile" accept="image/*" hidden>
        <div class="swatches" id="swatches" aria-label="Or pick a designed backdrop">${state.posterChoices.map((g,i)=>`<button class="sw ${g===draft.poster?'on':''}" data-g="${i}" style="background:${g}" aria-label="Poster style ${i+1}"></button>`).join('')}</div>
      </div>
      <div class="field"><label>Ticket categories, prices & quantity</label>
        <div id="catEditor">${draft.cats.map((c,i)=>catRow(c,i)).join('')}</div>
        <button class="addcat" id="addCat">+ Add ticket category</button>
      </div>
      <button class="btn ink" id="publish" style="width:100%;margin-top:8px">Publish event →</button>
      <div class="org-note">Standard tickets are issued exactly as configured, with a discreet Motion × Trybe authenticity watermark and rotating QR. Service fee 5% buyer-side. Payout-on-demand to M-Pesa or bank.</div>
    </div>
    <div>
      <span class="eyebrow" style="margin-bottom:10px">Live preview — buyer's view</span>
      <div class="ev-card" style="cursor:default" id="prevCard"></div>
    </div>
  </div>`;
  function catRow(c,i){return `<div class="cat-edit"><input data-f="n" data-i="${i}" placeholder="Category name" value="${c.n}"><input data-f="p" data-i="${i}" type="number" min="0" placeholder="Price KES" value="${c.p}"><input data-f="left" data-i="${i}" type="number" min="1" placeholder="Qty" value="${c.left}"><button class="del" data-del="${i}" aria-label="Remove category">×</button></div>`}
  function preview(){
    const minP=draft.cats.length?Math.min(...draft.cats.map(c=>+c.p||0)):0;
    $('#prevCard').innerHTML=posterHTML({...draft,title:draft.title||'YOUR EVENT NAME'})+
    `<div class="ev-body"><span class="loc">${draft.venue||'Venue'} · ${draft.city}</span><span class="from">from ${fmt(minP)}</span></div>`;
  }
  preview();
  el.oninput=e=>{
    const t=e.target;
    if(t.dataset.f){draft.cats[+t.dataset.i][t.dataset.f]=t.dataset.f==='n'?t.value:+t.value;preview();return}
    const map={oTitle:'title',oVenue:'venue',oCity:'city',oDate:'date',oTime:'time',oTag:'tag'};
    if(map[t.id]){draft[map[t.id]]=t.value;preview()}
  };
  $('#dz').onclick=()=>$('#oFile').click();
  $('#dz').onkeydown=e=>{if(e.key==='Enter')$('#oFile').click()};
  $('#oFile').onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();r.onload=()=>{draft.poster=r.result;$$('.sw').forEach(s=>s.classList.remove('on'));preview();toast('Poster uploaded — looking sharp ✨')};r.readAsDataURL(f);
  };
  $('#swatches').onclick=e=>{const s=e.target.closest('.sw');if(!s)return;draft.poster=state.posterChoices[+s.dataset.g];$$('.sw').forEach(x=>x.classList.toggle('on',x===s));preview()};
  $('#catEditor').addEventListener('click',e=>{const d=e.target.closest('[data-del]');if(!d)return;draft.cats.splice(+d.dataset.del,1);$('#catEditor').innerHTML=draft.cats.map((c,i)=>catRow(c,i)).join('');preview()});
  $('#addCat').onclick=()=>{draft.cats.push({n:'',p:0,left:100});$('#catEditor').innerHTML=draft.cats.map((c,i)=>catRow(c,i)).join('')};
  $('#publish').onclick=()=>{
    if(!draft.title.trim()||!draft.venue.trim()||!draft.cats.length||draft.cats.some(c=>!c.n.trim()||c.p<=0)){toast('Add a name, venue and at least one priced category');return}
    state.events.unshift({id:uid('ev'),organizer:'Your brand',...JSON.parse(JSON.stringify(draft)),cats:draft.cats.map(c=>({...c,q:0}))});
    state.sel.draft=null;toast(`<b>${draft.title}</b> is live on Motion 🎉`);nav('events');
  };
}

/* ---------- SEAT MAP (shared by flights & buses) ---------- */
function seatMapHTML(cfg){ // {id, layout:[l,r], rows, prem, premFee}
  const perRow=cfg.layout[0]+cfg.layout[1], taken=takenSeats(cfg.id,cfg.rows,perRow);
  const letters='ABCDEFGH';
  let rows='';
  for(let r=0;r<cfg.rows;r++){
    let left='',right='';
    for(let c=0;c<perRow;c++){
      const idx=r*perRow+c, code=(r+1)+letters[c], isPrem=r<(cfg.prem||0);
      const s=`<button class="seat ${taken.has(idx)?'taken':''} ${isPrem?'prem':''}" data-seat="${code}" data-prem="${isPrem?1:0}" ${taken.has(idx)?'disabled':''} aria-label="Seat ${code}${isPrem?' premium':''}">${code}</button>`;
      if(c<cfg.layout[0])left+=s;else right+=s;
    }
    rows+=`<div class="srow"><span class="rn">${r+1}</span>${left}<span class="aisle"></span>${right}<span class="rn">${r+1}</span></div>`;
  }
  return `<div class="cabin"><div class="nose">▲ ${cfg.front||'Front'} ▲</div>
    <div class="seat-legend"><span><i style="background:#fff;border:2px solid var(--ink)"></i>Available</span><span><i style="background:#dddbd2;border:2px solid #bab8ae"></i>Taken</span>${cfg.prem?`<span><i style="background:#fff;border:2px solid var(--blue)"></i>Premium +${fmt(cfg.premFee)}</span>`:''}<span><i style="background:var(--teal)"></i>Your seat</span></div>
    <div class="rows">${rows}</div></div>`;
}
function bindSeats(container,onChange){
  container.addEventListener('click',e=>{
    const s=e.target.closest('.seat');if(!s||s.disabled)return;
    s.classList.toggle('sel');onChange();
  });
}

/* ---------- FLIGHTS ---------- */
function renderFlights(){
  const el=$('#v-flights');
  if(state.sel.flight){renderFlightSeats();return}
  const dests=[...new Set(state.flights.map(f=>f.to))];
  const f=state.sel.fFilter??(state.sel.fFilter={to:'All'});
  const list=state.flights.filter(x=>f.to==='All'||x.to===f.to);
  el.innerHTML=`<div class="vhead"><span class="eyebrow">Single-option checkout — book just the flight</span>
  <h1>Flights across Kenya</h1><p>Real carriers, real cabin layouts. Pick your flight, choose your exact seat from the aircraft's own configuration, and pay — nothing else bundled unless you want it.</p></div>
  <div class="chiprow" id="fChips"><button class="chip ${f.to==='All'?'on':''}" data-to="All">All routes</button>${dests.map(d=>`<button class="chip ${f.to===d?'on':''}" data-to="${d}">${d.split(' (')[0]}</button>`).join('')}</div>
  ${list.map(fl=>{
    const initial=fl.op.split(' ').map(w=>w[0]).join('').slice(0,2);
    return `<button class="trip-card" data-f="${fl.id}" style="width:100%;text-align:left">
      <span class="op-badge" style="background:${fl.col}">${initial}</span>
      <span class="trip-mid"><span class="rt">${fl.dep} ${fl.from.split(' (')[0]} <span class="arr">→</span> ${fl.arr} ${fl.to.split(' (')[0]}</span>
        <span class="sub">${fl.op} ${fl.code} · ${fl.craft} · ${fl.dur} · Direct</span>
        <span class="trip-tags"><span class="ttag">${fl.from.match(/\((.+)\)/)[1]} → ${fl.to.match(/\((.+)\)/)[1]}</span><span class="ttag">Seat selection</span><span class="ttag">15kg bag</span></span></span>
      <span class="trip-price"><b>${fmt(fl.price)}</b><span>per seat</span></span>
      <span style="font-size:20px;color:var(--teal)">→</span>
    </button>`}).join('')}`;
  $('#fChips').onclick=e=>{const c=e.target.closest('.chip');if(c){f.to=c.dataset.to;renderFlights()}};
  el.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{state.sel.flight=b.dataset.f;renderFlightSeats()});
}
function renderFlightSeats(){
  const fl=state.flights.find(x=>x.id===state.sel.flight), el=$('#v-flights'), PREM=1500;
  el.innerHTML=`<button class="back" id="fBack">← All flights</button>
  <div class="vhead"><h1>${fl.op} ${fl.code} — choose your seat</h1><p>${fl.from} → ${fl.to} · ${fl.dep}–${fl.arr} · ${fl.craft} (${fl.layout[0]}–${fl.layout[1]} configuration)</p></div>
  <div class="seat-wrap">
    <div id="cabinBox">${seatMapHTML({...fl,front:'Cockpit',premFee:PREM})}</div>
    <div class="panel">
      <span class="eyebrow">Your selection</span>
      <div id="fSel" style="min-height:60px;font-size:14px;color:#6a6a64;padding:8px 0">No seats selected yet — tap the cabin map.</div>
      <div class="pricebar" style="position:static;margin-top:14px">
        <div><div class="tt" id="fCnt">0 seats</div><div class="amt" id="fTot">${fmt(0)}</div></div>
        <button class="btn teal" id="fPay" disabled>Book flight →</button>
      </div>
    </div>
  </div>`;
  $('#fBack').onclick=()=>{state.sel.flight=null;renderFlights()};
  const sel=()=>$$('#cabinBox .seat.sel');
  const refresh=()=>{
    const s=sel(), tot=s.reduce((a,x)=>a+fl.price+(+x.dataset.prem?PREM:0),0);
    $('#fSel').innerHTML=s.length?s.map(x=>`<div class="line-item"><span>Seat ${x.dataset.seat}${+x.dataset.prem?' · Premium':''}</span><span>${fmt(fl.price+(+x.dataset.prem?PREM:0))}</span></div>`).join(''):'No seats selected yet — tap the cabin map.';
    $('#fCnt').textContent=s.length+' seat'+(s.length!==1?'s':'');$('#fTot').textContent=fmt(tot);$('#fPay').disabled=!s.length;
  };
  bindSeats($('#cabinBox'),refresh);
  $('#fPay').onclick=()=>{
    const s=sel();
    checkout({title:`${fl.op} ${fl.code}`,sub:'Flight only — no bundle. One boarding pass per seat.',
      items:s.map(x=>({label:`Seat ${x.dataset.seat}${+x.dataset.prem?' (Premium)':''}`,amt:fl.price+(+x.dataset.prem?PREM:0)})),
      onPaid:()=>{s.forEach(x=>state.wallet.unshift({type:'flight',band:'band-flight',tt:'Boarding Pass · '+fl.op,title:`${fl.from.split(' (')[0]} → ${fl.to.split(' (')[0]}`,
        meta:[['Flight',fl.code+' · '+fl.craft],['Departs',fl.dep+' · Gate 4'],['Seat',x.dataset.seat+(+x.dataset.prem?' · Premium':'')],['Passenger','Wanjiru K.']],
        price:fl.price+(+x.dataset.prem?PREM:0),sn:uid('BP'),status:'Check-in open'}));state.sel.flight=null}});
  };
}

/* ---------- SGR ---------- */
function renderSGR(){
  const el=$('#v-sgr');
  el.innerHTML=`<div class="vhead"><span class="eyebrow">Madaraka Express · Kenya Railways</span>
  <h1>SGR train tickets</h1><p>First class and economy between Nairobi and Mombasa — express and inter-county services. Book the train alone; nothing else attached.</p></div>
  ${state.sgr.map(t=>`<div class="panel" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
      <div><b style="font-family:var(--display);font-size:17px">🚄 ${t.name}</b>
      <div style="font-size:13px;color:#6a6a64;margin-top:2px">${t.from} ${t.dep} → ${t.to} ${t.arr} · ${t.dur}</div>
      <div style="font-size:11.5px;color:#8a8a84;margin-top:2px">Stops: ${t.stops}</div></div>
    </div>
    ${t.classes.map((c,i)=>`<div class="catline">
      <div class="cn"><b>${c.n}</b><span class="${c.left<20?'avail low':'avail'}">${c.left} seats left</span></div>
      <span class="cp">${fmt(c.p)}</span>
      <div class="stepper"><button data-t="${t.id}" data-c="${i}" data-d="-1" aria-label="fewer">−</button><span class="q" id="q-${t.id}-${i}">0</span><button data-t="${t.id}" data-c="${i}" data-d="1" aria-label="more">+</button></div>
    </div>`).join('')}
  </div>`).join('')}
  <div class="pricebar" id="sBar" style="display:none"><div><div class="tt" id="sCnt"></div><div class="amt" id="sTot"></div></div><button class="btn teal" id="sPay">Book SGR →</button></div>`;
  const q={}; // key tid-ci
  el.onclick=e=>{
    const b=e.target.closest('button[data-t]');if(!b)return;
    const k=b.dataset.t+'-'+b.dataset.c, t=state.sgr.find(x=>x.id===b.dataset.t), c=t.classes[+b.dataset.c];
    q[k]=Math.max(0,Math.min(c.left,(q[k]||0)+ +b.dataset.d));
    $('#q-'+k).textContent=q[k];
    const entries=Object.entries(q).filter(([,v])=>v>0);
    const n=entries.reduce((s,[,v])=>s+v,0);
    const tot=entries.reduce((s,[k2,v])=>{const[tid,ci]=k2.split('-');return s+state.sgr.find(x=>x.id===tid).classes[+ci].p*v},0);
    $('#sBar').style.display=n?'flex':'none';$('#sCnt').textContent=n+' seat'+(n>1?'s':'');$('#sTot').textContent=fmt(tot);
  };
  $('#sPay')&&($('#sPay').onclick=()=>{
    const entries=Object.entries(q).filter(([,v])=>v>0);
    const items=entries.map(([k2,v])=>{const[tid,ci]=k2.split('-');const t=state.sgr.find(x=>x.id===tid),c=t.classes[+ci];return{label:`${t.dep} ${c.n} × ${v}`,amt:c.p*v,_t:t,_c:c,_v:v}});
    checkout({title:'Madaraka Express',sub:'SGR train — standalone booking',items,
      onPaid:()=>{items.forEach(it=>{for(let k=0;k<it._v;k++)state.wallet.unshift({type:'sgr',band:'band-sgr',tt:'SGR Ticket · '+it._c.n,title:`${it._t.from.split(' ')[0]} → ${it._t.to.split(' ')[0]}`,
        meta:[['Train',it._t.name.split('—')[1].trim()],['Departs',it._t.dep+' · '+it._t.from],['Class',it._c.n+' · Coach '+(it._c.n[0]==='F'?'M1':'C'+(3+Math.floor(Math.random()*6)))],['Passenger','Wanjiru K.']],
        price:it._c.p,sn:uid('SGR'),status:'Valid · Gate opens 40min prior'});it._c.left-=it._v})}});
  });
}

/* ---------- BUS ---------- */
function renderBus(){
  const el=$('#v-bus');
  if(state.sel.bus){renderBusSeats();return}
  const f=state.sel.bFilter??(state.sel.bFilter={to:'All'});
  const dests=[...new Set(state.buses.map(b=>b.to))];
  const list=state.buses.filter(b=>f.to==='All'||b.to===f.to);
  el.innerHTML=`<div class="vhead"><span class="eyebrow">East Africa by road · cross-border ready</span>
  <h1>Bus routes</h1><p>Tahmeed, Mash Poa, Dreamline and Buscar — Nairobi, Mombasa, Kisumu, Voi, Malindi, Kampala, Kigali, Dar es Salaam. Choose your coach, then your exact seat.</p></div>
  <div class="chiprow" id="bChips"><button class="chip ${f.to==='All'?'on':''}" data-to="All">All destinations</button>${dests.map(d=>`<button class="chip ${f.to===d?'on':''}" data-to="${d}">${d}</button>`).join('')}</div>
  ${list.map(b=>`<button class="trip-card" data-b="${b.id}" style="width:100%;text-align:left">
    <span class="op-badge" style="background:${b.col}">${b.op[0]}</span>
    <span class="trip-mid"><span class="rt">${b.dep} ${b.from} <span class="arr">→</span> ${b.arr} ${b.to}</span>
    <span class="sub">${b.op} · ${b.cls} · ${b.dur}</span>
    <span class="trip-tags">${b.tags.map(t=>`<span class="ttag">${t}</span>`).join('')}</span></span>
    <span class="trip-price"><b>${fmt(b.price)}</b><span>per seat</span></span>
    <span style="font-size:20px;color:var(--teal)">→</span>
  </button>`).join('')}`;
  $('#bChips').onclick=e=>{const c=e.target.closest('.chip');if(c){f.to=c.dataset.to;renderBus()}};
  el.querySelectorAll('[data-b]').forEach(x=>x.onclick=()=>{state.sel.bus=x.dataset.b;renderBusSeats()});
}
function renderBusSeats(){
  const b=state.buses.find(x=>x.id===state.sel.bus), el=$('#v-bus');
  el.innerHTML=`<button class="back" id="bBack">← All buses</button>
  <div class="vhead"><h1>${b.op} — ${b.from} → ${b.to}</h1><p>${b.cls} coach · departs ${b.dep} · ${b.layout[0]}×${b.layout[1]} seating. Tap your seats.</p></div>
  <div class="seat-wrap">
    <div id="busBox">${seatMapHTML({...b,prem:0,front:'Driver / Door'})}</div>
    <div class="panel"><span class="eyebrow">Your selection</span>
      <div id="bSel" style="min-height:60px;font-size:14px;color:#6a6a64;padding:8px 0">No seats selected yet.</div>
      <div class="pricebar" style="position:static;margin-top:14px">
        <div><div class="tt" id="bCnt">0 seats</div><div class="amt" id="bTot">${fmt(0)}</div></div>
        <button class="btn teal" id="bPay" disabled>Book bus →</button>
      </div></div>
  </div>`;
  $('#bBack').onclick=()=>{state.sel.bus=null;renderBus()};
  const sel=()=>$$('#busBox .seat.sel');
  const refresh=()=>{const s=sel();$('#bSel').innerHTML=s.length?s.map(x=>`<div class="line-item"><span>Seat ${x.dataset.seat}</span><span>${fmt(b.price)}</span></div>`).join(''):'No seats selected yet.';
    $('#bCnt').textContent=s.length+' seat'+(s.length!==1?'s':'');$('#bTot').textContent=fmt(s.length*b.price);$('#bPay').disabled=!s.length};
  bindSeats($('#busBox'),refresh);
  $('#bPay').onclick=()=>{const s=sel();
    checkout({title:`${b.op} · ${b.from} → ${b.to}`,sub:'Bus ticket — standalone booking',
      items:s.map(x=>({label:'Seat '+x.dataset.seat,amt:b.price})),
      onPaid:()=>{s.forEach(x=>state.wallet.unshift({type:'bus',band:'band-bus',tt:'Bus Ticket · '+b.op,title:`${b.from} → ${b.to}`,
        meta:[['Coach',b.cls],['Departs',b.dep+' · '+b.from+' office'],['Seat',x.dataset.seat],['Passenger','Wanjiru K.']],
        price:b.price,sn:uid('BUS'),status:'Board 30min before'}));state.sel.bus=null}});
  };
}

/* ---------- STAYS ---------- */
function renderStays(){
  const el=$('#v-stays');
  if(state.sel.stay){renderStayDetail();return}
  const f=state.sel.stFilter??(state.sel.stFilter={d:'All'});
  const dests=['All','Diani','Lamu','Naivasha','Kisumu','Samburu','Voi','Malindi'];
  const list=state.stays.filter(s=>f.d==='All'||s.dest===f.d);
  el.innerHTML=`<div class="vhead"><span class="eyebrow">Resorts · Villas · Airbnbs — live availability</span>
  <h1>Stays across the coast & beyond</h1><p>Only rooms that are actually available are shown, with nightly rates and your check-in options — including contactless Motion Pay self check-in.</p></div>
  <div class="chiprow" id="stChips">${dests.map(d=>`<button class="chip ${f.d===d?'on':''}" data-d="${d}">${d==='All'?'All destinations':d}</button>`).join('')}</div>
  <div class="stay-grid">${list.map(s=>`
    <button class="stay-card" data-st="${s.id}">
      <div class="stay-vis" style="background:${s.vis}"><span class="stype">${s.type} · ★ ${s.rating}</span><span class="rate">from ${fmt(s.from)}/night</span></div>
      <div class="stay-body"><h3>${s.name}</h3><div class="loc">📍 ${s.dest}, Kenya</div>
      <div class="amen">${s.amen.map(a=>`<span class="ttag">${a}</span>`).join('')}</div></div>
    </button>`).join('')}
  </div>`;
  $('#stChips').onclick=e=>{const c=e.target.closest('.chip');if(c){f.d=c.dataset.d;renderStays()}};
  el.querySelectorAll('[data-st]').forEach(x=>x.onclick=()=>{state.sel.stay=x.dataset.st;renderStayDetail()});
}
function renderStayDetail(){
  const s=state.stays.find(x=>x.id===state.sel.stay), el=$('#v-stays');
  const sel={room:null,nights:2,ci:'Motion Pay self check-in',date:'2026-08-07'};
  el.innerHTML=`<button class="back" id="stBack">← All stays</button>
  <div class="detail">
    <div><div class="stay-vis" style="background:${s.vis};height:280px;border-radius:20px;border:2px solid var(--ink)"><span class="stype">${s.type} · ★ ${s.rating}</span></div>
      <div class="panel" style="margin-top:16px"><span class="eyebrow">Check-in options</span>
        <div class="checkin-opts" id="ckOpts">
          ${['Motion Pay self check-in','Host meet & greet','Front desk (24h)'].map(o=>`<button class="ck ${o===sel.ci?'on':''}" data-ck="${o}">${o==='Motion Pay self check-in'?'📲':'🤝'} ${o}</button>`).join('')}
        </div>
        <p style="font-size:12px;color:#6a6a64;margin-top:12px">Motion Pay self check-in: your stay voucher QR unlocks the smart-lock / gate — no cash, no paperwork.</p>
      </div></div>
    <div class="panel">
      <span class="eyebrow">${s.dest}, Kenya</span><h2>${s.name}</h2>
      <div class="f2" style="margin:16px 0 4px">
        <div class="field"><label for="ciDate">Check-in date</label><input id="ciDate" type="date" value="${sel.date}"></div>
        <div class="field"><label for="nNights">Nights</label><select id="nNights">${[1,2,3,4,5,7,10,14].map(n=>`<option ${n===sel.nights?'selected':''} value="${n}">${n} night${n>1?'s':''}</option>`).join('')}</select></div>
      </div>
      <h3 style="font-size:15px;margin:8px 0 2px">Available rooms only</h3>
      <div id="roomList">${s.rooms.map((r,i)=>`
        <div class="room-line"><div class="rn"><b>${r.n}</b><span>${r.d}</span><span class="${r.left<=2?'avail low':'avail'}"> · ${r.left} left at this rate</span></div>
        <span class="cp mono" style="font-weight:700;font-size:13px">${fmt(r.p)}<span style="font-weight:400;color:#8a8a84;font-size:10px">/night</span></span>
        <button class="btn sm ${'ghost'}" data-r="${i}">Select</button></div>`).join('')}
      </div>
      <div class="pricebar" id="stBar" style="display:none">
        <div><div class="tt" id="stSum"></div><div class="amt" id="stTot"></div></div>
        <button class="btn teal" id="stPay">Book stay →</button>
      </div>
    </div>
  </div>`;
  $('#stBack').onclick=()=>{state.sel.stay=null;renderStays()};
  $('#ckOpts').onclick=e=>{const c=e.target.closest('.ck');if(!c)return;sel.ci=c.dataset.ck;$$('#ckOpts .ck').forEach(x=>x.classList.toggle('on',x===c))};
  $('#ciDate').onchange=e=>{sel.date=e.target.value;refresh()};
  $('#nNights').onchange=e=>{sel.nights=+e.target.value;refresh()};
  $('#roomList').onclick=e=>{const b=e.target.closest('[data-r]');if(!b)return;sel.room=+b.dataset.r;
    $$('#roomList [data-r]').forEach(x=>{x.classList.toggle('teal',x===b);x.classList.toggle('ghost',x!==b);x.textContent=x===b?'Selected ✓':'Select'});refresh()};
  function refresh(){if(sel.room==null)return;const r=s.rooms[sel.room];
    $('#stBar').style.display='flex';$('#stSum').textContent=`${r.n} · ${sel.nights} night${sel.nights>1?'s':''} · ${sel.ci.split(' ')[0]} check-in`;
    $('#stTot').textContent=fmt(r.p*sel.nights)}
  $('#stPay').onclick=()=>{const r=s.rooms[sel.room];const d=dParts(sel.date);
    checkout({title:s.name,sub:`${r.n} · check-in ${d.full}`,items:[{label:`${r.n} × ${sel.nights} night${sel.nights>1?'s':''}`,amt:r.p*sel.nights},{label:'Check-in: '+sel.ci,amt:0}],
      onPaid:()=>{state.wallet.unshift({type:'stay',band:'band-stay',tt:'Stay Voucher · '+s.type,title:s.name+', '+s.dest,
        meta:[['Room',r.n],['Check-in',d.full+' · from 2 PM'],['Nights',sel.nights+' · '+ (sel.nights)+'N/'+(sel.nights+1)+'D'],['Check-in mode',sel.ci]],
        price:r.p*sel.nights,sn:uid('STY'),status:sel.ci.startsWith('Motion')?'QR unlocks smart-lock':'Show at reception'});
        r.left--;state.sel.stay=null}});
  };
}

/* ---------- WALLET ---------- */
function renderWallet(){
  const el=$('#v-wallet');
  el.innerHTML=`<div class="vhead"><span class="eyebrow">Every ticket · independent · offline-ready</span>
  <h1>My Tickets</h1><p>Each booking is its own ticket with its own QR — your stay voucher, event tickets, boarding pass, SGR and bus tickets all live here, scannable one by one even with zero signal.</p></div>
  ${state.wallet.length?`<div class="wallet-grid">${state.wallet.map(w=>`
    <article class="tkt"><div class="tkt-main"><div class="tkt-band ${w.band}"></div>
      <div class="tkt-type">${w.tt} · Official</div>
      <div class="tkt-title">${w.title}</div>
      <div class="tkt-meta">${w.meta.map(m=>`<div><b>${m[0]}</b>${m[1]}</div>`).join('')}</div>
      <div class="tkt-foot">${WM}<span class="tkt-price">${fmt(w.price)}</span></div>
    </div>
    <div class="tkt-stub"><div class="qr" aria-hidden="true"></div><span class="sn">Nº ${w.sn}</span><span class="st">${w.status}</span></div>
    </article>`).join('')}</div>`
  :`<div class="empty"><b>Nothing here yet</b>Book an event, a flight, the SGR, a bus, or a stay — every ticket you buy appears here individually, watermarked and ready to scan.</div>`}`;
}

/* ---------- CHECKOUT ENGINE ---------- */
function checkout({title,sub,items,onPaid}){
  const total=items.reduce((s,i)=>s+i.amt,0);
  const fee=Math.round(total*0.05);
  const grand=total+fee;
  let method='motion';
  const sheet=$('#sheet'), ov=$('#overlay');
  function paint(){
    const short=method==='motion'&&state.balance<grand;
    sheet.innerHTML=`<h2>Checkout — ${title}</h2><p class="sub">${sub}</p>
    ${items.map(i=>`<div class="line-item"><span>${i.label}</span><span>${i.amt?fmt(i.amt):'Included'}</span></div>`).join('')}
    <div class="line-item"><span>Service fee (5%)</span><span>${fmt(fee)}</span></div>
    <div class="total-line"><span>Total</span><span>${fmt(grand)}</span></div>
    <div class="pm-row">
      <button class="chip ${method==='motion'?'on':''}" data-m="motion">₭ Motion Pay</button>
      <button class="chip ${method==='mpesa'?'on':''}" data-m="mpesa">M-Pesa STK push</button>
    </div>
    <div class="paybox"><div class="pb-l"><span class="pb-ico">${method==='motion'?'₭':'M'}</span>${method==='motion'?'Motion Pay wallet':'M-Pesa · 07•• ••• 421'}</div>
      <span class="bal ${short?'short':''}">${method==='motion'?(short?'Balance low: ':'Balance: ')+fmt(state.balance):'STK prompt on pay'}</span></div>
    <div style="display:flex;gap:10px">
      <button class="btn ghost" id="ckCancel" style="flex:1">Cancel</button>
      <button class="btn ink" id="ckPay" style="flex:2" ${short?'disabled':''}>${short?'Top up to continue':'Pay '+fmt(grand)+' →'}</button>
    </div>
    ${short?'<p style="font-size:12px;color:var(--red);margin-top:10px">Tap “+ Top up” in the top bar, then return to checkout.</p>':''}`;
    sheet.querySelector('.pm-row').onclick=e=>{const b=e.target.closest('[data-m]');if(b){method=b.dataset.m;paint()}};
    $('#ckCancel').onclick=close;
    $('#ckPay').onclick=()=>{
      if(method==='motion')state.balance-=grand;
      sheet.innerHTML=`<div class="success"><div class="big">✓</div>
        <h2>Payment confirmed</h2>
        <p class="sub" style="margin:8px 0 4px">${method==='motion'?'Paid with Motion Pay':'M-Pesa confirmed · QFT7X2K1LM'} · ${fmt(grand)}</p>
        <p style="font-size:13.5px;color:#5a5a5a">Your ticket${items.length>1?'s are':' is'} in <b>My Tickets</b> — watermarked, QR-secured, and offline-ready.</p>
        <div style="display:flex;gap:10px;margin-top:20px"><button class="btn ghost" id="ckStay" style="flex:1">Keep browsing</button><button class="btn teal" id="ckWallet" style="flex:1">View my tickets →</button></div></div>`;
      onPaid();syncBal();
      $('#ckStay').onclick=()=>{close();nav(state.view)};
      $('#ckWallet').onclick=()=>{close();nav('wallet')};
      toast('Ticket issued · <b>Motion × Trybe verified</b>');
    };
  }
  function close(){ov.classList.remove('on')}
  ov.onclick=e=>{if(e.target===ov)close()};
  paint();ov.classList.add('on');
}

/* ---------- boot ---------- */
const RENDER={home:renderHome,events:renderEvents,organizer:renderOrganizer,flights:renderFlights,sgr:renderSGR,bus:renderBus,stays:renderStays,wallet:renderWallet};
syncBal();renderHome();rendered.home=true;
