/*
 * data.ts — Obsidian vault 에서 로컬 일정(frontmatter)과 할일(체크박스)을 읽음.
 * Dataview 없이 metadataCache + vault.cachedRead 사용.
 */
import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import type { ICSettings } from "./settings";
import type { CalEvent } from "./ics";

function inExcluded(path: string, exclude: string): boolean {
  return exclude.split(",").map((s) => normalizePath(s.trim())).filter(Boolean).some((p) => path.startsWith(p + "/") || path === p);
}

function filesInFolder(app: App, folder: string): TFile[] {
  if (!folder) return [];
  const af = app.vault.getAbstractFileByPath(normalizePath(folder));
  if (!(af instanceof TFolder)) return [];
  const out: TFile[] = [];
  const walk = (dir: TFolder) => {
    for (const ch of dir.children) {
      if (ch instanceof TFolder) walk(ch);
      else if (ch instanceof TFile && ch.extension === "md") out.push(ch);
    }
  };
  walk(af);
  return out;
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

/* =========================================================================
 * 할일 대시보드(integrated-tasks)용 — 완료/마감/예정/완료일/우선순위 + 하위 트리
 * ========================================================================= */

export interface DashTask {
  completed: boolean;
  due: string | null; // 📅 YYYY-MM-DD
  scheduled: string | null; // ⏳ YYYY-MM-DD
  completion: string | null; // ✅ YYYY-MM-DD
  priority: string; // 🔺/⏫/🔼/🔽 또는 ""
  text: string; // 정리된 본문(이모지/날짜 제거)
  raw: string; // 원본 라인 그대로
  path: string;
  line: number;
  subtasks: DashTask[];
}

const SCHED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/;
const DONE_DATE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const PRIO_RE = /(🔺|⏫|🔼|🔽|⏬)/;
const TASK_LINE_RE = /^([\t ]*)[-*]\s*\[([ xX])\]\s?(.*)$/;

function indentWidth(indent: string): number {
  // 탭=4칸 가정으로 들여쓰기 깊이 비교(탭/스페이스 혼용 안전)
  let w = 0;
  for (const ch of indent) w += ch === "\t" ? 4 : 1;
  return w;
}

function cleanTaskText(body: string): string {
  return body
    .replace(EMOJI_RE, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 파일 하나에서 할일 트리(최상위 배열) 추출
async function scanFileTaskTree(app: App, f: TFile): Promise<DashTask[]> {
  const cache = app.metadataCache.getFileCache(f);
  const listItems = cache?.listItems?.filter((li: any) => li.task !== undefined) || [];
  if (!listItems.length) return [];
  const content = await app.vault.cachedRead(f);
  const lines = content.split("\n");

  const flat: { task: DashTask; indent: number }[] = [];
  for (const li of listItems) {
    const ln = li.position.start.line;
    const raw = lines[ln];
    if (raw == null) continue;
    const m = raw.match(TASK_LINE_RE);
    if (!m) continue;
    const indent = m[1] || "";
    const mark = m[2];
    const body = m[3] || "";
    const dueM = body.match(DUE_RE);
    const schM = body.match(SCHED_RE);
    const doneM = body.match(DONE_DATE_RE);
    const prioM = body.match(PRIO_RE);
    flat.push({
      indent: indentWidth(indent),
      task: {
        completed: mark === "x" || mark === "X",
        due: dueM ? dueM[1] : null,
        scheduled: schM ? schM[1] : null,
        completion: doneM ? doneM[1] : null,
        priority: prioM ? prioM[1] : "",
        text: cleanTaskText(body),
        raw,
        path: f.path,
        line: ln,
        subtasks: [],
      },
    });
  }

  // 들여쓰기 폭으로 부모/자식 트리 구성
  const roots: DashTask[] = [];
  const stack: { task: DashTask; indent: number }[] = [];
  for (const node of flat) {
    while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
    if (stack.length) stack[stack.length - 1].task.subtasks.push(node.task);
    else roots.push(node.task);
    stack.push(node);
  }
  return roots;
}

// 파일 트리 캐시(path -> {mtime, roots})
const treeCache: Record<string, { mtime: number; roots: DashTask[] }> = {};

async function getFileTaskTree(app: App, f: TFile): Promise<DashTask[]> {
  const c = treeCache[f.path];
  if (c && c.mtime === f.stat.mtime) return c.roots;
  const roots = await scanFileTaskTree(app, f);
  treeCache[f.path] = { mtime: f.stat.mtime, roots };
  return roots;
}

// vault 전체 할일 트리(템플릿 폴더 제외)
export async function getAllTasks(app: App, settings: ICSettings): Promise<DashTask[]> {
  const out: DashTask[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (inExcluded(f.path, settings.templateFolder)) continue;
    const roots = await getFileTaskTree(app, f);
    for (const t of roots) out.push(t);
  }
  return out;
}

// 트리를 평탄화(모든 노드)
function flatten(tasks: DashTask[], out: DashTask[] = []): DashTask[] {
  for (const t of tasks) { out.push(t); flatten(t.subtasks, out); }
  return out;
}

export interface TaskBuckets {
  overdue: DashTask[]; // 🔴 지난 기한
  today: DashTask[]; // 🔴 오늘 마감 (트리 루트)
  upcoming: DashTask[]; // 📆 다가오는 2주 (트리 루트)
  backlog: DashTask[]; // 📥 백로그
  done: DashTask[]; // 🎉 최근 완료(7일)
}

// 다섯 버킷 생성. moment 로 날짜 비교(날짜 단위).
export async function getTaskBuckets(app: App, settings: ICSettings): Promise<TaskBuckets> {
  const roots = await getAllTasks(app, settings);
  const all = flatten(roots);
  const todayISO = moment().format("YYYY-MM-DD");
  const horizonISO = moment().add(14, "days").format("YYYY-MM-DD");
  const weekAgoISO = moment().subtract(7, "days").format("YYYY-MM-DD");

  const isToday = (t: DashTask) => t.due === todayISO || t.scheduled === todayISO;
  const inUpcoming = (t: DashTask) => !!t.due && t.due > todayISO && t.due <= horizonISO;

  // "해야 할 일" 매칭: 미완료 + (오늘 예정/마감 || 다가오는 2주 마감)
  const matched = all.filter((t) => !t.completed && (isToday(t) || inUpcoming(t)));

  // 매칭된 부모의 하위로 들어간 매칭 항목은 최상위 중복 렌더 방지
  const childKeys = new Set<string>();
  const collectChildren = (t: DashTask) => {
    for (const st of t.subtasks) { childKeys.add(st.path + ":" + st.line); collectChildren(st); }
  };
  for (const t of matched) collectChildren(t);

  const roDate = (t: DashTask) => t.due || t.scheduled || "";
  const todayRoots = matched
    .filter((t) => isToday(t) && !childKeys.has(t.path + ":" + t.line))
    .sort((a, b) => roDate(a).localeCompare(roDate(b)));
  const upcomingRoots = matched
    .filter((t) => !isToday(t) && !childKeys.has(t.path + ":" + t.line))
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""));

  const overdue = all
    .filter((t) => !t.completed && !!t.due && t.due < todayISO)
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""));

  const backlog = all
    .filter((t) => !t.completed && !t.due && !t.scheduled)
    .sort((a, b) => a.text.localeCompare(b.text, "ko"));

  const done = all
    .filter((t) => t.completed && !!t.completion && t.completion >= weekAgoISO)
    .sort((a, b) => (b.completion || "").localeCompare(a.completion || ""));

  return { overdue, today: todayRoots, upcoming: upcomingRoots, backlog, done };
}

// 프로젝트 폴더의 마크다운 노트 목록(이름 오름차순)
export function listProjectNotes(app: App, projectFolder: string): { name: string; path: string }[] {
  const af = app.vault.getAbstractFileByPath(normalizePath(projectFolder));
  const out: { name: string; path: string }[] = [];
  if (af instanceof TFolder) {
    for (const ch of af.children) {
      if (ch instanceof TFile && ch.extension === "md") out.push({ name: ch.basename, path: ch.path });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return out;
}

// 부모 라인에서 📅 마감일 추출(하위가 상속)
export function parentDue(rawLine: string): string {
  const m = rawLine.match(DUE_RE);
  return m ? m[1] : "";
}
