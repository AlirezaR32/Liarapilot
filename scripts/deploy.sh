#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  LiaraPilot — استقرار گرافیکی و گام‌به‌گام روی ابر لیارا
#
#  استفاده:
#     bash scripts/deploy.sh
#
#  تنظیمات اختیاری (متغیرهای محیطی):
#     LIARA_APP=liarapilot          شناسه‌ی اپ
#     LIARA_DISK=liarapilot-data    نام دیسک SQLite
#     LIARA_TEAM=                   شناسه‌ی تیم (در صورت کار تیمی)
#     LIARA_BUILD_LOCATION=iran     iran | germany
#     HEALTH_URL=                   دامنه‌ی دلخواه برای تست سلامت
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

APP="${LIARA_APP:-liarapilot}"
DISK="${LIARA_DISK:-liarapilot-data}"
TEAM="${LIARA_TEAM:-}"
BUILD_LOCATION="${LIARA_BUILD_LOCATION:-iran}"
MOUNT="/app/data"
DB_URL="file:${MOUNT}/liarapilot.db" # (info only — entrypoint injects this automatically)
HEALTH_URL="${HEALTH_URL:-}"

# ── رنگ‌ها (فقط وقتی خروجی ترمینال است)
if [ -t 1 ]; then
  C0=$'\033[0m'; CB=$'\033[1m'; CD=$'\033[2m'
  CYAN=$'\033[1;36m'; GREEN=$'\033[1;32m'; YEL=$'\033[1;33m'; RED=$'\033[1;31m'; GRAY=$'\033[90m'
else
  C0=""; CB=""; CD=""; CYAN=""; GREEN=""; YEL=""; RED=""; GRAY=""
fi

STEP_NO=0
hr()      { printf "%s  ─────────────────────────────────────────────────────%s\n" "$GRAY" "$C0"; }
step()    { STEP_NO=$((STEP_NO+1)); printf "\n%s  ═══════════════════════════════════════════════════════════%s\n%s  ■ مرحله %s │ %s%s\n%s  ═══════════════════════════════════════════════════════════%s\n" "$CYAN" "$C0" "$CB" "$STEP_NO" "$1" "$C0" "$CYAN" "$C0"; }
info()    { printf "  %s▸%s %s\n" "$CYAN" "$C0" "$1"; }
ok()      { printf "  %s✔%s %s\n" "$GREEN" "$C0" "$1"; }
warn()    { printf "  %s▲  %s%s\n" "$YEL" "$1" "$C0"; }
fail()    { printf "  %s✖ %s%s\n" "$RED" "$1" "$C0"; }
die()     { fail "$1"; printf "\n"; exit 1; }
TEAM_FLAG=""
[ -n "$TEAM" ] && TEAM_FLAG="--team-id $TEAM"

printf "\n%s  ╔══════════════════════════════════════════════════╗%s\n" "$CYAN" "$C0"
printf   "%s  ║%s        LiaraPilot — استقرار روی ابر لیارا        %s║%s\n" "$CYAN" "$CB" "$C0" "$CYAN"
printf   "%s  ╚══════════════════════════════════════════════════╝%s\n" "$CYAN" "$C0"

# ───────────────────────────────────────────────
step "بررسی پیش‌نیازها"
hr
command -v liara >/dev/null 2>&1 || die "Liara CLI نصب نیست. اجرا کنید:  npm install -g @liara/cli"
ok "Liara CLI: $(liara --version 2>/dev/null | head -1)"
[ -f liara.json ] || die "از ریشه‌ی پروژه اجرا کنید (فایل liara.json پیدا نشد)."
ok "liara.json پیدا شد (پلتفرم docker، پورت 3000، دیسک ${DISK})"
command -v curl >/dev/null 2>&1 || die "curl نصب نیست (برای تست سلامت لازم است)."
ok "curl موجود است"

# ───────────────────────────────────────────────
step "حساب کاربری لیارا"
hr
WHOAMI="$(liara account whoami 2>/dev/null)"
if [ -z "$WHOAMI" ]; then
  if [ ! -t 0 ]; then
    die "وارد حساب لیارا نشده‌اید. ابتدا اجرا کنید:  liara login --api-token=<توکن>"
  fi
  warn "وارد حساب نشده‌اید — فرایند ورود شروع می‌شود..."
  liara login || die "ورود ناموفق بود."
  WHOAMI="$(liara account whoami 2>/dev/null)"
fi
printf "%s\n" "$WHOAMI" | sed 's/^/  /'
ok "احراز هویت شد"
[ -n "$TEAM" ] && info "تیم هدف: ${TEAM} (با --team-id اعمال می‌شود)"

# ───────────────────────────────────────────────
step "بررسی/ساخت اپ «${APP}»"
hr
if liara app list 2>/dev/null | grep -qw "$APP"; then
  ok "اپ «${APP}» از قبل موجود است"
else
  warn "اپ «${APP}» پیدا نشد — تلاش برای ساخت..."
  if liara app create -a "$APP" --platform docker $TEAM_FLAG 2>&1 | sed 's/^/  /'; then
    ok "اپ ساخته شد"
  else
    # باگ شناخته‌شده‌ی CLI (Invalid count value: -1) — ناامید نمی‌شویم؛
    # خود liara deploy در مرحله‌ی بعد اپ را به‌صورت خودکار می‌سازد.
    warn "ساخت اپ با CLI ناموفق بود (باگ شناخته‌شده‌ی «Invalid count value: -1»)."
    info "ادامه می‌دهیم — «liara deploy» در مرحله‌ی بعد خودش اپ را می‌سازد."
    info "راه جایگزین: ساخت دستی از پنل console.liara.ir با پلتفرم Docker و همین نام."
  fi
