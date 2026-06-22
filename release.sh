#!/usr/bin/env bash
#
# release.sh — Integrated Calendar 플러그인 릴리스 자동화
#
# 사용법:
#   ./release.sh <버전>            예) ./release.sh 0.2.0
#   ./release.sh <bump>            patch | minor | major  (현재 버전에서 자동 증가)
#   ./release.sh <버전> "릴리스 노트"
#   DRY=1 ./release.sh <버전>      실제로 바꾸지 않고 무엇을 할지 미리보기
#
# 하는 일: manifest/package/versions 버전 갱신 → 빌드 → 커밋·태그 → 푸시 → GitHub 릴리스(에셋 첨부).
# BRAT 사용자는 릴리스가 올라오면 자동 업데이트됩니다.

set -euo pipefail
cd "$(dirname "$0")"
: "${DRY:=0}"

err() { echo "❌ $1" >&2; exit 1; }
step() { echo "▶ $1"; }

# ---- 인자 ----
ARG="${1:-}"
[ -z "$ARG" ] && err "사용법: ./release.sh <버전(예 0.2.0) | patch | minor | major> [\"릴리스 노트\"]"

CUR=$(node -p "require('./manifest.json').version")
MINAPP=$(node -p "require('./manifest.json').minAppVersion")

# bump 타입이면 새 버전 계산
case "$ARG" in
  patch|minor|major)
    NEW=$(node -e "const [a,b,c]=process.argv[1].split('.').map(Number);const t=process.argv[2];console.log(t==='major'?[a+1,0,0].join('.'):t==='minor'?[a,b+1,0].join('.'):[a,b,c+1].join('.'))" "$CUR" "$ARG")
    ;;
  *)
    NEW="$ARG"
    ;;
esac

# semver 형식 검증
echo "$NEW" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || err "버전 형식이 올바르지 않습니다: '$NEW' (x.y.z)"
[ "$NEW" = "$CUR" ] && err "새 버전이 현재 버전과 같습니다 ($CUR)"

NOTES="${2:-Release $NEW}"

echo "──────────────────────────────────────────"
echo "  현재 버전 : $CUR"
echo "  새 버전   : $NEW   (minAppVersion: $MINAPP)"
echo "  릴리스 노트: $NOTES"
[ "$DRY" = "1" ] && echo "  모드      : 🔍 DRY-RUN (미리보기, 변경 없음)"
echo "──────────────────────────────────────────"

# ---- 사전 점검 ----
command -v gh >/dev/null || err "gh CLI 가 필요합니다 (brew install gh)."
ACC=$(gh api user --jq .login 2>/dev/null || true)
[ -z "$ACC" ] && err "gh 인증이 필요합니다 (gh auth login)."
step "GitHub 계정: $ACC"

git config user.email >/dev/null 2>&1 || echo "⚠️  git user.email 미설정 — 커밋 전에 'git config --global user.email ...' 을 권장합니다."

if [ -n "$(git status --porcelain)" ]; then
  echo "현재 미커밋 변경:"; git status --short
  err "커밋되지 않은 변경이 있습니다. 먼저 정리한 뒤 다시 실행하세요."
fi
git rev-parse "$NEW" >/dev/null 2>&1 && err "태그 '$NEW' 가 이미 존재합니다."

if [ "$DRY" = "1" ]; then
  echo ""
  echo "🔍 DRY-RUN 계획:"
  echo "  1) manifest.json / package.json 버전 → $NEW"
  echo "  2) versions.json 에 \"$NEW\": \"$MINAPP\" 추가"
  echo "  3) npm run build"
  echo "  4) git commit -m 'Release $NEW' + tag $NEW"
  echo "  5) git push origin main + 태그"
  echo "  6) gh release create $NEW main.js manifest.json styles.css"
  echo ""
  echo "실제 실행하려면 DRY 없이: ./release.sh $ARG"
  exit 0
fi

# ---- 1. 버전 파일 갱신 ----
step "버전 파일 갱신 (manifest / package / versions)"
node -e '
const fs=require("fs");
const nv=process.argv[1];
const m=JSON.parse(fs.readFileSync("manifest.json")); const minApp=m.minAppVersion;
m.version=nv; fs.writeFileSync("manifest.json", JSON.stringify(m,null,2)+"\n");
const p=JSON.parse(fs.readFileSync("package.json")); p.version=nv; fs.writeFileSync("package.json", JSON.stringify(p,null,2)+"\n");
const v=JSON.parse(fs.readFileSync("versions.json")); v[nv]=minApp; fs.writeFileSync("versions.json", JSON.stringify(v,null,2)+"\n");
' "$NEW"

# ---- 2. 빌드 ----
step "빌드 (npm run build)"
npm run build
[ -f main.js ] || err "빌드 산출물 main.js 가 없습니다."

# ---- 3. 커밋 + 태그 ----
step "커밋 + 태그"
git add manifest.json package.json versions.json
git commit -m "Release $NEW"
git tag "$NEW"

# ---- 4. 푸시 ----
step "푸시 (main + 태그)"
git push origin main
git push origin "$NEW"

# ---- 5. GitHub 릴리스 ----
step "GitHub 릴리스 생성 (에셋: main.js, manifest.json, styles.css)"
gh release create "$NEW" main.js manifest.json styles.css --title "$NEW" --notes "$NOTES"

URL=$(gh repo view --json url --jq .url)
echo ""
echo "✅ 릴리스 완료: $URL/releases/tag/$NEW"
echo "   BRAT 사용자는 자동으로 업데이트됩니다."
