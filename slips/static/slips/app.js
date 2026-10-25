"use strict";

/* ---------- state ---------- */
const DATA = JSON.parse(document.getElementById("initial-data").textContent);
const SOON_MS = 2 * 60 * 60 * 1000; // "expiring soon" = pull time within 2 hours
const state = {
  products: DATA.products,
  slips: DATA.slips,
  groups: DATA.groups,
  isAdmin: DATA.is_admin,
  selected: new Set(),
  filter: "active",
  group: "all",
  search: "",
  newSel: new Set(),
  stackPos: new Map(), // stack key -> { i, t }: which slip of a stack is in front, and when it was moved
};
const STACK_RESET_MS = 20 * 1000; // after this, a stack goes back to "use first" in front

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${DAYS[d.getDay()]} ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const fmtClock = (d) => `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`;
const fmtTime = (d) => `${fmtClock(d)} ${d.getHours() < 12 ? "AM" : "PM"}`;
const fmtShort = (d) => `${DAYS[d.getDay()]} ${pad(d.getDate())} ${MONTHS[d.getMonth()]} · ${fmtTime(d)}`;
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDateInput = (d) => toLocalInput(d).slice(0, 10);

function duration(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mm}m`;
  return `${mm}m`;
}

const productById = (id) => state.products.find((p) => p.id === id);
const productLabel = (p) => (p ? (p.note ? `${p.name} (${p.note})` : p.name) : "Unknown product");
const slipProducts = (s) => s.product_ids.map(productById).filter(Boolean);
const slipTitle = (s) => slipProducts(s).map(productLabel).join(", ") || "Deleted product";
const ruleKey = (p) => `${p.basis}|${p.duration_value}|${p.duration_unit}`;

function status(s) {
  if (s.discarded_at) return "discarded";
  const left = new Date(s.pull_at) - Date.now();
  if (left <= 0) return "expired";
  if (left <= SOON_MS) return "soon";
  return "fresh";
}

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function refreshSlips() {
  try {
    const res = await fetch("/api/slips/");
    if (res.status === 302 || res.redirected) return location.reload();
    state.slips = (await res.json()).slips;
    render();
  } catch {
    /* offline for a moment: keep showing what we have */
  }
}

function lastInitials() {
  try { return localStorage.getItem("initials") || ""; } catch { return ""; }
}
function rememberInitials(v) {
  try { localStorage.setItem("initials", v); } catch { /* ignore */ }
}
function askInitials(action) {
  const v = prompt(`Your initials (${action}):`, lastInitials());
  if (v === null) return null;
  const clean = v.trim().toUpperCase();
  if (!clean) { alert("Initials are required."); return null; }
  rememberInitials(clean);
  return clean;
}

/* ---------- pull-time preview (server is the source of truth) ---------- */
function computePull(p, timeIn, defrost, kill) {
  let start;
  if (p.basis === "time_in") {
    start = new Date(timeIn);
  } else {
    const day = p.basis === "defrost" ? defrost : kill;
    if (!day) return null;
    const [y, m, d] = day.split("-").map(Number);
    start = new Date(y, m - 1, d, timeIn.getHours(), timeIn.getMinutes());
  }
  const v = p.duration_value;
  if (p.duration_unit === "hours") return new Date(start.getTime() + v * 3600e3);
  start.setDate(start.getDate() + v * (p.duration_unit === "weeks" ? 7 : 1));
  return start;
}

/* ---------- board ---------- */
const FILTERS = [
  ["active", "On the board"],
  ["expired", "Expired"],
  ["soon", "Expiring soon"],
  ["fresh", "Fresh"],
  ["discarded", "History (7 days)"],
];

function visibleSlips() {
  const q = state.search.trim().toLowerCase();
  let list = state.slips.filter((s) => {
    const st = status(s);
    if (state.filter === "active" ? st === "discarded" : st !== state.filter) return false;
    if (state.group !== "all" && !slipProducts(s).some((p) => p.group === state.group)) return false;
    if (q && !`${slipTitle(s)} ${s.initials}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (state.filter === "discarded") list.sort((a, b) => new Date(b.discarded_at) - new Date(a.discarded_at));
  else list.sort((a, b) => new Date(a.pull_at) - new Date(b.pull_at));
  return list;
}

