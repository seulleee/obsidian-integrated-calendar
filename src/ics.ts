/*
 * ics.ts — ICS(iCalendar) 구독 피드 파서 + 반복(RRULE)/멀티데이 전개
 * Obsidian 비의존(테스트 가능). moment 와 fetch 함수는 호출부에서 주입.
 * (검증된 로직을 calendar-ics.js 에서 포팅)
 */
import { moment } from "obsidian";

export interface CalEvent {
  start: any; // moment
  date: string; // YYYY-MM-DD
  allDay: boolean;
  time: string; // "HH:mm" 또는 ""
  title: string;
  multiday: boolean;
  source: string;
  color: string;
  icon: string;
}

export interface SourceError {
  error: true;
  source: string;
  message: string;
}

export type FetchFn = (url: string) => Promise<string>;

function unfold(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseDT(val: string, params: any) {
  const isDate = (params && params.VALUE === "DATE") || /^\d{8}$/.test(val);
  if (isDate) return { m: moment(val.slice(0, 8), "YYYYMMDD"), allDay: true };
  const hasZ = /Z$/.test(val);
  const clean = val.replace(/Z$/, "");
  if (hasZ) return { m: moment.utc(clean, "YYYYMMDDTHHmmss").local(), allDay: false };
  return { m: moment(clean, "YYYYMMDDTHHmmss"), allDay: false }; // floating/TZID → 로컬 벽시계
}

function parseRrule(val: string) {
  const r: any = {};
  val.split(";").forEach((p) => {
    const eq = p.indexOf("=");
    if (eq !== -1) r[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  });
  return r;
}

function parseVevents(text: string): any[] {
  const events: any[] = [];
  let cur: any = null;
  for (const line of text.split("\n")) {
    if (line === "BEGIN:VEVENT") { cur = { ex: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx);
    const val = line.slice(idx + 1);
    const semi = rawKey.indexOf(";");
    const params: any = {};
    let name = rawKey;
    if (semi !== -1) {
      name = rawKey.slice(0, semi);
      rawKey.slice(semi + 1).split(";").forEach((p) => {
        const eq = p.indexOf("=");
        if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
      });
    }
    name = name.toUpperCase();
    if (name === "SUMMARY") cur.summary = unescapeText(val);
    else if (name === "UID") cur.uid = val;
    else if (name === "STATUS") cur.status = val.toUpperCase();
    else if (name === "DTSTART") cur.start = parseDT(val, params);
    else if (name === "DTEND") cur.end = parseDT(val, params);
    else if (name === "RRULE") cur.rrule = parseRrule(val);
    else if (name === "EXDATE") val.split(",").forEach((v) => cur.ex.push(parseDT(v, params).m.format("YYYY-MM-DD")));
    else if (name === "RECURRENCE-ID") cur.recurrenceId = parseDT(val, params).m.format("YYYY-MM-DD");
  }
  return events;
}

// 단일 이벤트가 차지하는 날짜 목록(멀티데이/연속 전개)
function eventDays(ev: any) {
  const s = ev.start.m;
  const allDay = ev.start.allDay;
  if (!ev.end || !ev.end.m || !ev.end.m.isValid()) {
    return [{ m: s.clone(), allDay, cont: false }];
  }
  let lastDay;
  if (allDay) {
    lastDay = ev.end.m.clone().subtract(1, "day"); // 종일 DTEND는 exclusive
  } else {
    const e = ev.end.m.clone();
    lastDay = (e.hour() === 0 && e.minute() === 0 && e.second() === 0) ? e.subtract(1, "second") : e;
  }
  if (lastDay.isBefore(s, "day")) lastDay = s.clone();
  const days: any[] = [];
  let cur = s.clone().startOf("day");
  const end = lastDay.clone().startOf("day");
  let g = 0;
  while (cur.isSameOrBefore(end, "day") && g < 400) {
    const first = cur.isSame(s, "day");
    days.push({ m: first && !allDay ? s.clone() : cur.clone().startOf("day"), allDay: first ? allDay : true, cont: !first });
    cur.add(1, "day");
    g++;
  }
  return days;
}

const DOW: any = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expand(ev: any, winStart: any, winEnd: any, exExtra: any) {
  if (!ev.start) return [];
  const base = ev.start.m;
  if (!base || !base.isValid()) return [];
  const out: any[] = [];

  if (!ev.rrule) {
    for (const day of eventDays(ev)) {
      if (day.m.isSameOrAfter(winStart, "day") && day.m.isSameOrBefore(winEnd, "day")) out.push(day);
    }
    return out;
  }

  const allDay = ev.start.allDay;
  const exSet = new Set<string>([...(ev.ex || []), ...(exExtra ? Array.from(exExtra) : [])] as string[]);
  const keep = (m: any) => { if (!exSet.has(m.format("YYYY-MM-DD"))) out.push({ m: m.clone(), allDay, cont: false }); };

  const r = ev.rrule;
  const freq = r.FREQ;
  const interval = parseInt(r.INTERVAL || "1", 10) || 1;
  const until = r.UNTIL ? parseDT(r.UNTIL, {}).m : null;
  const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
  const byday = r.BYDAY ? r.BYDAY.split(",").map((d: string) => DOW[d.slice(-2)]).filter((n: any) => n !== undefined) : null;
  let produced = 0, guard = 0;
  const MAX = 3000;

  if (freq === "WEEKLY" && byday && byday.length) {
    let weekStart = base.clone().subtract(base.day(), "days");
    while (guard++ < MAX) {
      for (const d of byday.slice().sort((a: number, b: number) => a - b)) {
        const occ = weekStart.clone().add(d, "days").hour(base.hour()).minute(base.minute()).second(0);
        if (occ.isBefore(base, "day")) continue;
        if (count && produced >= count) return out;
        if (until && occ.isAfter(until)) return out;
        if (occ.isAfter(winEnd, "day")) return out;
        produced++;
        if (occ.isSameOrAfter(winStart, "day")) keep(occ);
      }
      weekStart.add(7 * interval, "days");
      if (weekStart.isAfter(winEnd, "day")) break;
    }
    return out;
  }

  const unit = freq === "DAILY" ? "days" : freq === "WEEKLY" ? "weeks"
    : freq === "MONTHLY" ? "months" : freq === "YEARLY" ? "years" : null;
  if (!unit) {
    if (base.isSameOrAfter(winStart, "day") && base.isSameOrBefore(winEnd, "day")) keep(base);
    return out;
  }
  let cursor = base.clone();
  while (guard++ < MAX) {
    if (count && produced >= count) break;
    if (until && cursor.isAfter(until)) break;
    if (cursor.isAfter(winEnd, "day")) break;
    produced++;
    if (cursor.isSameOrAfter(winStart, "day")) keep(cursor);
    cursor.add(interval, unit as any);
  }
  return out;
}

export interface ParsedSource {
  name: string;
  color: string;
  icon: string;
  url: string;
}

// 구독 소스들에서 윈도우 범위 일정 수집. 취소/중복/오버라이드 처리.
export async function fetchExternal(
  sources: ParsedSource[],
  fetchFn: FetchFn,
  startISO: string,
  endISO: string,
): Promise<(CalEvent | SourceError)[]> {
  const winStart = moment(startISO, "YYYY-MM-DD").startOf("day");
  const winEnd = moment(endISO, "YYYY-MM-DD").endOf("day");
  const out: (CalEvent | SourceError)[] = [];
  for (const src of sources) {
    try {
      let vevents = parseVevents(unfold(await fetchFn(src.url)));
      vevents = vevents.filter((e) =>
        e.start && e.status !== "CANCELLED" && !/^\s*(취소됨|cancell?ed)\s*:/i.test(e.summary || ""));
      const overrides: any = {};
      for (const e of vevents) {
        if (e.recurrenceId && e.uid) (overrides[e.uid] = overrides[e.uid] || new Set()).add(e.recurrenceId);
      }
      const seen = new Set<string>();
      for (const ev of vevents) {
        let occs: any[] = [];
        try { occs = expand(ev, winStart, winEnd, ev.uid ? overrides[ev.uid] : null); } catch (e) { occs = []; }
        for (const occ of occs) {
          const dateStr = occ.m.format("YYYY-MM-DD");
          const time = occ.allDay ? "" : occ.m.format("HH:mm");
          const title = ev.summary || "(제목 없음)";
          const key = src.name + "|" + dateStr + "|" + time + "|" + title;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            start: occ.allDay ? occ.m.clone().startOf("day") : occ.m.clone(),
            date: dateStr, allDay: occ.allDay, time, title, multiday: !!occ.cont,
            source: src.name, color: src.color, icon: src.icon,
          });
        }
      }
    } catch (e: any) {
      out.push({ error: true, source: src.name, message: (e && e.message) || String(e) });
    }
  }
  return out;
}
