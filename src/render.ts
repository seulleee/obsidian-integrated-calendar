/*
 * render.ts — 달력(월/주/일) + 아젠다 렌더링. 구독 + 로컬 일정 + 할일 통합.
 * DOM API(createEl 등)로만 그립니다 (innerHTML 미사용).
 */
import { App, moment } from "obsidian";
import type { ICSettings } from "./settings";
import { fetchExternal, CalEvent, SourceError, FetchFn, ParsedSource } from "./ics";
import { getLocalEvents, getDueTasks } from "./data";

export interface RenderCtx {
  app: App;
  settings: ICSettings;
  fetch: FetchFn;
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

  try { getLocalEvents(ctx.app, ctx.settings, startISO, endISO).forEach(push); } catch (e) { /* ignore */ }

  const ext = await fetchExternal(enabledSources(ctx.settings), ctx.fetch, startISO, endISO);
  for (const e of ext) {
    if ((e as SourceError).error) errs.push(e as SourceError);
    else push(e as CalEvent);
  }

  let tkMap: Record<string, string[]> = {};
  try { tkMap = await getDueTasks(ctx.app, ctx.settings, startISO, endISO); } catch (e) { /* ignore */ }

  return { evMap, tkMap, errs };
}

function weekdayLabels(mondayFirst: boolean): string[] {
  const base = ["일", "월", "화", "수", "목", "금", "토"];
  return mondayFirst ? base.slice(1).concat(base[0]) : base;
}

function dowClassFor(col: number, mondayFirst: boolean): string {
  const realDow = mondayFirst ? (col + 1) % 7 : col;
  return realDow === 0 ? "ic-sun" : realDow === 6 ? "ic-sat" : "";
}

function buildMonth(parent: HTMLElement, anchor: any, c: Collected, today: any, mondayFirst: boolean): void {
  const year = anchor.year(), month = anchor.month() + 1;
  const numDays = anchor.clone().endOf("month").date();
  const firstDow = anchor.clone().startOf("month").day();
  const startCol = mondayFirst ? (firstDow + 6) % 7 : firstDow;
  const pad = (n: number) => String(n).padStart(2, "0");
  const cells: (number | null)[] = [];
  for (let i = 0; i < startCol; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const wd = weekdayLabels(mondayFirst);
  const table = parent.createEl("table", { cls: "ic-mcal" });
  const htr = table.createEl("thead").createEl("tr");
  wd.forEach((w, i) => htr.createEl("th", { text: w, cls: dowClassFor(i, mondayFirst) }));
  const tbody = table.createEl("tbody");
  let tr = tbody.createEl("tr");

  cells.forEach((d, idx) => {
    if (idx > 0 && idx % 7 === 0) tr = tbody.createEl("tr");
    const col = idx % 7;
    const colCls = dowClassFor(col, mondayFirst);
    if (d === null) { tr.createEl("td", { cls: colCls }); return; }
    const key = `${year}-${pad(month)}-${pad(d)}`;
    const isToday = today.year() === year && today.month() + 1 === month && today.date() === d;
    const evs = c.evMap[key] || [];
    const tc = (c.tkMap[key] || []).length;
    const td = tr.createEl("td", { cls: isToday ? "ic-today" : colCls });
    td.createEl("div", { cls: "ic-num", text: String(d) });
    evs.slice(0, 3).forEach((ev) => {
      const e = td.createEl("div", { cls: "ic-ev", text: ev.title });
      e.style.borderLeftColor = ev.color;
      e.setAttr("title", ev.title);
    });
    if (evs.length > 3) td.createEl("div", { cls: "ic-ev ic-more", text: `+${evs.length - 3} 더` });
    if (tc > 0) td.createEl("div", { cls: "ic-tsk", text: `✅ ${tc}건` });
  });
}

function buildAgenda(parent: HTMLElement, sM: any, eM: any, c: Collected, today: any): void {
  const KWD = ["일", "월", "화", "수", "목", "금", "토"];
  let cur = sM.clone(), g = 0;
  while (cur.isSameOrBefore(eM, "day") && g < 60) {
    const key = cur.format("YYYY-MM-DD");
    const isToday = cur.isSame(today, "day");
    const wkCls = cur.day() === 0 ? "ic-sun" : cur.day() === 6 ? "ic-sat" : "";
    const evs = (c.evMap[key] || []).slice().sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.time || "").localeCompare(b.time || "");
    });
    const tks = c.tkMap[key] || [];

    const day = parent.createEl("div", { cls: "ic-ag-day" + (isToday ? " ic-today" : "") });
    day.createEl("div", {
      cls: ("ic-ag-dh " + wkCls + (isToday ? " ic-today" : "")).trim(),
      text: `${cur.format("M월 D일")} (${KWD[cur.day()]})${isToday ? " · 오늘" : ""}`,
    });
    if (!evs.length && !tks.length) day.createEl("div", { cls: "ic-ag-empty", text: "일정·할일 없음" });
    evs.forEach((ev) => {
      const when = ev.multiday ? "연속" : ev.allDay ? "종일" : ev.time;
      const row = day.createEl("div", { cls: "ic-ag-row" });
      row.createEl("span", { cls: "ic-ag-time", text: `${ev.icon} ${when}` });
      const dot = row.createEl("span", { cls: "ic-ag-dot", text: ev.title });
      dot.style.borderLeftColor = ev.color;
    });
    tks.forEach((t) => {
      const row = day.createEl("div", { cls: "ic-ag-row" });
      row.createEl("span", { cls: "ic-ag-time", text: "✅ 할일" });
      row.createEl("span", { cls: "ic-ag-dot ic-task", text: t });
    });
    cur.add(1, "day"); g++;
  }
}

