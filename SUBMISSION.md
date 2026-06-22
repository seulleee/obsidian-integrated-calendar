# 커뮤니티 플러그인 스토어 제출 가이드

Obsidian 공식 커뮤니티 플러그인 스토어 등재 절차입니다.
(공식 문서: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)

## ✅ 사전 준비 (이미 충족된 항목)

리포지토리 루트:
- [x] `README.md` — 목적·사용법 설명
- [x] `LICENSE` — MIT
- [x] `manifest.json` — 아래 규칙 충족
  - [x] `id` 고유, "obsidian" 미포함, 케밥케이스 (`integrated-calendar`)
  - [x] `name` 에 "Obsidian" 미포함 (`Integrated Calendar`)
  - [x] `description` 간결, 마침표로 끝남, "This plugin…"으로 시작 안 함
  - [x] `authorUrl` 채워짐
  - [x] `isDesktopOnly: false`
  - [x] `version` 시맨틱 버전

코드 가이드라인 (리뷰어 점검 항목):
- [x] `innerHTML` / `outerHTML` / `insertAdjacentHTML` 미사용 → `createEl()` 등 DOM API
- [x] 전역 `app` 대신 `this.app` 사용
- [x] `var` 미사용 (const/let)
- [x] `console` 로그 없음
- [x] `activeLeaf` / `@ts-ignore` 제거, `onunload` 에서 leaf detach 안 함
- [x] 리소스는 `registerMarkdownCodeBlockProcessor` / `addCommand` 로 등록 (자동 정리)
- [x] 설정 탭 top-level `<h2>` 제거, 섹션은 `Setting().setHeading()` 사용
- [x] 파일 탐색에 `getAbstractFileByPath` + `normalizePath` 사용
- [x] 동적 색상만 `el.style` 로 지정, 정적 스타일은 `styles.css`
- [x] GitHub 릴리스에 `main.js` · `manifest.json` · `styles.css` 첨부, 태그 = manifest 버전

## 🚀 제출 단계

1. **최신 릴리스 확인**: `./release.sh patch` 로 manifest 버전과 같은 태그의 릴리스가 올라가 있어야 합니다.
2. https://community.obsidian.md 에 **Obsidian 계정**으로 로그인.
3. **GitHub 계정 연결** (소유권 확인).
4. **Plugins → New plugin** 메뉴.
5. 리포지토리 URL 입력: `https://github.com/seulleee/obsidian-integrated-calendar`
6. 개발자 정책(developer policies) 동의.
7. **Submit**.

> 과거의 `obsidianmd/obsidian-releases` 에 수동 PR을 올리는 방식은 위 커뮤니티 사이트 제출로 대체되었습니다.
> 제출은 **본인 Obsidian 계정 로그인**이 필요해 자동화할 수 없습니다 (위 단계는 직접 진행).

## 🔁 리뷰 피드백 대응

자동 봇/리뷰어가 수정 요청을 남기면:
1. 코드 수정 후 커밋.
2. `./release.sh patch "리뷰 반영"` 으로 **버전을 올려** 새 릴리스 생성.
3. 제출 스레드(또는 봇)가 새 버전을 다시 검사합니다.

## 참고: 알려진 검토 포인트

- **동적 인라인 색상**: 각 캘린더 색을 `el.style.borderLeftColor` 로 지정합니다. 데이터 기반 동적 값이라 CSS 클래스로 옮길 수 없으며, 승인된 다수 플러그인이 쓰는 허용 패턴입니다.
- **전체 할일 스캔**: 할일은 노트 어디에나 있을 수 있어 `getMarkdownFiles()` 로 훑되, `metadataCache` 의 `listItems` 로 체크박스가 있는 파일만 읽고 mtime 캐시로 재읽기를 줄입니다.