function render() {
  const counts = { expired: 0, soon: 0, fresh: 0, discarded: 0 };
  state.slips.forEach((s) => counts[status(s)]++);
  const active = counts.expired + counts.soon + counts.fresh;

  // forget selections for slips that no longer exist
  const ids = new Set(state.slips.map((s) => s.id));
  state.selected.forEach((id) => ids.has(id) || state.selected.delete(id));

  $("#summary").innerHTML = `
    <button class="stat st-expired" data-filter="expired"><b>${counts.expired}</b> Expired</button>
    <button class="stat st-soon" data-filter="soon"><b>${counts.soon}</b> Expiring within 2 h</button>
    <button class="stat st-fresh" data-filter="fresh"><b>${counts.fresh}</b> Fresh</button>`;

  $("#status-filter").innerHTML = FILTERS.map(([k, label]) => {
    const n = k === "active" ? active : counts[k];
    return `<button class="chip ${state.filter === k ? "on" : ""}" data-filter="${k}">${label} <span>${n}</span></button>`;
  }).join("");

  const list = visibleSlips();
  $("#board").innerHTML = list.length
    ? groupedBoardHtml(list)
    : `<p class="empty">${state.filter === "active" ? "No slips yet. Tap “+ New Slip” to add one." : "Nothing here."}</p>`;

  const n = state.selected.size;
  $("#btn-print").textContent = n ? `Print (${n})` : "Print";
  ["#btn-print", "#btn-to-tray", "#btn-replace-save", "#btn-replace", "#btn-discard", "#btn-clear"].forEach((s) => ($(s).disabled = !n));
  renderTrayButton();
}

// One section per product group, in the slip form's order; empty groups are left out.
// A slip goes under the group of its first product. Slips for the same product(s)
// are stacked, soonest pull in front, so a second container is obvious at a glance.
function groupedBoardHtml(list) {
  const stackUp = state.filter !== "discarded";
  return state.groups.map(({ key, label }) => {
    const items = list.filter((s) => (slipProducts(s)[0]?.group ?? "prep") === key);
    if (!items.length) return "";
    const expired = items.filter((s) => status(s) === "expired").length;
    const stacks = new Map(); // list is sorted by pull time, so each stack's first slip expires first
    items.forEach((s) => {
      const k = stackUp ? stackKey(s) : `slip-${s.id}`;
      stacks.set(k, [...(stacks.get(k) || []), s]);
    });
    return `
      <section class="group">
        <h2>${esc(label)} <span class="count">${items.length}</span>${expired ? `<span class="count expired">${expired} expired</span>` : ""}</h2>
        <div class="group-grid">${[...stacks].map(([k, slips]) => stackHtml(k, slips)).join("")}</div>
      </section>`;
  }).join("");
}

const stackKey = (s) => [...s.product_ids].sort((a, b) => a - b).join("-");

function stackFront(k, n) {
  const pos = state.stackPos.get(k);
  return pos && pos.i < n && Date.now() - pos.t < STACK_RESET_MS ? pos.i : 0;
}

// Front card = the container on show; every other container peeks out below it as a
// strip (number, status, pull time) that brings it to the front when tapped.
function stackHtml(k, slips) {
  const n = slips.length;
  if (n === 1) return cardHtml(slips[0]);
  const i = stackFront(k, n);
  const peeks = slips.map((s, j) => ({ s, j })).filter(({ j }) => j !== i).map(({ s, j }, d) => {
    const st = status(s);
    return `<button type="button" class="peek st-${st} ${state.selected.has(s.id) ? "sel" : ""}" data-goto="${j}"
        style="--d:${d + 1}; z-index:${50 - d}" title="Bring to front">
      <span class="peek-num">${j + 1}</span>
      <span class="peek-when" title="Pull ${fmtShort(new Date(s.pull_at))}">${pad(new Date(s.pull_at).getDate())} ${MONTHS[new Date(s.pull_at).getMonth()]} · ${fmtTime(new Date(s.pull_at))}</span>
      <span class="peek-st">${st === "expired" ? "EXPIRED" : st === "soon" ? "SOON" : ""}${s.printed_at ? "" : " · In tray"}</span>
    </button>`;
  }).join("");
  return `<div class="stack" data-key="${k}" data-n="${n}">${cardHtml(slips[i], { i, n })}<div class="peeks">${peeks}</div></div>`;
}

