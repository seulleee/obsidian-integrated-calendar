/*
 * data.ts — Obsidian vault 에서 로컬 일정(frontmatter)과 할일(체크박스)을 읽음.
 * Dataview 없이 metadataCache + vault.cachedRead 사용.
 */
import { App, TFile, moment } from "obsidian";
import type { ICSettings } from "./settings";
import type { CalEvent } from "./ics";

function inExcluded(path: string, exclude: string): boolean {
  return exclude.split(",").map((s) => s.trim()).filter(Boolean).some((p) => path.startsWith(p + "/") || path === p);
}

function filesInFolder(app: App, folder: string): TFile[] {
  if (!folder) return [];
  const norm = folder.replace(/\/$/, "");
  return app.vault.getMarkdownFiles().filter((f) => f.path === norm + "/" + f.name || f.path.startsWith(norm + "/"));
}

// 로컬 일정 (frontmatter 기반, 멀티데이 지원)
export function getLocalEvents(app: App, settings: ICSettings, startISO: string, endISO: string): CalEvent[] {
  const winStart = moment(startISO, "YYYY-MM-DD").startOf("day");
  const winEnd = moment(endISO, "YYYY-MM-DD").endOf("day");
  const out: CalEvent[] = [];
  for (const f of filesInFolder(app, settings.eventFolder)) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm || !fm.date) continue;
    if (fm.status === "취소" || fm.status === "cancelled") continue;
    const sd = moment(String(fm.date).slice(0, 10), "YYYY-MM-DD");
    if (!sd.isValid()) continue;
    const ed = fm.endDate ? moment(String(fm.endDate).slice(0, 10), "YYYY-MM-DD") : sd.clone();
    if (ed.isBefore(winStart, "day") || sd.isAfter(winEnd, "day")) continue;
    const allDay = fm.allDay === true || !fm.startTime;
    // 윈도우 안의 각 날짜로 전개 (멀티데이)
    let cur = sd.clone();
    let g = 0;
    while (cur.isSameOrBefore(ed, "day") && g < 400) {
      if (cur.isSameOrAfter(winStart, "day") && cur.isSameOrBefore(winEnd, "day")) {
        const first = cur.isSame(sd, "day");
        const isAllDay = first ? allDay : true;
        const time = first && !allDay ? String(fm.startTime) : "";
        const startM = isAllDay ? cur.clone().startOf("day")
          : moment(cur.format("YYYY-MM-DD") + " " + String(fm.startTime), "YYYY-MM-DD HH:mm");
        out.push({
          start: startM,
          date: cur.format("YYYY-MM-DD"),
          allDay: isAllDay,
          time,
          title: fm.title || f.basename,
          multiday: !first,
          source: settings.localName,
          color: settings.localColor,
          icon: settings.localIcon,
        });
      }
      cur.add(1, "day"); g++;
    }
  }
  return out;
}

const EMOJI_RE = /[📅⏳🛫✅🔁🔺⏫🔼🔽⏬➕]/g;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /^\s*[-*]\s*\[[xX]\]/;
const OPEN_RE = /^\s*[-*]\s*\[ \]/;

// 파일 내용 캐시 (path -> {mtime, lines})
const fileCache: Record<string, { mtime: number; due: { date: string; text: string }[] }> = {};

async function scanFileTasks(app: App, f: TFile): Promise<{ date: string; text: string }[]> {
  const c = fileCache[f.path];
  if (c && c.mtime === f.stat.mtime) return c.due;
  const cache = app.metadataCache.getFileCache(f);
  const listItems = cache?.listItems?.filter((li: any) => li.task !== undefined) || [];
  if (!listItems.length) { fileCache[f.path] = { mtime: f.stat.mtime, due: [] }; return []; }
  const content = await app.vault.cachedRead(f);
  const lines = content.split("\n");
  const due: { date: string; text: string }[] = [];
  for (const li of listItems) {
    if (li.task === "x" || li.task === "X") continue; // 완료 제외
    const line = lines[li.position.start.line] || "";
    const m = line.match(DUE_RE);
    if (!m) continue;
    const text = line.replace(/^\s*[-*]\s*\[.\]\s*/, "").replace(EMOJI_RE, "").replace(/\d{4}-\d{2}-\d{2}/g, "").replace(/\s+/g, " ").trim();
    due.push({ date: m[1], text });
  }
  fileCache[f.path] = { mtime: f.stat.mtime, due };
  return due;
}

// 마감 할일: { "YYYY-MM-DD": [정리된 제목, ...] } (윈도우 범위)
export async function getDueTasks(app: App, settings: ICSettings, startISO: string, endISO: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const f of app.vault.getMarkdownFiles()) {
    if (inExcluded(f.path, settings.taskGlobExclude)) continue;
    const due = await scanFileTasks(app, f);
    for (const d of due) {
      if (d.date >= startISO && d.date <= endISO) (out[d.date] = out[d.date] || []).push(d.text);
    }
  }
  return out;
}
