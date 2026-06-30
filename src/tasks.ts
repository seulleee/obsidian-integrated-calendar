/*
 * tasks.ts — 할일 대시보드(integrated-tasks 코드블록) 렌더.
 * vault 의 🏠 홈 대시보드(DataviewJS)를 Dataview 없이 포팅.
 * DOM API(createEl/createDiv/createSpan)로만 그립니다 (innerHTML 미사용).
 */
import { App, Notice, TFile, TFolder, moment, normalizePath } from "obsidian";
import type { ICSettings } from "./settings";
import {
  DashTask,
  getTaskBuckets,
  listProjectNotes,
  parentDue,
} from "./data";

export interface TasksCtx {
  app: App;
  settings: ICSettings;
}

const PRIORITIES: { label: string; value: string }[] = [
  { label: "우선순위", value: "" },
  { label: "🔽 낮음", value: "🔽" },
  { label: "🔼 중간", value: "🔼" },
  { label: "⏫ 높음", value: "⏫" },
  { label: "🔺 긴급", value: "🔺" },
];

/* ---------- 노트 쓰기 헬퍼 ---------- */

// 본문에 새 할일 한 줄을 섹션 바로 아래(최상단)에 삽입
function insertUnderSection(data: string, section: string, line: string): string {
  const h = data.indexOf(section);
  if (h >= 0) {
    const le = data.indexOf("\n", h);
    const pos = le < 0 ? data.length : le + 1;
    return data.slice(0, pos) + line + "\n" + data.slice(pos);
  }
  const sep = data.length === 0 || data.endsWith("\n") ? "" : "\n";
  return data + sep + section + "\n" + line + "\n";
}

async function appendTask(app: App, settings: ICSettings, path: string, line: string): Promise<void> {
  const p = normalizePath(path);
  let file = app.vault.getAbstractFileByPath(p);
  if (!(file instanceof TFile)) file = await app.vault.create(p, settings.taskSection + "\n\n");
  const f = file as TFile;
  const run = (data: string) => insertUnderSection(data, settings.taskSection, line);
  if ((app.vault as any).process) await (app.vault as any).process(f, run);
  else { const d = await app.vault.read(f); await app.vault.modify(f, run(d)); }
}

async function createProject(app: App, settings: ICSettings, name: string): Promise<{ name: string; path: string }> {
  const safe = (name || "").replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
  if (!safe) throw new Error("이름이 비어 있습니다.");
  const folder = normalizePath(settings.projectFolder);
  const path = normalizePath(folder + "/" + safe + ".md");
  if (app.vault.getAbstractFileByPath(path)) throw new Error("이미 있는 프로젝트입니다.");
  if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
    try { await app.vault.createFolder(folder); } catch (e) { /* 이미 있으면 무시 */ }
  }
  await app.vault.create(path, "# " + safe + "\n\n" + settings.taskSection + "\n\n");
  return { name: safe, path };
}

function buildLine(tag: string, desc: string, prio: string, date: string): string {
  let s = "- [ ] ";
  if (tag) s += "[" + tag + "] ";
  s += desc.trim();
  if (prio) s += " " + prio;
  if (date) s += " 📅 " + date;
  return s;
}

// 원본 라인 위치 보정(편집으로 줄이 밀렸을 때 대비)
function resolveLine(lines: string[], task: DashTask): number {
  const frag = (task.raw || "").trim().slice(0, 24);
  if (lines[task.line] != null && frag && lines[task.line].includes(frag)) return task.line;
  for (let k = 0; k < lines.length; k++) {
    if (/[-*]\s*\[.\]/.test(lines[k]) && frag && lines[k].includes(frag)) return k;
  }
  return task.line;
}