function cardHtml(s, stack = null) {
  const st = status(s);
  const pull = new Date(s.pull_at);
  const left = pull - Date.now();
  const label = {
    expired: `EXPIRED ${duration(left)} ago`,
    soon: `Pull in ${duration(left)}`,
    fresh: `Pull in ${duration(left)}`,
    discarded: `Discarded ${fmtShort(new Date(s.discarded_at))}${s.discarded_by ? " by " + esc(s.discarded_by) : ""}`,
  }[st];
  const sel = state.selected.has(s.id);
  return `
    <article class="card st-${st} ${sel ? "sel" : ""}" data-id="${s.id}" tabindex="0">
      <label class="pick" title="Select"><input type="checkbox" ${sel ? "checked" : ""}></label>
      <div class="card-status">${label}</div>
      ${stack ? `<div class="stack-tag">${stack.i === 0 ? "<b>USE FIRST</b>" : ""}<span>${stack.i + 1} of ${stack.n}</span></div>` : ""}
      <h3>${esc(slipTitle(s))}</h3>
      <div class="pull"><span>Pull</span> ${fmtShort(pull)}</div>
      <div class="meta">In ${fmtShort(new Date(s.time_in))} · ${esc(s.initials)} · ${esc(s.shelf_life)}</div>
      <div class="card-foot">
        ${st === "discarded" ? "" : s.printed_at
          ? `<button type="button" class="tray-btn" data-tray="add">+ Add to tray</button>`
          : `<button type="button" class="tray-btn in" data-tray="remove" title="Tap to take it out of the tray">&#10003; In tray</button>`}
        ${stack ? `<span class="stack-nav">
          <button type="button" data-step="-1" aria-label="Previous container">&#8249;</button>
          <button type="button" data-step="1" aria-label="Next container">&#8250;</button></span>` : ""}
      </div>
    </article>`;
}

/* ---------- paper slip (screen preview + print) ---------- */
const WEEK = ["S", "M", "T", "W", "TH", "F", "S"];
const weekRow = (d) =>
  `<span class="days">${WEEK.map((w, i) => `<span class="${i === d.getDay() ? "circ" : ""}">${w}</span>`).join("")}</span>`;
const ampm = (d) => {
  const pm = d.getHours() >= 12;
  return `<span class="${pm ? "" : "circ"}">AM</span>/<span class="${pm ? "circ" : ""}">PM</span>`;
};

// The defrost / kill date line goes under the last section that has products using it.
const lastGroupWith = (basis) =>
  state.groups.map((g) => g.key).filter((k) => state.products.some((p) => p.active && p.group === k && p.basis === basis)).pop();

function slipHtml(s) {
  const on = new Set(s.product_ids);
  const tin = new Date(s.time_in);
  const pull = new Date(s.pull_at);
  const fmtDay = (iso) => (iso ? fmtDate(new Date(iso + "T00:00")) : "");

  const sections = state.groups.map(({ key, label }) => {
    const items = state.products.filter((p) => p.group === key && (p.active || on.has(p.id)));
    if (!items.length) return "";
    const rows = items.map((p) => `
      <div class="it ${on.has(p.id) ? "on" : ""}">
        <span class="box"></span>
        <span class="nm">${esc(p.name)}<small>${esc(p.note ? p.note + " · " : "")}${esc(on.has(p.id) ? s.shelf_life : p.shelf_life)}</small></span>
      </div>`).join("");
    let extra = "";
    if (key === lastGroupWith("defrost")) extra += `<div class="p-line">Defrosting Start Date: <b>${fmtDay(s.defrost_start)}</b></div>`;
    if (key === lastGroupWith("kill")) extra += `<div class="p-line">Kill Date: <b>${fmtDay(s.kill_date)}</b></div>`;
    return `<div class="p-sec"><h4>${esc(label)}:</h4><div class="p-grid">${rows}</div>${extra}</div>`;
  }).join("");

  return `
    <div class="paper">
      <div class="p-head"><div class="p-small">P R O D U C T</div><div class="p-big">CONTROL SLIP</div></div>
      <div class="p-item">${esc(slipTitle(s))}</div>
      <div class="p-line">Today's Date <b>${fmtDate(tin)}</b></div>
      <div class="p-line">Week Day ${weekRow(tin)}</div>
      <div class="p-line">Time in <b>${fmtClock(tin)}</b> ${ampm(tin)} &nbsp;Initials <b>${esc(s.initials)}</b></div>
      ${sections}
      <div class="p-pull">
        <h4>When to Pull Item:</h4>
        <div class="p-line">Pull Date <b class="big">${fmtDate(pull)}</b></div>
        <div class="p-line">Pull Day ${weekRow(pull)}</div>
        <div class="p-line">Time <b class="big">${fmtClock(pull)}</b> ${ampm(pull)}</div>
      </div>
      <div class="p-foot">Slip #${s.id} · ${esc(s.shelf_life)}</div>
    </div>`;
}

// Compact slip: everything needed to act on, without the unticked boxes.
function compactHtml(s) {
  const tin = new Date(s.time_in);
  const pull = new Date(s.pull_at);
  const fmtDay = (iso) => (iso ? fmtDate(new Date(iso + "T00:00")) : "");
  const extra = s.defrost_start
    ? `<div class="c-row">Defrost start <b>${fmtDay(s.defrost_start)}</b></div>`
    : s.kill_date ? `<div class="c-row">Kill date <b>${fmtDay(s.kill_date)}</b></div>` : "";
  return `
    <div class="cslip">
      <div class="c-top"><span>PRODUCT CONTROL SLIP</span><span>#${s.id}</span></div>
      <div class="c-item">${esc(slipTitle(s))}</div>
      <div class="c-row">In <b>${fmtDate(tin)} · ${fmtTime(tin)}</b> &nbsp;Initials <b>${esc(s.initials)}</b></div>
      ${extra}
      <div class="c-pull">
        <span class="c-label">PULL</span>
        <span class="c-when">${fmtDate(pull)} · ${fmtTime(pull)}</span>
        ${weekRow(pull)}
      </div>
      <div class="c-foot">${esc(s.shelf_life)}</div>
    </div>`;
}

// Shrink a slip's text until everything fits in its space.
function fitPaper(el) {
  let scale = 1;
  el.style.setProperty("--fs", scale);
  while (el.scrollHeight > el.clientHeight + 1 && scale > 0.55) {
    scale -= 0.03;
    el.style.setProperty("--fs", scale.toFixed(2));
  }
}

/* ---------- print settings & printing ---------- */
const LAYOUTS = {
  full3: {
    name: "Full form · 3 per page",
    desc: "The whole paper form, Letter landscape. Cut into 3 strips.",
    perPage: 3, html: slipHtml, page: "size: letter landscape; margin: .25in;",
  },
  compact8: {
    name: "Compact · 8 per page",
    desc: "Just the product, dates and pull time, bigger text. Letter portrait, cut into 8.",
    perPage: 8, html: compactHtml, page: "size: letter portrait; margin: .25in;",
  },
  labels10: {
    name: "Labels · 10 per sheet",
    desc: "Compact slip on 2\" × 4\" sticker labels (Avery 5163 / 8163). Peel and stick, no cutting.",
    perPage: 10, html: compactHtml, page: "size: letter portrait; margin: 0;", labels: true,
  },
};

function loadPrintSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("printSettings") || "{}"); } catch { /* ignore */ }
  return {
    layout: LAYOUTS[saved.layout] ? saved.layout : "full3",
    labelStart: Math.min(10, Math.max(1, Number(saved.labelStart) || 1)),
  };
}
let printSettings = loadPrintSettings();
function savePrintSettings() {
  try { localStorage.setItem("printSettings", JSON.stringify(printSettings)); } catch { /* ignore */ }
}

// Spots left on the first page: part-used label sheets start further in.
const firstPageSkip = () => (LAYOUTS[printSettings.layout].labels ? printSettings.labelStart - 1 : 0);

async function printSlips(slips) {
  if (!slips.length) return;
  const key = printSettings.layout;
  const layout = LAYOUTS[key];
  const cells = [...Array(firstPageSkip()).fill(null), ...slips];
  const pages = [];
  for (let i = 0; i < cells.length; i += layout.perPage) {
    const items = cells.slice(i, i + layout.perPage).map((s) => (s ? `<div class="cell">${layout.html(s)}</div>` : `<div class="cell blank"></div>`));
    pages.push(`<div class="print-page">${items.join("")}</div>`);
  }
  const area = $("#print-area");
  area.className = `layout-${key}`;
  area.innerHTML = pages.join("");
  $("#page-style").textContent = `@media print { @page { ${layout.page} } }`;
  area.querySelectorAll(".paper, .cslip").forEach(fitPaper);
  window.print();

  // We can't tell if the printer actually printed, so ask before emptying the tray.
  const unprinted = slips.filter((s) => !s.printed_at);
  if (!unprinted.length && !layout.labels) return;
  if (!confirm(`Did the ${slips.length > 1 ? slips.length + " slips" : "slip"} print OK?\n\nOK = take them out of the print tray.\nCancel = keep them in the tray to print again.`)) return;
  if (layout.labels) {
    printSettings.labelStart = ((printSettings.labelStart - 1 + slips.length) % 10) + 1;
    savePrintSettings();
  }
  if (unprinted.length) {
    await post("/api/slips/printed/", { ids: unprinted.map((s) => s.id), printed: true });
    await refreshSlips();
  }
}

const trayItems = () => state.slips.filter((s) => !s.printed_at && !s.discarded_at).sort((a, b) => a.id - b.id);

function trayFill(n) {
  const layout = LAYOUTS[printSettings.layout];
  const room = layout.perPage - firstPageSkip();
  if (n <= room) return `${n} of ${room} spots on the ${layout.labels ? "sheet" : "page"}`;
  const pages = 1 + Math.ceil((n - room) / layout.perPage);
  return `${n} slips → ${pages} ${layout.labels ? "sheets" : "pages"}`;
}

function renderTrayButton() {
  const n = trayItems().length;
  $("#btn-tray").textContent = n ? `Print tray (${n})` : "Print tray";
  $("#btn-tray").title = n ? trayFill(n) : "Saved slips wait here until you print";
  $("#btn-tray").classList.toggle("has-items", n > 0);
}

function openTray() {
  const items = trayItems();
  $("#tray-info").textContent = items.length
    ? `${trayFill(items.length)} · ${LAYOUTS[printSettings.layout].name}`
    : "The tray is empty. Slips saved with “Save to tray” wait here until you print.";
  $("#tray-list").innerHTML = items.map((s) => `
    <li><div><b>${esc(slipTitle(s))}</b><span>Pull ${fmtShort(new Date(s.pull_at))} · ${esc(s.initials)}</span></div>
    <button type="button" class="btn small ghost" data-untray="${s.id}" title="Take out of the tray without printing">Remove</button></li>`).join("");
  $("#btn-tray-print").disabled = !items.length;
  if (!$("#dlg-tray").open) $("#dlg-tray").showModal();
}

function openPrintSettings() {
  $("#layout-options").innerHTML = Object.entries(LAYOUTS).map(([k, l]) => `
    <label class="layout-opt">
      <input type="radio" name="layout" value="${k}" ${k === printSettings.layout ? "checked" : ""}>
      <span class="mini mini-${k}">${"<i></i>".repeat(l.perPage)}</span>
      <span><b>${esc(l.name)}</b><small>${esc(l.desc)}</small></span>
    </label>`).join("");
  $("#label-start").value = printSettings.labelStart;
  updateLabelRow();
  $("#dlg-print-settings").showModal();
}
function updateLabelRow() {
  const chosen = document.querySelector("input[name=layout]:checked")?.value;
  $("#row-label-start").hidden = !LAYOUTS[chosen]?.labels;
}

/* ---------- actions ---------- */
const selectedSlips = () => state.slips.filter((s) => state.selected.has(s.id));

async function discard(slips) {
  const live = slips.filter((s) => !s.discarded_at);
  if (!live.length) return false;
  const who = askInitials(`discarding ${live.length} slip${live.length > 1 ? "s" : ""}`);
  if (!who) return false;
  await post("/api/slips/discard/", { ids: live.map((s) => s.id), initials: who });
  live.forEach((s) => state.selected.delete(s.id));
  await refreshSlips();
  return true;
}

async function replace(slips, { print = true } = {}) {
  const live = slips.filter((s) => !s.discarded_at);
  if (!live.length) return;
  const timeBased = live.every((s) => slipProducts(s).every((p) => p.basis === "time_in"));
  if (!timeBased) {
    // Frozen / seasoned chicken need a new defrost or kill date, so ask for it.
    if (!(await discard(live))) return;
    openNew([...new Set(live.flatMap((s) => s.product_ids))]);
    return;
  }
  const who = askInitials(`replacing ${live.length} slip${live.length > 1 ? "s" : ""}`);
  if (!who) return;
  const created = [];
  for (const s of live) {
    const res = await post("/api/slips/create/", { product_ids: s.product_ids, initials: who, combine: true, quantity: 1 });
    created.push(...res.slips);
  }
  await post("/api/slips/discard/", { ids: live.map((s) => s.id), initials: who });
  state.selected.clear();
  await refreshSlips();
  if (print) await printSlips(created); // otherwise the new slips wait in the print tray
}

async function restore(slip) {
  await post("/api/slips/restore/", { ids: [slip.id] });
  await refreshSlips();
}

async function setInTray(ids, inTray) {
  await post("/api/slips/printed/", { ids, printed: !inTray });
  await refreshSlips();
}

/* ---------- view one slip ---------- */
function openView(id) {
  const s = state.slips.find((x) => x.id === id);
  if (!s) return;
  const holder = $("#view-slip");
  holder.innerHTML = LAYOUTS[printSettings.layout].html(s);
  holder.className = `layout-${printSettings.layout}`;
  const st = status(s);
  $("#view-actions").innerHTML = `
    <button class="btn ghost" value="cancel">Close</button>
    ${st === "discarded"
      ? `<button class="btn" type="button" data-act="restore">Put back on board</button>`
      : `<button class="btn danger" type="button" data-act="discard">Discard</button>
         <button class="btn" type="button" data-act="tray">${s.printed_at ? "+ Add to tray" : "&#10003; In tray (remove)"}</button>
         <button class="btn" type="button" data-act="replace-save">Replace &amp; save</button>
         <button class="btn" type="button" data-act="replace">Replace &amp; reprint</button>`}
    <button class="btn primary" type="button" data-act="print">Print</button>`;
  $("#view-actions").onclick = async (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    try {
      if (act === "print") await printSlips([s]);
      if (act === "discard" && (await discard([s]))) $("#dlg-view").close();
      if (act === "replace") { $("#dlg-view").close(); await replace([s]); }
      if (act === "replace-save") { $("#dlg-view").close(); await replace([s], { print: false }); }
      if (act === "tray") { await setInTray([s.id], !!s.printed_at); $("#dlg-view").close(); }
      if (act === "restore") { await restore(s); $("#dlg-view").close(); }
    } catch (err) { alert(err.message); }
  };
  $("#dlg-view").showModal();
  fitPaper(holder.firstElementChild);
}

/* ---------- new slip ---------- */
function openNew(preselect = []) {
  state.newSel = new Set(preselect.filter((id) => productById(id)?.active));
  $("#new-title").textContent = preselect.length ? "Replace slip" : "New Slip";
  $("#new-initials").value = lastInitials();
  $("#new-time-in").value = toLocalInput(new Date());
  $("#new-defrost").value = toDateInput(new Date());
  $("#new-kill").value = "";
  $("#new-qty").value = 1;
  $("#new-combine").checked = true;
  $("#picker-search").value = "";
  $("#new-error").textContent = "";
  renderPicker();
  updateNew();
  $("#dlg-new").showModal();
  if (!$("#new-initials").value) $("#new-initials").focus();
}

// Slips still on the board that include this product, soonest pull first.
const onBoard = (pid) =>
  state.slips.filter((s) => !s.discarded_at && s.product_ids.includes(pid)).sort((a, b) => new Date(a.pull_at) - new Date(b.pull_at));
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

function renderPicker() {
  const q = $("#picker-search").value.trim().toLowerCase();
  $("#picker").innerHTML = state.groups.map(({ key, label }) => {
    const items = state.products.filter(
      (p) => p.active && p.group === key && (!q || productLabel(p).toLowerCase().includes(q))
    );
    if (!items.length) return "";
    return `<h4>${esc(label)}</h4><div class="pgrid">${items.map((p) => `
      <button type="button" class="pbtn ${state.newSel.has(p.id) ? "on" : ""}" data-pid="${p.id}">
        <b>${esc(p.name)}</b><small>${esc(p.note ? p.note + " · " : "")}${esc(p.shelf_life)}</small>
        ${onBoard(p.id).length ? `<span class="onboard">${onBoard(p.id).length} on board</span>` : ""}
      </button>`).join("")}</div>`;
  }).join("") || `<p class="empty">No product matches.</p>`;
}

function newBatches() {
  const chosen = [...state.newSel].map(productById).filter(Boolean);
  const sameRule = chosen.length > 1 && new Set(chosen.map(ruleKey)).size === 1;
  const combine = sameRule && $("#new-combine").checked;
  return { chosen, sameRule, batches: combine ? [chosen] : chosen.map((p) => [p]) };
}

function updateNew() {
  const { chosen, sameRule, batches } = newBatches();
  $("#row-defrost").hidden = !chosen.some((p) => p.basis === "defrost");
  $("#row-kill").hidden = !chosen.some((p) => p.basis === "kill");
  $("#row-combine").hidden = !sameRule;
  const timeIn = new Date($("#new-time-in").value);
  const qty = Math.max(1, Number($("#new-qty").value) || 1);
  if (!chosen.length) {
    $("#new-preview").innerHTML = `<p class="hint">Tap the products you made.</p>`;
    return;
  }
  const rows = batches.map((b) => {
    const pull = isNaN(timeIn) ? null : computePull(b[0], timeIn, $("#new-defrost").value, $("#new-kill").value);
    return `<li><b>${esc(b.map(productLabel).join(", "))}</b>
      <span>${pull ? "Pull " + fmtShort(pull) : b[0].basis === "kill" ? "Enter kill date" : "Enter defrost date"}</span></li>`;
  }).join("");
  const total = batches.length * qty;
  const warnings = chosen.map((p) => {
    const existing = onBoard(p.id);
    if (!existing.length) return "";
    const first = ordinal(existing.length + 1), last = ordinal(existing.length + qty);
    return `<p class="warn"><b>Heads-up:</b> ${existing.length} ${esc(productLabel(p))} already on the board
      (pull ${fmtShort(new Date(existing[0].pull_at))}${existing.length > 1 ? ", …" : ""}).
      This will be the ${qty > 1 ? `${first}–${last}` : first}.</p>`;
  }).join("");
  $("#new-preview").innerHTML = `${warnings}<ul>${rows}</ul><p class="hint">${total} slip${total > 1 ? "s" : ""} will be created.</p>`;
}

async function saveNew(andPrint) {
  const { chosen } = newBatches();
  const initials = $("#new-initials").value.trim().toUpperCase();
  const err = $("#new-error");
  err.textContent = "";
  if (!chosen.length) return (err.textContent = "Pick at least one product.");
  if (!initials) return (err.textContent = "Enter your initials.");
  rememberInitials(initials);
  try {
    const res = await post("/api/slips/create/", {
      product_ids: chosen.map((p) => p.id),
      initials,
      time_in: $("#new-time-in").value,
      defrost_start: $("#row-defrost").hidden ? null : $("#new-defrost").value,
      kill_date: $("#row-kill").hidden ? null : $("#new-kill").value,
      quantity: Number($("#new-qty").value) || 1,
      combine: $("#new-combine").checked,
    });
    $("#dlg-new").close();
    await refreshSlips();
    if (andPrint) await printSlips(res.slips);
  } catch (e) {
    err.textContent = e.message;
  }
}

/* ---------- products (admin) ---------- */
const opt = (pairs, val) => pairs.map(([k, l]) => `<option value="${k}" ${k === val ? "selected" : ""}>${l}</option>`).join("");
const BASIS = [["time_in", "Time in"], ["defrost", "Defrost start"], ["kill", "Kill date"]];
const UNITS = [["hours", "hours"], ["days", "days"], ["weeks", "weeks"]];

function productRow(p) {
  return `<tr data-id="${p.id ?? ""}">
    <td><input data-f="name" value="${esc(p.name)}" placeholder="Name"></td>
    <td><input data-f="note" value="${esc(p.note)}" placeholder="optional"></td>
    <td><select data-f="group">${opt(state.groups.map((g) => [g.key, g.label]), p.group)}</select></td>
    <td><select data-f="basis">${opt(BASIS, p.basis)}</select></td>
    <td class="dur"><input data-f="duration_value" type="number" min="1" value="${p.duration_value}"><select data-f="duration_unit">${opt(UNITS, p.duration_unit)}</select></td>
    <td><input data-f="sort_order" type="number" min="0" value="${p.sort_order}" class="num"></td>
    <td><input data-f="active" type="checkbox" ${p.active ? "checked" : ""}></td>
    <td class="row-actions"><button type="button" class="btn small" data-save>Save</button>
      <button type="button" class="btn small danger" data-delete title="Delete this product">Delete</button></td>
  </tr>`;
}

function renderProducts() {
  $("#products-body").innerHTML = state.products.map(productRow).join("");
}

async function deleteProductRow(tr) {
  const id = Number(tr.dataset.id);
  if (!id) return tr.remove(); // a new row that was never saved
  const p = productById(id);
  if (!confirm(`Delete “${productLabel(p)}” for good?\n\nIt will disappear from New Slip and the printed form. This can't be undone.\n(To hide it for now instead, untick Active.)`)) return;
  try {
    await post(`/api/products/${id}/delete/`, {});
    state.products = state.products.filter((x) => x.id !== id);
    tr.remove();
    render();
  } catch (e) {
    alert(e.message); // the list is long, so a message at the bottom could be missed
  }
}

