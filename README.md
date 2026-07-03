# Integrated Calendar (Obsidian 플러그인)

iCloud · Outlook · Google 등 **ICS 구독 캘린더**와 노트 안의 **일정·할일**을 한 화면에 통합해 보여주는 Obsidian 플러그인입니다. Dataview 없이 동작하며 **모바일도 지원**합니다.

- 📅 코드블록 한 줄로 **월 / 주 / 일** 전환 달력
- 📋 `calendar-agenda` 로 오늘·N일 일정 목록
- 🔗 구독 캘린더(iCloud/Outlook/Google) 실시간 통합 — **설정 UI에서 URL 입력** (코드 수정 불필요)
- ✅ 노트 어디에 적은 `- [ ] 할일 📅 2026-06-30` 도 달력에 함께
- 🔁 반복 일정(RRULE)·연속(멀티데이) 일정·취소 일정 처리
- 🟦 (선택) **Jira Cloud 이슈**를 읽기 전용으로 할일 대시보드에 함께 표시

---

## 사용법

노트에 아래 코드블록을 넣으면 됩니다.

````markdown
```calendar
```
````
→ 월/주/일 전환 버튼이 있는 달력.

````markdown
```calendar-agenda today
```
````
→ 오늘 일정 목록. (`today` / `week` / 숫자 `14` = 앞으로 14일)

````markdown
```integrated-tasks
```
````
→ **할일 대시보드**. 빠른 등록 폼 + 5개 묶음을 한 블록에 그립니다(아래 참고).

색·이름·URL 등 캘린더 소스는 **설정 → Integrated Calendar** 에서 추가/관리합니다.

### ✅ 할일 대시보드 (`integrated-tasks`)

`integrated-tasks` 코드블록 하나로 다음을 보여줍니다.

- **➕ 빠른 등록** — 프로젝트 **칩**(📥 빠른 메모 + 프로젝트 폴더의 각 노트)을 고르고, 내용·마감일(네이티브 달력)·우선순위(🔽/🔼/⏫/🔺)를 넣어 **➕ 추가**. `- [ ] [프로젝트] 내용 우선순위 📅 날짜` 형태로 대상 노트의 할일 섹션 **맨 위**에 끼워 넣습니다. `＋ 새 프로젝트 등록`으로 프로젝트 노트를 바로 만들 수 있습니다.
- **🔴 지난 기한 — 놓친 할일** — 미완료 + 마감일이 오늘 이전.
- **✅ 해야 할 일** — **🔴 오늘 마감**(오늘 마감/예정)을 위에 강조하고, **📆 다가오는 2주** 마감을 아래에. 각 행은 **상태 배지**(아래 참고)·본문 클릭(원본 항목으로 이동)·`＋ 하위`(하위 할일 추가, **부모 마감일 상속**)로 동작하며 하위 할일은 들여쓰기로 중첩 표시됩니다.
- **📥 백로그** — 미완료 + 마감/예정 없음.
- **🎉 최근 완료 (7일)** — 최근 7일 안에 완료(`✅ 날짜`)한 할일.

#### 🔘 상태 배지 (할 일 / 진행 중 / 완료)

체크박스 대신 **상태 배지**를 클릭하면 드롭다운으로 상태를 고를 수 있습니다. 상태는 체크박스 문자로 원본 노트에 기록됩니다(Obsidian/Tasks 표준):

| 배지 | 마크다운 | 의미 |
| --- | --- | --- |
| ○ 할 일 | `- [ ]` | 아직 시작 안 함 |
| ◐ 진행 중 | `- [/]` | 진행 중 (계속 "해야 할 일"에 표시) |
| ✔ 완료 | `- [x]` | 완료 (`✅ 날짜` 자동 기록 → "최근 완료"로 이동) |

**진행 중**(`[/]`) 항목은 완료가 아니므로 지난 기한/해야 할 일에 그대로 남아 구분 표시됩니다.

설정 → Integrated Calendar → **할일 대시보드** 에서 다음을 바꿀 수 있습니다.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| 프로젝트 폴더 | `4. 프로젝트` | 빠른 등록 칩이 되는 노트 폴더 |
| 빠른메모(인박스) 노트 | `📥 빠른메모.md` | 📥 빠른 메모 대상 노트 |
| 할일 섹션 제목 | `## ✅ 할일` | 새 할일을 끼워 넣는 섹션 |
| 템플릿 폴더(대시보드 제외) | `0. 템플릿` | 모든 묶음에서 제외할 폴더 |

### 🟦 Jira 연동 (읽기 전용, Jira Cloud)