async function toggleTask(app: App, task: DashTask, done: boolean): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  const stamp = moment().format("YYYY-MM-DD");
  const run = (data: string) => {
    const lines = data.split("\n");
    const i = resolveLine(lines, task);
    if (lines[i] == null) return data;
    if (done) {
      lines[i] = lines[i].replace(/\[ \]/, "[x]");
      if (!/✅\s*\d{4}-\d{2}-\d{2}/.test(lines[i])) lines[i] = lines[i].replace(/\s*$/, "") + " ✅ " + stamp;
    } else {
      lines[i] = lines[i].replace(/\[[xX]\]/, "[ ]").replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "");
    }
    return lines.join("\n");
  };
  if ((app.vault as any).process) await (app.vault as any).process(file, run);
  else { const d = await app.vault.read(file); await app.vault.modify(file, run(d)); }
}

async function addSubtask(app: App, task: DashTask, text: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  const run = (data: string) => {
    const lines = data.split("\n");
    const i = resolveLine(lines, task);
    if (lines[i] == null) return data;
    const pIndent = (lines[i].match(/^[\t ]*/) || [""])[0];
    const dueM = lines[i].match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    const dueSuffix = dueM ? " 📅 " + dueM[1] : "";
    let childIndent = pIndent + "\t";
    let j = i + 1;
    let detected: string | null = null;
    while (j < lines.length) {
      if (lines[j].trim() === "") break;
      const ind = (lines[j].match(/^[\t ]*/) || [""])[0];
      if (ind.length > pIndent.length) { if (detected == null) detected = ind; j++; continue; }
      break;
    }
    if (detected) childIndent = detected;
    lines.splice(j, 0, childIndent + "- [ ] " + text.trim() + dueSuffix);
    return lines.join("\n");
  };
  if ((app.vault as any).process) await (app.vault as any).process(file, run);
  else { const d = await app.vault.read(file); await app.vault.modify(file, run(d)); }
}

// 라인에 📅 마감일 설정/교체 (백로그 → 날짜 지정)
async function setDue(app: App, task: DashTask, date: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(task.path);
  if (!(file instanceof TFile)) return;
  const run = (data: string) => {
    const lines = data.split("\n");
    const i = resolveLine(lines, task);
    if (lines[i] == null) return data;
    let line = lines[i].replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, "");
    if (date) line = line.replace(/\s*$/, "") + " 📅 " + date;
    lines[i] = line;
    return lines.join("\n");
  };
  if ((app.vault as any).process) await (app.vault as any).process(file, run);
  else { const d = await app.vault.read(file); await app.vault.modify(file, run(d)); }
}

/* ---------- 빠른 등록 폼 ---------- */

const ATTACH_FOLDER = "_첨부";

// 이미지를 첨부 폴더에 바이너리로 저장하고 파일명 반환
async function saveImage(app: App, file: File, idx: number): Promise<string> {
  const m = (file.name || "").match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m ? m[1] : "png").toLowerCase();
  const name = "qa-" + moment().format("YYYYMMDD-HHmmssSSS") + (idx ? "-" + idx : "") + "." + ext;
  const folder = normalizePath(ATTACH_FOLDER);
  if (!app.vault.getAbstractFileByPath(folder)) { try { await app.vault.createFolder(folder); } catch (e) { /* 이미 있으면 무시 */ } }
  await app.vault.createBinary(normalizePath(folder + "/" + name), await file.arrayBuffer());
  return name;
}

const CTRL = "box-sizing:border-box;height:34px;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-primary);color:var(--text-normal);padding:0 8px;font-size:0.95em;";

// 선택한 프로젝트를 redraw(할일 추가 후 draw 재실행) 사이에도 유지 (모듈 유지되는 동안)
let _lastSelected: { path: string; tag: string } | null = null;