fi

# ───────────────────────────────────────────────
step "دیسک ماندگار «${DISK}» (برای SQLite)"
hr
# نکته: CLI فرمان list برای دیسک ندارد؛ اگر دیسک از قبل باشد، create خطا می‌دهد و بی‌خطر است.
if liara disk create -a "$APP" -n "$DISK" -s 1 $TEAM_FLAG 2>&1 | sed 's/^/  /'; then
  ok "دیسک «${DISK}» آماده است (۱ گیگابایت، اتصال به ${MOUNT})"
else
  warn "دیسک «${DISK}» ساخته نشد — یا از قبل وجود دارد، یا باید از پنل بسازید."
  info "اگر deploy با خطای «Disk ... does not exist» متوقف شد: از پنل لیارا، داخل اپ ${APP}،"
  info "دیسکی به نام ${DISK} بسازید و به مسیر ${MOUNT} وصل کنید، سپس اسکریپت را دوباره اجرا کنید."
fi

# ───────────────────────────────────────────────
step "پیکربندی (بدون متغیر محیطی)"
hr
ok "هیچ متغیر محیطی لازم نیست — DATABASE_URL را entrypoint تزریق می‌کند."
info "کلید رمزنگاری توکن‌ها هم در اولین اجرا روی دیسک داده ساخته می‌شود."
info "سرویس‌ها (GitHub/GitLab/Liara/هوش مصنوعی) بعد از دیپلوی داخل خود اپ، در «تنظیمات» وصل می‌شوند."

# ───────────────────────────────────────────────
step "جمع‌بندی و تأیید"
hr
printf "  %sاپ:%s %s\n"      "$CB" "$C0" "$APP"
printf "  %sپلتفرم:%s Docker (build روی سرورهای لیارا)\n" "$CB" "$C0"
printf "  %sمنطقه build:%s %s\n" "$CB" "$C0" "$BUILD_LOCATION"
printf "  %sدیسک:%s %s → %s\n" "$CB" "$C0" "$DISK" "$MOUNT"
printf "  %sپیام release:%s deploy از اسکریپت\n" "$CB" "$C0"
hr
if [ -t 0 ]; then
  printf "  ادامه می‌دهیم؟ [Y/n] "
  read -r ANSWER
  case "$ANSWER" in n|N|no|NO) die "لغو شد." ;; esac
fi

# ───────────────────────────────────────────────
step "استقرار (لاگ رسمی build لیارا)"
hr
info "بعد از این مرحله: آپلود سورس → build ایمیج Docker → اجرا → health check"
info "مدت تقریبی build اول: ۳ تا ۶ دقیقه (نصب پکیج‌ها + next build)"
hr
if ! liara deploy -a "$APP" -b "$BUILD_LOCATION" -m "deploy via deploy.sh $(date '+%Y-%m-%d %H:%M')" $TEAM_FLAG; then
  printf "\n"
  fail "استقرار ناموفق بود. چک‌لیست:"
  info "۱) خطای Disk does not exist  → دیسک را از پنل بسازید و دوباره اجرا کنید"
  info "۲) خطای Could not find the app → با liara account whoami حساب و liara app list اپ را چک کنید"
  info "۳) خطای OOM/Killed وسط build   → پلن اپ را از پنل موقتاً بزرگ‌تر کنید (مثلاً g2)"
  exit 1
fi

# ───────────────────────────────────────────────
step "تست سلامت سرویس"
hr
CANDIDATES=()
[ -n "$HEALTH_URL" ] && CANDIDATES+=("$HEALTH_URL")
CANDIDATES+=("https://${APP}.ir.liara.run" "https://${APP}.liara.run")

TARGET=""
HEALTH_JSON=""
for i in $(seq 1 36); do
  for D in "${CANDIDATES[@]}"; do
    HEALTH_JSON="$(curl -fsS --max-time 5 "${D}/api/health" 2>/dev/null || true)"
    if printf "%s" "$HEALTH_JSON" | grep -q '"status":"ok"'; then
      TARGET="$D"
      break
    fi
  done
  [ -n "$TARGET" ] && break
  printf "\r  %sدر انتظار آماده‌شدن سرویس... تلاش %s/36%s   " "$GRAY" "$i" "$C0"
  sleep 5
done
printf "\r                                    \r"

if [ -n "$TARGET" ]; then
  ok "سرویس سالم است: ${TARGET}"
  printf "  %s%s%s\n" "$GRAY" "$(printf '%s' "$HEALTH_JSON" | sed 's/,/, /g')" "$C0"
else
  warn "هنوز پاسخ سلامت نگرفتم (build تازه تمام شده و راه‌اندازی ممکن است طول بکشد)."
  info "لاگ زنده را ببینید:  bash scripts/logs.sh"
  exit 0
fi

# ───────────────────────────────────────────────
printf "\n%s  ╔══════════════════════════════════════════════════╗%s\n" "$GREEN" "$C0"
printf   "%s  ║%s              ✔ استقرار با موفقیت انجام شد             %s║%s\n" "$GREEN" "$CB" "$C0" "$GREEN"
printf   "%s  ╚══════════════════════════════════════════════════╝%s\n" "$GREEN" "$C0"
printf "  %sآدرس برنامه:%s  %s\n"    "$CB" "$C0" "$TARGET"
printf "  %sلاگ گرافیکی:%s   bash scripts/logs.sh\n" "$CB" "$C0"
printf "  %sگام بعدی:%s      Load demo workspace را در UI بزنید و سناریوی استقرار را تست کنید\n" "$CB" "$C0"
printf "\n"