function buildLegend(parent: HTMLElement, settings: ICSettings): void {
  const el = parent.createDiv({ cls: "ic-legend" });
  el.createSpan({ text: `${settings.localIcon} ${settings.localName}` });
  settings.sources.filter((s) => s.enabled).forEach((s) => el.createSpan({ text: ` · ${s.icon} ${s.name || "구독"}` }));
  el.createSpan({ text: " · ✅ 할일" });
}

function showErrors(parent: HTMLElement, errs: SourceError[]): void {
  if (errs.length) parent.createEl("div", { cls: "ic-err", text: "⚠️ " + errs.map((e) => e.source + ": " + e.message).join(" / ") });
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
  buildLegend(el, ctx.settings);
  const bodyEl = el.createDiv({ cls: "ic-body" });

  const setActive = () => {
    ([["month", btnMonth], ["week", btnWeek], ["day", btnDay]] as [string, HTMLElement][])
      .forEach(([v, b]) => b.toggleClass("ic-active", view === v));
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
      bodyEl.empty();
      if (view === "month") buildMonth(bodyEl, anchor, c, today, ctx.settings.firstDayMonday);
      else buildAgenda(bodyEl, sM, eM, c, today);
      showErrors(bodyEl, c.errs);
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
  if (s === "week") { sM = today.clone().startOf("week"); eM = today.clone().endOf("week"); }
  else if (/^\d+$/.test(s)) { eM = today.clone().add(parseInt(s, 10), "days").endOf("day"); }

  buildLegend(el, ctx.settings);
  const bodyEl = el.createDiv({ cls: "ic-body" });
  bodyEl.createDiv({ cls: "ic-loading", text: "불러오는 중…" });
  try {
    const c = await collect(ctx, sM.format("YYYY-MM-DD"), eM.format("YYYY-MM-DD"));
    bodyEl.empty();
    buildAgenda(bodyEl, sM, eM, c, today);
    showErrors(bodyEl, c.errs);
  } catch (e: any) {
    bodyEl.empty();
    bodyEl.createDiv({ cls: "ic-err", text: "⚠️ " + (e?.message || String(e)) });
  }
}