function buildQuickAdd(parent: HTMLElement, ctx: TasksCtx, refresh: () => void): void {
  const { app, settings } = ctx;
  const root = parent.createDiv({ cls: "ic-qa" });
  root.createEl("div", { cls: "ic-sec-h", text: "➕ 빠른 등록" });

  // 프로젝트 선택 = 클릭 칩
  let selected: { path: string; tag: string } = (_lastSelected && _lastSelected.path) ? _lastSelected : { path: settings.inboxNote, tag: "" };
  const projBar = root.createDiv({ cls: "ic-chips" });
  const highlight = () => {
    for (const b of Array.from(projBar.children) as HTMLElement[]) {
      b.toggleClass("ic-chip-on", b.dataset.path === normalizePath(selected.path));
    }
  };
  const mkBtn = (label: string, target: { path: string; tag: string }) => {
    const b = projBar.createEl("button", { text: label, cls: "ic-chip" });
    b.dataset.path = normalizePath(target.path);
    b.addEventListener("click", () => { selected = target; _lastSelected = target; highlight(); });
  };
  const buildBar = () => {
    projBar.empty();
    mkBtn("📥 빠른 메모", { path: settings.inboxNote, tag: "" });
    for (const p of listProjectNotes(app, settings.projectFolder)) mkBtn("📁 " + p.name, { path: p.path, tag: p.name });
    if (!Array.from(projBar.children).some((b) => (b as HTMLElement).dataset.path === normalizePath(selected.path))) {
      selected = { path: settings.inboxNote, tag: "" }; _lastSelected = selected;
    }
    highlight();
  };
  buildBar();

  // 입력 행
  const row = root.createDiv({ cls: "ic-qa-row" });
  const descInp = row.createEl("input", { cls: "ic-qa-desc", attr: { type: "text", placeholder: "할 일 내용…" } });
  descInp.setAttr("style", CTRL + "flex:1 1 200px;min-width:0;");

  // 날짜 버튼 → 네이티브 datepicker
  let dueDate = moment().format("YYYY-MM-DD");
  const dateWrap = row.createDiv({ cls: "ic-date-wrap" });
  const dateBtn = dateWrap.createEl("button", { cls: "ic-date-btn" });
  dateBtn.setAttr("style", CTRL + "cursor:pointer;display:inline-flex;align-items:center;white-space:nowrap;");
  const dateInp = dateWrap.createEl("input", { cls: "ic-date-hidden", attr: { type: "date" } });
  dateInp.value = dueDate;
  const syncDate = () => dateBtn.setText(dueDate ? "📅 " + dueDate : "📅 마감 없음");
  syncDate();
  dateBtn.addEventListener("click", () => {
    const di = dateInp as HTMLInputElement & { showPicker?: () => void };
    if (typeof di.showPicker === "function") { try { di.showPicker(); return; } catch (e) { /* fall through */ } }
    dateInp.style.pointerEvents = "auto"; dateInp.focus(); dateInp.click();
  });
  dateInp.addEventListener("change", () => { dueDate = dateInp.value; syncDate(); });

  // 우선순위
  const prioSel = row.createEl("select", { cls: "ic-qa-prio" });
  prioSel.setAttr("style", CTRL + "flex:0 0 auto;cursor:pointer;");
  for (const p of PRIORITIES) { const o = prioSel.createEl("option", { text: p.label }); o.value = p.value; }

  // 📎 이미지 첨부 (파일 선택 / 붙여넣기 / 드래그&드롭)
  let pendingImages: File[] = [];
  const imgBtn = row.createEl("button", { cls: "ic-qa-img", text: "📎 이미지" });
  imgBtn.setAttr("style", CTRL + "flex:0 0 auto;cursor:pointer;");
  const imgInp = row.createEl("input", { cls: "ic-qa-imginp", attr: { type: "file", accept: "image/*", multiple: "" } });
  imgInp.setAttr("style", "display:none;");
  const updateImg = () => imgBtn.setText(pendingImages.length ? "📎 이미지 " + pendingImages.length : "📎 이미지");
  imgBtn.addEventListener("click", () => imgInp.click());
  imgInp.addEventListener("change", () => { pendingImages = pendingImages.concat(Array.from(imgInp.files || [])); imgInp.value = ""; updateImg(); });

  const addBtn = row.createEl("button", { cls: "ic-qa-add", text: "➕ 추가" });

  const status = root.createDiv({ cls: "ic-qa-status" });

  // 본문칸에 이미지 붙여넣기(스크린샷 등)
  descInp.addEventListener("paste", (e: ClipboardEvent) => {
    const items = e.clipboardData ? e.clipboardData.items : null;
    let got = false;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type && it.type.indexOf("image/") === 0) { const f = it.getAsFile(); if (f) { pendingImages.push(f); got = true; } }
      }
    }
    if (got) { e.preventDefault(); updateImg(); status.setText("🖼️ 이미지 " + pendingImages.length + "장 첨부 대기 (➕ 추가 누르면 저장)"); }
  });
  // 폼에 이미지 드래그&드롭
  root.addEventListener("dragover", (e: DragEvent) => { e.preventDefault(); });
  root.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => f.type && f.type.indexOf("image/") === 0);
    if (files.length) { pendingImages = pendingImages.concat(files); updateImg(); status.setText("🖼️ 이미지 " + pendingImages.length + "장 첨부 대기 (➕ 추가 누르면 저장)"); }
  });

  let submitting = false;
  const submit = async () => {
    if (submitting) return; // 중복 등록 방지 (Enter 연타 / IME 확정 Enter / 버튼+Enter 동시)
    const desc = descInp.value.trim();
    if (!desc) { descInp.focus(); return; }
    let block = buildLine(selected.tag || "", desc, prioSel.value, dueDate);
    submitting = true; addBtn.disabled = true;
    try {
      for (let i = 0; i < pendingImages.length; i++) {
        const nm = await saveImage(app, pendingImages[i], i);
        block += "\n\t- ![[" + nm + "]]";
      }
      await appendTask(app, settings, selected.path, block);
      const where = selected.tag ? "📁 " + selected.tag : "📥 빠른 메모";
      const imgN = pendingImages.length;
      status.setText("✅ 추가됨 → " + where + (dueDate ? "  · 📅 " + dueDate : "  · 마감 없음(백로그)") + (imgN ? "  · 🖼️ " + imgN + "장" : ""));
      descInp.value = ""; pendingImages = []; updateImg(); descInp.focus();
      new Notice("할 일 추가: " + desc);
      refresh();
    } catch (e: any) {
      status.setText("⚠️ 실패: " + (e?.message || e));
    } finally {
      submitting = false; addBtn.disabled = false;
    }
  };
  addBtn.addEventListener("click", submit);
  descInp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) submit(); });

  // 새 프로젝트 등록
  const npWrap = root.createDiv({ cls: "ic-np" });
  const npToggle = npWrap.createEl("a", { cls: "ic-np-toggle", text: "＋ 새 프로젝트 등록" });
  const npForm = npWrap.createDiv({ cls: "ic-np-form" });
  const npInp = npForm.createEl("input", { cls: "ic-np-inp", attr: { type: "text", placeholder: "프로젝트 이름" } });
  const npBtn = npForm.createEl("button", { cls: "ic-np-btn", text: "만들기" });
  npToggle.addEventListener("click", () => {
    const open = !npForm.hasClass("ic-open");
    npForm.toggleClass("ic-open", open);
    if (open) npInp.focus();
  });
  const createNp = async () => {
    const name = npInp.value.trim();
    if (!name) return;
    npBtn.disabled = true;
    try {
      const p = await createProject(app, settings, name);
      selected = { path: p.path, tag: p.name }; _lastSelected = selected;
      buildBar();
      npInp.value = ""; npForm.removeClass("ic-open");
      status.setText("✅ 프로젝트 생성: 📁 " + p.name);
      new Notice("프로젝트 생성: " + p.name);
    } catch (e: any) {
      status.setText("⚠️ " + (e?.message || e));
    } finally {
      npBtn.disabled = false;
    }
  };
  npBtn.addEventListener("click", createNp);
  npInp.addEventListener("keydown", (e) => { if (e.key === "Enter") createNp(); });
}

