# Integrated Calendar (Obsidian 플러그인)

iCloud · Outlook · Google 등 **ICS 구독 캘린더**와 노트 안의 **일정·할일**을 한 화면에 통합해 보여주는 Obsidian 플러그인입니다. Dataview 없이 동작하며 **모바일도 지원**합니다.

- 📅 코드블록 한 줄로 **월 / 주 / 일** 전환 달력
- 📋 `calendar-agenda` 로 오늘·N일 일정 목록
- 🔗 구독 캘린더(iCloud/Outlook/Google) 실시간 통합 — **설정 UI에서 URL 입력** (코드 수정 불필요)
- ✅ 노트 어디에 적은 `- [ ] 할일 📅 2026-06-30` 도 달력에 함께
- 🔁 반복 일정(RRULE)·연속(멀티데이) 일정·취소 일정 처리

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

색·이름·URL 등 캘린더 소스는 **설정 → Integrated Calendar** 에서 추가/관리합니다.

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

소스 구조:
- `src/ics.ts` — ICS 파싱 + RRULE/멀티데이 전개 (Obsidian 비의존)
- `src/data.ts` — vault 로컬 일정(frontmatter) + 할일(체크박스) 수집
- `src/render.ts` — 월/주/일 달력 + 아젠다 렌더
- `src/settings.ts` — 설정 + 설정 탭 UI
- `src/main.ts` — 플러그인 본체 (코드블록 프로세서)

---

## 라이선스
MIT