내게 할당된 Jira 이슈를 가져와 **마감일 기준**으로 할일 대시보드에 함께 보여줍니다. **보기 전용**이며 Jira 를 수정하지 않습니다.

설정 → Integrated Calendar → **Jira 연동 (읽기 전용)** 에서:

1. **Jira 사용** 켜기
2. **Jira 주소** — `https://회사이름.atlassian.net`
3. **Atlassian 이메일** — 로그인 이메일
4. **API 토큰** — [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) → 보안 → API 토큰 만들기 (비밀번호 필드로 저장)
5. **JQL** (선택) — 기본값 `assignee = currentUser() AND statusCategory != Done ORDER BY duedate`
6. **연결 테스트** 로 확인

가져온 이슈는 `integrated-tasks` 대시보드에서 마감일에 따라 **🔴 지난 기한 / 🔴 오늘 마감 / 📆 다가오는 2주** 에 할일과 함께 섞여 표시되고, 마감일 없는 이슈는 **🔗 Jira · 기한 없음/그 외** 에 모입니다. 이슈 키/제목을 클릭하면 브라우저에서 Jira 로 이동합니다.

> - 토큰은 이 볼트의 플러그인 설정(`data.json`)에만 저장되며 **공유 템플릿에는 포함되지 않습니다.**
> - Obsidian 의 `requestUrl` 로 호출해 브라우저 CORS 제약을 받지 않습니다.
> - 캐시는 **구독 캐시(분)** 설정을 따르며, 명령어 팔레트의 *구독·Jira 캐시 비우기* 로 즉시 갱신할 수 있습니다.
> - 현재는 **Jira Cloud** 만 지원합니다(Server/Data Center 미지원).

### ICS 주소 구하기
- **iCloud**: 캘린더 앱 → 캘린더 우클릭 → 공유 → "공개 캘린더" → `webcal://…` (앞을 `https://` 로 바꿔 입력)
- **Google**: 캘린더 설정 → "캘린더 통합" → iCal 형식의 비공개 주소
- **Outlook**: 설정 → 캘린더 → 공유 캘린더 → 캘린더 게시 → ICS 링크

> 구독 캘린더는 **읽기 전용**입니다(보기만).

---

## 설치 (팀 동료용)

### 방법 1. 수동 설치 (가장 간단)
1. 릴리스의 `main.js`, `manifest.json`, `styles.css` 3개 파일을 받습니다.
2. 본인 Obsidian vault의 `<vault>/.obsidian/plugins/integrated-calendar/` 폴더를 만들고 3개 파일을 넣습니다.
3. Obsidian → 설정 → 커뮤니티 플러그인 → (제한 모드 끄기) → **Integrated Calendar** 켜기.
4. 설정 → Integrated Calendar 에서 본인 캘린더 URL 추가.

### 방법 2. BRAT (자동 업데이트, 권장)
1. 커뮤니티 플러그인에서 **BRAT** 설치 후 활성화.
2. 명령어 팔레트 → `BRAT: Add a beta plugin for testing` → 아래 주소 입력:
   ```
   seulleee/obsidian-integrated-calendar
   ```
3. 자동 설치되고 이후 업데이트도 자동으로 받습니다.
4. 설정 → Integrated Calendar 에서 본인 캘린더 URL 추가.

---

## 개발

```bash
npm install
npm run dev     # 워치 빌드
npm run build   # 타입체크 + 프로덕션 빌드 → main.js
```

### 릴리스
버전 올리고 빌드·커밋·태그·푸시·GitHub 릴리스를 한 번에:

```bash
./release.sh patch          # 0.1.0 → 0.1.1 (minor / major 도 가능)
./release.sh 0.2.0          # 버전 직접 지정
./release.sh 0.2.0 "변경 요약"
DRY=1 ./release.sh patch    # 실제 변경 없이 미리보기
```

릴리스가 올라오면 BRAT 사용자는 자동 업데이트됩니다.

소스 구조:
- `src/ics.ts` — ICS 파싱 + RRULE/멀티데이 전개 (Obsidian 비의존)
- `src/data.ts` — vault 로컬 일정(frontmatter) + 할일(체크박스/트리) 수집·버킷
- `src/render.ts` — 월/주/일 달력 + 아젠다 렌더
- `src/tasks.ts` — 할일 대시보드(`integrated-tasks`) 렌더
- `src/settings.ts` — 설정 + 설정 탭 UI
- `src/main.ts` — 플러그인 본체 (코드블록 프로세서)

---

## 라이선스
MIT