/* ---------- 커스텀 할일 행(체크박스 + 본문 + ＋하위) ---------- */

function renderTaskRow(container: HTMLElement, ctx: TasksCtx, task: DashTask, depth: number, refresh: () => void): void {
  const { app } = ctx;
  const row = container.createDiv({ cls: "ic-trow" });
  row.style.marginLeft = depth * 22 + "px";

  const cb = row.createEl("input", { cls: "ic-tcb", attr: { type: "checkbox" } });
  if (task.completed) cb.checked = true;
  cb.addEventListener("change", async () => {
    await toggleTask(app, task, cb.checked);
    refresh();
  });

  const prio = task.priority ? task.priority + " " : "";
  const txt = row.createSpan({ cls: "ic-ttext" + (task.completed ? " ic-tdone" : ""), text: prio + task.text });
  txt.setAttr("title", "클릭하면 원본 항목으로 이동");
  txt.addEventListener("click", () => {
    const f = app.vault.getAbstractFileByPath(task.path);
    if (f instanceof TFile) app.workspace.getLeaf(false).openFile(f, { eState: { line: task.line } });
  });

  const add = row.createEl("a", { cls: "ic-tadd", text: "＋ 하위" });
  add.addEventListener("click", () => {
    const next = row.nextElementSibling as HTMLElement | null;
    if (next && next.dataset.subinput === "1") { next.remove(); return; }
    const inWrap = container.createDiv({ cls: "ic-subin" });
    row.after(inWrap);
    inWrap.dataset.subinput = "1";
    inWrap.style.marginLeft = (depth + 1) * 22 + "px";
    const inp = inWrap.createEl("input", { cls: "ic-subin-inp", attr: { type: "text", placeholder: "하위 태스크 내용… (Enter)" } });
    inp.focus();
    const go = async () => {
      const v = inp.value.trim();
      if (!v) { inWrap.remove(); return; }
      await addSubtask(app, task, v);
      inWrap.remove();
      refresh();
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
      else if (e.key === "Escape") inWrap.remove();
    });
  });

  for (const st of task.subtasks) renderTaskRow(container, ctx, st, depth + 1, refresh);
}

