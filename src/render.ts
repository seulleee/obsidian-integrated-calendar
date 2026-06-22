/*
 * render.ts — 달력(월/주/일) + 아젠다 렌더링. 구독 + 로컬 일정 + 할일 통합.
 */
import { App, moment } from "obsidian";
import type { ICSettings, CalendarSource } from "./settings";
import { fetchExternal, CalEvent, SourceError, FetchFn, ParsedSource } from "./ics";
import { getLocalEvents, getDueTasks } from "./data";

export interface RenderCtx {
  app: App;
  settings: ICSettings;
  fetch: FetchFn;
}

function esc(s: any): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function enabledSources(settings: ICSettings): ParsedSource[] {
  return settings.sources.filter((s) => s.enabled && s.url).map((s) => ({ name: s.name || "구독", color: s.color, icon: s.icon, url: s.url }));
}

interface Collected {
  evMap: Record<string, CalEvent[]>;
  tkMap: Record<string, string[]>;
  errs: SourceError[];
}

async function collect(ctx: RenderCtx, startISO: string, endISO: string): Promise<Collected> {
  const evMap: Record<string, CalEvent[]> = {};
  const errs: SourceError[] = [];
  const push = (e: CalEvent) => { (evMap[e.date] = evMap[e.date] || []).push(e); };

  // 로컬 일정
  try { getLocalEvents(ctx.app, ctx.settings, startISO, endISO).forEach(push); } catch (e) { /* ignore */ }

  // 구독 일정
  const ext = await fetchExternal(enabledSources(ctx.settings), ctx.fetch, startISO, endISO);
  for (const e of ext) {
    if ((e as SourceError).error) errs.push(e as SourceError);
    else push(e as CalEvent);
  }

  // 할일
  let tkMap: Record<string, string[]> = {};
  try { tkMap = await getDueTasks(ctx.app, ctx.settings, startISO, endISO); } catch (e) { /* ignore */ }

  return { evMap, tkMap, errs };
}

function weekdayLabels(mondayFirst: boolean): string[] {
  const base = ["일", "월", "화", "수", "목", "금", "토"];
  return mondayFirst ? base.slice(1).concat(base[0]) : base;
}

function monthGrid(anchor: any, c: Collected, today: any, mondayFirst: boolean): string {
  const year = anchor.year(), month = anchor.month() + 1;
  const numDays = anchor.clone().endOf("month").date();
  const firstDow = anchor.clone().startOf("month").day(); // 0=일
  const startCol = mondayFirst ? (firstDow + 6) % 7 : firstDow;
  const pad = (n: number) => String(n).padStart(2, "0");
  const cells: (number | null)[] = [];
  for (let i = 0; i < startCol; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const wd = weekdayLabels(mondayFirst);
  const dowClass = (col: number) => {
    const realDow = mondayFirst ? (col + 1) % 7 : col;
    return realDow === 0 ? "ic-sun" : realDow === 6 ? "ic-sat" : "";
  };

  let html = `<table class="ic-mcal"><thead><tr>`;
  wd.forEach((w, i) => (html += `<th class="${dowClass(i)}">${w}</th>`));
  html += `</tr></thead><tbody><tr>`;
  cells.forEach((d, idx) => {
    if (idx > 0 && idx % 7 === 0) html += `</tr><tr>`;
    const col = idx % 7;
    const colCls = dowClass(col);
    if (d === null) { html += `<td class="${colCls}"></td>`; return; }
    const key = `${year}-${pad(month)}-${pad(d)}`;
    const isToday = today.year() === year && today.month() + 1 === month && today.date() === d;
    const evs = c.evMap[key] || [];
    const tc = (c.tkMap[key] || []).length;
    let inner = `<div class="ic-num">${d}</div>`;
    evs.slice(0, 3).forEach((ev) =>
      inner += `<div class="ic-ev" style="border-left-color:${ev.color}" title="${esc(ev.title)}">${esc(ev.title)}</div>`);
    if (evs.length > 3) inner += `<div class="ic-ev ic-more">+${evs.length - 3} 더</div>`;
    if (tc > 0) inner += `<div class="ic-tsk">✅ ${tc}건</div>`;
    html += `<td class="${isToday ? "ic-today" : colCls}">${inner}</td>`;
  });
  return html + `</tr></tbody></table>`;
}

function agendaGrid(sM: any, eM: any, c: Collected, today: any): string {
  const KWD = ["일", "월", "화", "수", "목", "금", "토"];
  let html = "", cur = sM.clone(), g = 0;
  while (cur.isSameOrBefore(eM, "day") && g < 60) {
    const key = cur.format("YYYY-MM-DD");
    const isToday = cur.isSame(today, "day");
    const wkCls = cur.day() === 0 ? "ic-sun" : cur.day() === 6 ? "ic-sat" : "";
    const evs = (c.evMap[key] || []).slice().sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.time || "").localeCompare(b.time || "");
    });
    const tks = c.tkMap[key] || [];
    html += `<div class="ic-ag-day${isToday ? " ic-today" : ""}">`;
    html += `<div class="ic-ag-dh ${wkCls}${isToday ? " ic-today" : ""}">${cur.format("M월 D일")} (${KWD[cur.day()]})${isToday ? " · 오늘" : ""}</div>`;
    if (!evs.length && !tks.length) html += `<div class="ic-ag-empty">일정·할일 없음</div>`;
    evs.forEach((ev) => {
      const when = ev.multiday ? "연속" : ev.allDay ? "종일" : ev.time;
      html += `<div class="ic-ag-row"><span class="ic-ag-time">${ev.icon} ${when}</span><span class="ic-ag-dot" style="border-left-color:${ev.color}">${esc(ev.title)}</span></div>`;
    });
    tks.forEach((t) => {
      html += `<div class="ic-ag-row"><span class="ic-ag-time">✅ 할일</span><span class="ic-ag-dot ic-task">${esc(t)}</span></div>`;
    });
    html += `</div>`;
    cur.add(1, "day"); g++;
  }
  return html;
}

