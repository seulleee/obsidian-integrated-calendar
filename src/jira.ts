/*
 * jira.ts — Jira Cloud 이슈를 읽기 전용으로 가져오기.
 * requestUrl(obsidian) 로 REST API 호출 → 브라우저 CORS 우회.
 * 인증: 이메일 + API 토큰(Basic). 토큰은 플러그인 설정(data.json)에만 저장.
 */
import { requestUrl, moment } from "obsidian";
import type { ICSettings } from "./settings";

export interface JiraIssue {
  key: string; // "PROJ-123"
  summary: string;
  due: string | null; // duedate YYYY-MM-DD
  status: string; // 상태 이름 (예: 진행 중)
  statusCategory: string; // new / indeterminate / done
  priority: string; // 🔺⏫🔼🔽⏬ 또는 ""
  url: string; // {site}/browse/KEY
}

export const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY duedate";

const FIELDS = ["summary", "duedate", "status", "priority", "issuetype"];

function mapPriority(name: string | undefined): string {
  switch ((name || "").toLowerCase()) {
    case "highest": return "🔺";
    case "high": return "⏫";
    case "medium": return "🔼";
    case "low": return "🔽";
    case "lowest": return "⏬";
    default: return "";
  }
}

function authHeader(email: string, token: string): string {
  const raw = (email || "") + ":" + (token || "");
  try { return "Basic " + btoa(raw); }
  catch (e) { return "Basic " + btoa(unescape(encodeURIComponent(raw))); }
}

// 주소 정규화: 앞뒤 공백/끝 슬래시 제거, scheme 없으면 https:// 부여
export function normSite(site: string): string {
  let s = (site || "").trim().replace(/\/+$/, "");
  if (s && !/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

function mapIssue(site: string, it: any): JiraIssue {
  const f = (it && it.fields) || {};
  return {
    key: it.key,
    summary: (f.summary || "").trim() || "(제목 없음)",
    due: f.duedate ? String(f.duedate).slice(0, 10) : null,
    status: (f.status && f.status.name) || "",
    statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || "",
    priority: mapPriority(f.priority && f.priority.name),
    url: site + "/browse/" + it.key,
  };
}

async function callSearch(site: string, path: string, auth: string, jql: string): Promise<any> {
  return await requestUrl({
    url: site + path,
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jql, fields: FIELDS, maxResults: 100 }),
    throw: false,
  });
}

async function fetchJiraLive(settings: ICSettings): Promise<JiraIssue[]> {
  const site = normSite(settings.jiraSite);
  if (!site) throw new Error("Jira 주소가 비어 있습니다.");
  if (!settings.jiraToken) throw new Error("Jira API 토큰이 비어 있습니다.");
  const auth = authHeader(settings.jiraEmail, settings.jiraToken);
  const jql = (settings.jiraJql || "").trim() || DEFAULT_JQL;

  // 신규 엔드포인트(/search/jql) → 없으면 구(/search) 로 폴백
  let res = await callSearch(site, "/rest/api/3/search/jql", auth, jql);
  if (res.status === 404 || res.status === 410) res = await callSearch(site, "/rest/api/3/search", auth, jql);

  if (res.status === 401 || res.status === 403) throw new Error("인증 실패 — 이메일/토큰/권한을 확인하세요 (HTTP " + res.status + ")");
  if (res.status >= 400) {
    let msg = "HTTP " + res.status;
    try { const j = res.json; if (j && Array.isArray(j.errorMessages) && j.errorMessages.length) msg += " · " + j.errorMessages.join(", "); } catch (e) { /* JSON 아님 */ }
    throw new Error("Jira 요청 실패 · " + msg);
  }
  let data: any = {};
  try { data = res.json || {}; } catch (e) { throw new Error("Jira 응답을 해석할 수 없습니다."); }
  const issues = Array.isArray(data.issues) ? data.issues : [];
  return issues.map((it: any) => mapIssue(site, it));
}

// 캐시(site|jql → {ts, issues}), cacheMinutes TTL. 대시보드가 매번 재렌더돼도 네트워크 호출 최소화.
const _cache: Record<string, { ts: number; issues: JiraIssue[] }> = {};
export function clearJiraCache(): void { for (const k of Object.keys(_cache)) delete _cache[k]; }

export async function getJiraIssues(settings: ICSettings, force = false): Promise<JiraIssue[]> {
  const key = normSite(settings.jiraSite) + "|" + (settings.jiraJql || "");
  const ttl = (settings.cacheMinutes || 0) * 60 * 1000;
  const now = Date.now();
  const c = _cache[key];
  if (!force && ttl > 0 && c && now - c.ts < ttl) return c.issues;
  const issues = await fetchJiraLive(settings);
  _cache[key] = { ts: now, issues };
  return issues;
}

export interface JiraBuckets {
  overdue: JiraIssue[]; // 기한 지남
  today: JiraIssue[]; // 오늘 마감
  upcoming: JiraIssue[]; // 앞으로 2주
  other: JiraIssue[]; // 기한 없음 / 2주 밖
}

export function bucketJira(issues: JiraIssue[], todayISO: string, horizonISO: string): JiraBuckets {
  const overdue: JiraIssue[] = [], today: JiraIssue[] = [], upcoming: JiraIssue[] = [], other: JiraIssue[] = [];
  for (const it of issues) {
    if (it.statusCategory === "done") continue; // 안전장치 (JQL 로 이미 제외되지만)
    if (!it.due) { other.push(it); continue; }
    if (it.due < todayISO) overdue.push(it);
    else if (it.due === todayISO) today.push(it);
    else if (it.due <= horizonISO) upcoming.push(it);
    else other.push(it);
  }
  const byDue = (a: JiraIssue, b: JiraIssue) => (a.due || "").localeCompare(b.due || "");
  overdue.sort(byDue); today.sort(byDue); upcoming.sort(byDue); other.sort(byDue);
  return { overdue, today, upcoming, other };
}

// 편의: moment 로 오늘/2주 뒤 ISO 계산 (렌더부와 동일 기준)
export function jiraHorizon(): { todayISO: string; horizonISO: string } {
  return {
    todayISO: moment().format("YYYY-MM-DD"),
    horizonISO: moment().add(14, "days").format("YYYY-MM-DD"),
  };
}