// 단순 목록 행(체크박스+본문+경로/날짜 부가정보) — overdue/backlog/done 용
function renderSimpleRow(container: HTMLElement, ctx: TasksCtx, task: DashTask, meta: string, refresh: () => void): void {
  const { app } = ctx;
  const row = container.createDiv({ cls: "ic-trow" });
  const cb = row.createEl("input", { cls: "ic-tcb", attr: { type: "checkbox" } });
  if (task.completed) cb.checked = true;
  cb.addEventListener("change", async () => { await toggleTask(app, task, cb.checked); refresh(); });
  const prio = task.priority ? task.priority + " " : "";
  const txt = row.createSpan({ cls: "ic-ttext" + (task.completed ? " ic-tdone" : ""), text: prio + task.text });
  txt.setAttr("title", "클릭하면 원본 항목으로 이동");
  txt.addEventListener("click", () => {
    const f = app.vault.getAbstractFileByPath(task.path);
    if (f instanceof TFile) app.workspace.getLeaf(false).openFile(f, { eState: { line: task.line } });
  });
  if (meta) row.createSpan({ cls: "ic-tmeta", text: meta });
}

// 백로그 행 — 본문 + 📅 날짜(개별) + ⬆️ 부모 날짜(상속)
function renderBacklogRow(container: HTMLElement, ctx: TasksCtx, task: DashTask, refresh: () => void): void {
  const { app } = ctx;
  const row = container.createDiv({ cls: "ic-trow" });
  const cb = row.createEl("input", { cls: "ic-tcb", attr: { type: "checkbox" } });
  if (task.completed) cb.checked = true;
  cb.addEventListener("change", async () => { await toggleTask(app, task, cb.checked); refresh(); });
  const prio = task.priority ? task.priority + " " : "";
  const txt = row.createSpan({ cls: "ic-ttext", text: prio + task.text });
  txt.setAttr("title", "클릭하면 원본 항목으로 이동");
  txt.addEventListener("click", () => {
    const f = app.vault.getAbstractFileByPath(task.path);
    if (f instanceof TFile) app.workspace.getLeaf(false).openFile(f, { eState: { line: task.line } });
  });

  // 📅 날짜 — 개별 날짜 지정(네이티브 datepicker)
  const dWrap = row.createDiv({ cls: "ic-bl-datewrap" });
  const dBtn = dWrap.createEl("button", { cls: "ic-bl-btn", text: "📅 날짜" });
  const dInp = dWrap.createEl("input", { cls: "ic-date-hidden", attr: { type: "date" } });
  dBtn.addEventListener("click", () => {
    const di = dInp as HTMLInputElement & { showPicker?: () => void };
    if (typeof di.showPicker === "function") { try { di.showPicker(); return; } catch (e) { /* fall through */ } }
    dInp.style.pointerEvents = "auto"; dInp.focus(); dInp.click();
  });
  dInp.addEventListener("change", async () => { if (dInp.value) { await setDue(app, task, dInp.value); refresh(); } });

  // ⬆️ 부모 날짜 — 상위 태스크 마감일로(하위 항목이고 부모에 날짜가 있을 때만)
  if (task.parentDueDate) {
    const pd = task.parentDueDate;
    const pBtn = row.createEl("button", { cls: "ic-bl-btn ic-bl-parent", text: "⬆️ 부모(" + pd + ")" });
    pBtn.addEventListener("click", async () => { await setDue(app, task, pd); refresh(); });
  }
}