async function saveProductRow(tr) {
  const body = {};
  tr.querySelectorAll("[data-f]").forEach((el) => {
    body[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value;
  });
  const id = tr.dataset.id;
  const btn = tr.querySelector("[data-save]");
  $("#products-error").textContent = "";
  try {
    const { product } = await post(id ? `/api/products/${id}/` : "/api/products/create/", body);
    const i = state.products.findIndex((p) => p.id === product.id);
    if (i >= 0) state.products[i] = product; else state.products.push(product);
    tr.dataset.id = product.id;
    btn.textContent = "Saved ✓";
    setTimeout(() => (btn.textContent = "Save"), 1500);
    render();
  } catch (e) {
    $("#products-error").textContent = e.message;
  }
}

/* ---------- wiring ---------- */
function setFilter(f) {
  state.filter = f;
  render();
}

$("#username").textContent = DATA.username;
$("#btn-products").hidden = !state.isAdmin;
$("#group-filter").innerHTML += state.groups.map((g) => `<option value="${g.key}">${esc(g.label)}</option>`).join("");

$("#summary").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (b) setFilter(b.dataset.filter);
});
$("#status-filter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (b) setFilter(b.dataset.filter);
});
$("#group-filter").addEventListener("change", (e) => { state.group = e.target.value; render(); });
$("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });

$("#board").addEventListener("click", (e) => {
  const step = e.target.closest("[data-step], [data-goto]");
  if (step) {
    const stack = step.closest(".stack");
    const k = stack.dataset.key, n = Number(stack.dataset.n);
    const i = step.dataset.goto !== undefined
      ? Number(step.dataset.goto)
      : (stackFront(k, n) + Number(step.dataset.step) + n) % n;
    state.stackPos.set(k, { i, t: Date.now() });
    render();
    return;
  }
  const card = e.target.closest(".card");
  if (!card) return;
  const id = Number(card.dataset.id);
  const trayBtn = e.target.closest("[data-tray]");
  if (trayBtn) {
    setInTray([id], trayBtn.dataset.tray === "add").catch((err) => alert(err.message));
  } else if (e.target.closest(".pick")) {
    if (e.target.tagName !== "INPUT") return; // label click re-fires on the input
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    render();
  } else {
    openView(id);
  }
});
$("#board").addEventListener("keydown", (e) => {
  const card = e.target.closest(".card");
  if (card && e.key === "Enter") openView(Number(card.dataset.id));
});

$("#btn-new").onclick = () => openNew();
$("#btn-select-expired").onclick = () => {
  state.slips.filter((s) => status(s) === "expired").forEach((s) => state.selected.add(s.id));
  if (state.filter !== "active" && state.filter !== "expired") state.filter = "expired";
  render();
};
$("#btn-clear").onclick = () => { state.selected.clear(); render(); };
$("#btn-print").onclick = () => printSlips(selectedSlips()).catch((e) => alert(e.message));
$("#btn-to-tray").onclick = async () => {
  const live = selectedSlips().filter((s) => !s.discarded_at);
  if (!live.length) return;
  try {
    await setInTray(live.map((s) => s.id), true);
    state.selected.clear();
    render();
  } catch (e) { alert(e.message); }
};
$("#btn-tray").onclick = openTray;
$("#btn-tray-print").onclick = async () => {
  $("#dlg-tray").close();
  try { await printSlips(trayItems()); } catch (e) { alert(e.message); }
};
$("#tray-list").addEventListener("click", async (e) => {
  const id = Number(e.target.dataset.untray);
  if (!id) return;
  try {
    await post("/api/slips/printed/", { ids: [id], printed: true });
    await refreshSlips();
    openTray();
  } catch (err) { alert(err.message); }
});
$("#btn-print-settings").onclick = openPrintSettings;
$("#layout-options").addEventListener("change", updateLabelRow);
$("#btn-print-settings-save").onclick = () => {
  printSettings.layout = document.querySelector("input[name=layout]:checked").value;
  printSettings.labelStart = Math.min(10, Math.max(1, Number($("#label-start").value) || 1));
  savePrintSettings();
  $("#dlg-print-settings").close();
  render();
};
$("#btn-discard").onclick = () => discard(selectedSlips()).catch((e) => alert(e.message));
$("#btn-replace").onclick = () => replace(selectedSlips()).catch((e) => alert(e.message));
$("#btn-replace-save").onclick = () => replace(selectedSlips(), { print: false }).catch((e) => alert(e.message));

$("#picker").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pid]");
  if (!b) return;
  const id = Number(b.dataset.pid);
  state.newSel.has(id) ? state.newSel.delete(id) : state.newSel.add(id);
  b.classList.toggle("on");
  updateNew();
});
$("#picker-search").addEventListener("input", renderPicker);
["#new-time-in", "#new-defrost", "#new-kill", "#new-qty", "#new-combine"].forEach((s) =>
  $(s).addEventListener("input", updateNew)
);
$("#btn-save").onclick = () => saveNew(false);
$("#btn-save-print").onclick = () => saveNew(true);

$("#btn-products").onclick = () => { renderProducts(); $("#dlg-products").showModal(); };
$("#products-body").addEventListener("click", (e) => {
  if (e.target.matches("[data-save]")) saveProductRow(e.target.closest("tr"));
  if (e.target.matches("[data-delete]")) deleteProductRow(e.target.closest("tr"));
});
$("#btn-add-product").onclick = () => {
  $("#products-body").insertAdjacentHTML("beforeend", productRow({
    name: "", note: "", group: "prep", basis: "time_in", duration_value: 1, duration_unit: "days", sort_order: 999, active: true,
  }));
  $("#products-body tr:last-child input").focus();
};

function tick() {
  const now = new Date();
  $("#clock").textContent = `${fmtDate(now)} · ${fmtTime(now)}`;
  render();
}
tick();
setInterval(tick, 30 * 1000); // colours change on time without reloading
setInterval(refreshSlips, 60 * 1000); // pick up slips added on other devices
