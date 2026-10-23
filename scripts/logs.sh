#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  LiaraPilot — نمایشگر لاگ گرافیکی برنامه‌ی مستقرشده روی لیارا
#
#  استفاده:
#     bash scripts/logs.sh                 # لاگ اخیر + دنبال‌کردن زنده
#     bash scripts/logs.sh --now           # فقط لاگ اخیر (بدون follow)
#     LIARA_APP=myapp bash scripts/logs.sh
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

APP="${LIARA_APP:-liarapilot}"
FOLLOW=1
[ "${1:-}" = "--now" ] && FOLLOW=0

if [ -t 1 ]; then
  C0=$'\033[0m'; CB=$'\033[1m'; CD=$'\033[2m'
  CYAN=$'\033[1;36m'; GREEN=$'\033[1;32m'; YEL=$'\033[1;33m'; RED=$'\033[1;31m'; GRAY=$'\033[90m'
else
  C0=""; CB=""; CD=""; CYAN=""; GREEN=""; YEL=""; RED=""; GRAY=""
fi

command -v liara >/dev/null 2>&1 || { echo "Liara CLI نصب نیست: npm install -g @liara/cli"; exit 1; }

# ── سربرگ وضعیت
printf "\n%s  ═══ LiaraPilot Logs │ اپ: %s%s%s ═══%s\n" "$CYAN" "$CB" "$APP" "$CYAN" "$C0"
WHOAMI="$(liara account whoami 2>/dev/null | head -1)"
[ -n "$WHOAMI" ] && printf "  %s%s%s\n" "$GRAY" "$WHOAMI" "$C0"

# ── تست سلامت سریع
HEALTH_URL="${HEALTH_URL:-}"
TARGET=""
if [ -n "$HEALTH_URL" ]; then TARGET="$HEALTH_URL"; else
  for D in "https://${APP}.ir.liara.run" "https://${APP}.liara.run"; do
    if curl -fsS --max-time 5 "${D}/api/health" 2>/dev/null | grep -q '"status":"ok"'; then TARGET="$D"; break; fi
  done
fi
if [ -n "$TARGET" ]; then
  printf "  %sوضعیت: سالم ✔  (%s)%s\n" "$GREEN" "$TARGET" "$C0"
else
  printf "  %sوضعیت: پاسخ سلامت نگرفتم (اپ ممکن است خاموش یا در حال build باشد) ▲%s\n" "$YEL" "$C0"
fi
printf "  %sرنگ‌ها: خطای قرمز │ هشدار زرد │ موفقیت سبز │ کوئری دیتابیس خاکستری کم‌رنگ%s\n" "$GRAY" "$C0"
printf "%s  ─────────────────────────────────────────────────────%s\n\n" "$GRAY" "$C0"

# ── رنگ‌آمیزی خطوط لاگ
colorize() {
  awk '
    tolower($0) ~ /error|failed|fatal|exception|✖|killed|oom/   { printf "\033[1;31m%s\033[0m\n", $0; next }
    tolower($0) ~ /warn|degraded|retry|timeout|▲/               { printf "\033[1;33m%s\033[0m\n", $0; next }
    /✓|✔|Ready|listening|success|status.:.ok/                    { printf "\033[1;32m%s\033[0m\n", $0; next }
    /prisma:query/                                               { printf "\033[2m%s\033[0m\n", $0; next }
    { printf "%s\n", $0 }
  '
}

trap 'printf "\n%s  خروج از نمایشگر لاگ.%s\n" "$GRAY" "$C0"; exit 0' INT

# ── لاگ اخیر
printf "%s  ■ آخرین رویدادها:%s\n\n" "$CB" "$C0"
liara app logs -a "$APP" -t 2>&1 | colorize | tail -n 60

# ── دنبال‌کردن زنده
if [ "$FOLLOW" = "1" ]; then
  printf "\n%s  ■ حالت زنده (Ctrl+C برای خروج):%s\n\n" "$CB" "$C0"
  liara app logs -a "$APP" -f -t 2>&1 | colorize
fi