/* ---------- 메인 렌더 ---------- */

export async function renderTasks(el: HTMLElement, ctx: TasksCtx): Promise<void> {
  el.empty();
  el.addClass("ic-tasks");

  const draw = async () => {
    el.empty();
    buildQuickAdd(el, ctx, () => { draw(); });

    const body = el.createDiv({ cls: "ic-tbody" });
    body.createDiv({ cls: "ic-loading", text: "불러오는 중…" });
    let b;
    try {
      b = await getTaskBuckets(ctx.app, ctx.settings);
    } catch (e: any) {
      body.empty();
      body.createDiv({ cls: "ic-err", text: "⚠️ 할일을 표시할 수 없습니다: " + (e?.message || e) });
      return;
    }
    body.empty();

    // 🔴 지난 기한
    const od = body.createDiv({ cls: "ic-sec" });
    od.createEl("div", { cls: "ic-sec-h", text: "🔴 지난 기한 — 놓친 할일 · " + b.overdue.length + "건" });
    if (!b.overdue.length) od.createDiv({ cls: "ic-empty", text: "놓친 할일이 없습니다. 🎉" });
    for (const t of b.overdue) renderSimpleRow(od, ctx, t, "📅 " + t.due, () => draw());

    // ✅ 해야 할 일
    const sec = body.createDiv({ cls: "ic-sec" });
    sec.createEl("div", { cls: "ic-sec-h", text: "✅ 해야 할 일" });
    if (!b.today.length && !b.upcoming.length) sec.createDiv({ cls: "ic-empty", text: "오늘/다가오는 할일이 없습니다. 🎉" });
    if (b.today.length) {
      const box = sec.createDiv({ cls: "ic-today-box" });
      box.createEl("div", { cls: "ic-today-h", text: "🔴 오늘 마감 · " + b.today.length + "건" });
      for (const t of b.today) renderTaskRow(box, ctx, t, 0, () => draw());
    }
    if (b.upcoming.length) {
      sec.createEl("div", { cls: "ic-up-h", text: "📆 다가오는 2주 · " + b.upcoming.length + "건" });
      const wrap = sec.createDiv();
      for (const t of b.upcoming) renderTaskRow(wrap, ctx, t, 0, () => draw());
    }

    // 📥 백로그
    const bl = body.createDiv({ cls: "ic-sec" });
    bl.createEl("div", { cls: "ic-sec-h", text: "📥 백로그 · " + b.backlog.length + "건" });
    if (!b.backlog.length) bl.createDiv({ cls: "ic-empty", text: "백로그가 비었습니다." });
    for (const t of b.backlog) renderBacklogRow(bl, ctx, t, () => draw());

    // 🎉 최근 완료(7일)
    const dn = body.createDiv({ cls: "ic-sec" });
    dn.createEl("div", { cls: "ic-sec-h", text: "🎉 최근 완료 (7일) · " + b.done.length + "건" });
    if (!b.done.length) dn.createDiv({ cls: "ic-empty", text: "최근 완료한 할일이 없습니다." });
    for (const t of b.done) renderSimpleRow(dn, ctx, t, t.completion ? "✅ " + t.completion : "", () => draw());
  };

  await draw();
}