function legend(settings: ICSettings): string {
  const parts = [`${settings.localIcon} ${esc(settings.localName)}`]
    .concat(settings.sources.filter((s) => s.enabled).map((s) => `${s.icon} ${esc(s.name || "구독")}`))
    .concat(["✅ 할일"]);
  return parts.join(" · ");
}

// 월/주/일 전환 인터랙티브 달력
export async function renderCalendar(el: HTMLElement, ctx: RenderCtx, initialView?: string): Promise<void> {
  const today = moment().startOf("day");
  let view = initialView || "month";
  let anchor = moment().startOf("day");

  el.empty();
  el.addClass("ic-cal");
  const bar = el.createDiv({ cls: "ic-bar" });
  const btnPrev = bar.createEl("button", { text: "‹" });
  const btnToday = bar.createEl("button", { text: "오늘" });
  const btnNext = bar.createEl("button", { text: "›" });
  const titleEl = bar.createEl("span", { cls: "ic-title" });
  const btnMonth = bar.createEl("button", { text: "월" });
  const btnWeek = bar.createEl("button", { text: "주" });
  const btnDay = bar.createEl("button", { text: "일" });
  const legendEl = el.createDiv({ cls: "ic-legend", text: legend(ctx.settings) });
  const bodyEl = el.createDiv({ cls: "ic-body" });

  const setActive = () => {
    [["month", btnMonth], ["week", btnWeek], ["day", btnDay]].forEach(([v, b]) =>
      (b as HTMLElement).toggleClass("ic-active", view === v));
  };

  const draw = async () => {
    setActive();
    let sM, eM, title;
    if (view === "month") { sM = anchor.clone().startOf("month"); eM = anchor.clone().endOf("month"); title = anchor.format("YYYY년 M월"); }
    else if (view === "week") { sM = anchor.clone().startOf("week"); eM = anchor.clone().endOf("week"); title = sM.format("M.D") + " ~ " + eM.format("M.D"); }
    else { sM = anchor.clone().startOf("day"); eM = anchor.clone().endOf("day"); title = anchor.format("YYYY년 M월 D일 (ddd)"); }
    titleEl.setText(title);
    bodyEl.empty();
    bodyEl.createDiv({ cls: "ic-loading", text: "불러오는 중…" });
    try {
      const c = await collect(ctx, sM.format("YYYY-MM-DD"), eM.format("YYYY-MM-DD"));
      const html = view === "month" ? monthGrid(anchor, c, today, ctx.settings.firstDayMonday) : agendaGrid(sM, eM, c, today);
      bodyEl.empty();
      bodyEl.innerHTML = html;
      if (c.errs.length) bodyEl.createDiv({ cls: "ic-err", text: "⚠️ " + c.errs.map((e) => e.source + ": " + e.message).join(" / ") });
    } catch (e: any) {
      bodyEl.empty();
      bodyEl.createDiv({ cls: "ic-err", text: "⚠️ " + (e?.message || String(e)) });
    }
  };

  const unit = () => (view === "month" ? "months" : view === "week" ? "weeks" : "days");
  btnPrev.onclick = () => { anchor = anchor.clone().subtract(1, unit() as any); draw(); };
  btnNext.onclick = () => { anchor = anchor.clone().add(1, unit() as any); draw(); };
  btnToday.onclick = () => { anchor = moment().startOf("day"); draw(); };
  btnMonth.onclick = () => { view = "month"; draw(); };
  btnWeek.onclick = () => { view = "week"; draw(); };
  btnDay.onclick = () => { view = "day"; draw(); };

  await draw();
}

// 아젠다 목록: spec = "today" | "week" | 숫자(앞으로 N일)
export async function renderAgenda(el: HTMLElement, ctx: RenderCtx, spec: string): Promise<void> {
  el.empty();
  el.addClass("ic-cal");
  const today = moment().startOf("day");
  let sM = today.clone(), eM = today.clone().endOf("day");
  const s = (spec || "today").trim();
  if (s === "today") { /* 오늘 */ }
  else if (s === "week") { sM = today.clone().startOf("week"); eM = today.clone().endOf("week"); }
  else if (/^\d+$/.test(s)) { eM = today.clone().add(parseInt(s, 10), "days").endOf("day"); }

  el.createDiv({ cls: "ic-legend", text: legend(ctx.settings) });
  const bodyEl = el.createDiv({ cls: "ic-body" });
  bodyEl.createDiv({ cls: "ic-loading", text: "불러오는 중…" });
  try {
    const c = await collect(ctx, sM.format("YYYY-MM-DD"), eM.format("YYYY-MM-DD"));
    bodyEl.empty();
    bodyEl.innerHTML = agendaGrid(sM, eM, c, today);
    if (c.errs.length) bodyEl.createDiv({ cls: "ic-err", text: "⚠️ " + c.errs.map((e) => e.source + ": " + e.message).join(" / ") });
  } catch (e: any) {
    bodyEl.empty();
    bodyEl.createDiv({ cls: "ic-err", text: "⚠️ " + (e?.message || String(e)) });
  }
}
