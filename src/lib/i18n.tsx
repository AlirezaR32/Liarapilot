'use client';

// Lightweight i18n for LiaraPilot: Persian (fa, default, RTL) + English (en, LTR).
// Keys are the English source strings — English costs nothing, Persian is the
// dictionary below. Numbers interpolate as Persian digits; dates use the
// Jalali (Persian) calendar in fa mode. Choice persists in localStorage.

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

export type Locale = 'fa' | 'en';
export type Dir = 'rtl' | 'ltr';

const FA: Record<string, string> = {
  // ── nav / shell ──────────────────────────────────────────────────────────
  Overview: 'نمای کلی',
  Incidents: 'حوادث',
  Approvals: 'تأییدیه‌ها',
  Activity: 'فعالیت',
  Chat: 'گفت‌وگو',
  Settings: 'تنظیمات',
  'autonomous DevOps & SRE agent': 'ایجنت خودکار DevOps و SRE',
  'demo mode — mock providers': 'حالت نمایشی — سرویس‌های شبیه‌سازی',
  demo: 'نمایشی',
  'chatgpt': 'ChatGPT',
  'z-ai': 'z-ai',
  'ChatGPT ({model}) is answering': 'ChatGPT (مدل {model}) در حال پاسخ‌گویی است',
  'Built-in z-ai model answering — set OPENAI_API_KEY for ChatGPT':
    'مدل داخلی z-ai در حال پاسخ‌گویی است — برای ChatGPT مقدار OPENAI_API_KEY را تنظیم کنید',
  '{n} open': '{n} باز',
  '{n} awaiting approval': '{n} منتظر تأیید',
  Projects: 'پروژه‌ها',
  'Loading project…': 'در حال بارگذاری پروژه…',
  'Loading incident…': 'در حال بارگذاری حادثه…',
  'LiaraPilot MVP — evidence over assumptions. Consequential operations require approval; every action is audited.':
    'LiaraPilot — شواهد، نه حدس. عملیات مهم فقط با تأیید شما اجرا می‌شود و هر اقدام ثبت و قابل ردیابی است.',
  'Real integrations available (LIARA_API_TOKEN configured)': 'اتصال‌های واقعی فعال است (LIARA_API_TOKEN تنظیم شده)',
  'Demo mode: Liara/GitHub providers are clearly-labeled mocks': 'حالت نمایشی: سرویس‌های Liara/GitHub با برچسب شفاف شبیه‌سازی شده‌اند',
  // oauth notices
  'GitHub connected — your repositories are now analyzable.': 'گیت‌هاب متصل شد — مخزن‌های شما اکنون قابل تحلیل هستند.',
  'GitLab connected — your repositories are now analyzable.': 'گیت‌لب متصل شد — مخزن‌های شما اکنون قابل تحلیل هستند.',
  'OAuth was cancelled at the provider.': 'ورود OAuth در سرویس‌دهنده لغو شد.',
  'This OAuth provider is not configured on the server (missing client id/secret env).':
    'این سرویس‌دهنده OAuth روی سرور تنظیم نشده است (متغیرهای client id/secret موجود نیست).',
  'That provider identity is already linked to a different account.': 'این هویت قبلاً به حساب دیگری متصل شده است.',
  'The provider did not share a verified email — use a PAT or grant email scope.':
    'سرویس‌دهنده ایمیل تأییدشده را ارسال نکرد — از توکن دسترسی (PAT) استفاده کنید یا دسترسی email را بدهید.',
  'OAuth state mismatch — please retry.': 'عدم تطابق state در OAuth — لطفاً دوباره تلاش کنید.',
  'OAuth issue: {code}': 'مشکل OAuth: {code}',
  // ── overview ─────────────────────────────────────────────────────────────
  'Repository name is required': 'نام مخزن الزامی است',
  'Repository connected — analysis started automatically': 'مخزن متصل شد — تحلیل به‌صورت خودکار آغاز شد',
  'Demo workspace loaded: 3 labeled fixture projects + Scenario B incident driven': 'فضای کاری نمایشی بارگذاری شد: ۳ پروژه نمونه + سناریوی حادثه',
  'Workspace reset': 'فضای کاری بازنشانی شد',
  '{n} action(s) awaiting your approval': '{n} عملیات منتظر تأیید شماست',
  'The agent paused before performing consequential operations. Open the Approvals view to review evidence and decide.':
    'ایجنت پیش از انجام عملیات حساس متوقف شده است. برای بررسی شواهد و تصمیم‌گیری، بخش «تأییدیه‌ها» را باز کنید.',
  'Needs attention': 'نیازمند توجه',
  'Connected repositories the agent watches and operates on.': 'مخزن‌های متصلی که ایجنت پایش و مدیریت می‌کند.',
  'Load demo workspace': 'بارگذاری فضای کاری نمایشی',
  Reset: 'بازنشانی',
  'No projects connected yet': 'هنوز پروژه‌ای متصل نشده است',
  'Connect a repository below, or load the labeled demo workspace to explore all flows.':
    'مخزن خود را از پایین متصل کنید، یا برای مرور همه سناریوها فضای کاری نمایشی را بارگذاری کنید.',
  'no checks yet': 'هنوز بررسی‌ای ثبت نشده',
  'Liara app': 'اپلیکیشن لیارا',
  'not created': 'ساخته نشده',
  'Deployed rev': 'نسخه مستقرشده',
  '{n} open incident(s)': '{n} حادثه باز',
  'Connect a repository': 'اتصال یک مخزن',
  'Git provider': 'سرویس‌دهنده گیت',
  owner: 'مالک (owner)',
  'group / owner': 'گروه / مالک',
  'repository-name': 'نام-مخزن',
  'Connect & analyze': 'اتصال و تحلیل',
  'Demo mode analyzes the bundled labeled fixture repository. Connect your own GitHub/GitLab token in Settings, or set GITHUB_TOKEN/GITLAB_TOKEN env, and real public/private repositories are analyzed via targeted reads. Connection triggers automatic analysis only — never an automatic deployment.':
    'در حالت نمایشی، مخزن نمونهٔ همراه برنامه تحلیل می‌شود. توکن GitHub/GitLab خود را در «تنظیمات» متصل کنید یا متغیر GITHUB_TOKEN/GITLAB_TOKEN را تنظیم کنید تا مخزن‌های واقعی (عمومی/خصوصی) با خواندن هدفمند تحلیل شوند. اتصال فقط تحلیل خودکار را آغاز می‌کند — هرگز استقرار خودکار انجام نمی‌شود.',
  'connect failed': 'اتصال ناموفق بود',
  'seed failed': 'بارگذاری نمونه ناموفق بود',
  'reset failed': 'بازنشانی ناموفق بود',
  // ── repositories browser (my repos → deploy → link) ─────────────────────
  'Repositories': 'مخازن من',
  'My repositories from GitHub & GitLab — pick one and deploy it to Liara.': 'مخزن‌های شما در گیت‌هاب و گیت‌لب — یکی را انتخاب کنید و روی لیارا مستقر کنید.',
  'Select from my repositories': 'انتخاب از مخازن من',
  'Refresh list': 'به‌روزرسانی فهرست',
  'Search repositories…': 'جستجوی مخزن…',
  '{n} repos': '{n} مخزن',
  'Connect GitHub or GitLab first': 'ابتدا گیت‌هاب یا گیت‌لب را وصل کنید',
  'Your repositories appear here once you connect your GitHub/GitLab account — browser login or a personal token, both from Settings.':
    'مخزن‌های شما پس از اتصال حساب GitHub/GitLab اینجا نمایش داده می‌شوند — ورود با مرورگر یا توکن شخصی، هر دو از «تنظیمات».',
  'No repositories found — the connected account has no accessible repositories.': 'مخزنی پیدا نشد — حساب متصل به مخزن قابل دسترسی‌ای ندارد.',
  'No repositories matched your search.': 'مخزنی با این جستجو پیدا نشد.',
  'private': 'خصوصی',
  'public': 'عمومی',
  'fork': 'فورک',
  'connected': 'متصل',
  'updated': 'به‌روزرسانی',
  'Open project': 'باز کردن پروژه',
  'Connect & deploy': 'اتصال و استقرار',
  'Connecting…': 'در حال اتصال…',
  'Repository connected — deploy pipeline started, pausing at the approval gate': 'مخزن متصل شد — خط تولید استقرار آغاز شد و در دروازهٔ تأیید می‌ایستد',
  'Deploys always pause at the approval gate — nothing runs on Liara until you approve. The first approved deploy also creates the app (cheapest plan) if it does not exist.':
    'استقرار همیشه در دروازهٔ تأیید می‌ایستد — تا وقتی تأیید نکنید هیچ چیزی روی لیارا اجرا نمی‌شود. اولین استقرارِ تأییدشده، اگر اپ وجود نداشته باشد آن را می‌سازد (ارزان‌ترین پلن).',
  // ── final link + approval handoff ────────────────────────────────────────
  'Your app is live on Liara': 'اپلیکیشن شما روی لیارا فعال است',
  'Copy link': 'کپی لینک',
  'Link copied': 'لینک کپی شد',
  'Open app': 'باز کردن اپلیکیشن',
  'Deployment needs your approval': 'استقرار منتظر تأیید شماست',
  'The pipeline paused at the approval gate — review the plan and approve to continue.':
    'خط تولید در دروازهٔ تأیید متوقف شده است — برنامه را بررسی کنید و برای ادامه تأیید بدهید.',
  'Go to approvals': 'رفتن به تأییدیه‌ها',
  // ── guide: in-app deploy step ────────────────────────────────────────────
  'Take LiaraPilot live on the Liara platform — in seven guided steps': 'LiaraPilot را روی پلتفرم لیارا اجرا کنید — در هفت گام راهنمادار',
  'Deploy YOUR repositories from inside the app': 'استقرار مخزن‌های خودتان از داخل همین برنامه',
  'Open «Repositories», pick one of YOUR GitHub/GitLab repos and hit «Connect & deploy». The pipeline pauses at the approval gate — after you approve, the agent downloads the repo at that exact revision, builds it on Liara (auto-creating the app on the cheapest plan when needed) and shows your final link.':
    '«مخازن من» را باز کنید، یکی از مخزن‌های GitHub/GitLab خودتان را انتخاب و «اتصال و استقرار» را بزنید. خط تولید در دروازهٔ تأیید می‌ایستد — پس از تأیید شما، ایجنت سورس مخزن را در همان revision دانلود می‌کند، روی لیارا بیلد می‌کند (اگر اپ وجود نداشته باشد با ارزان‌ترین پلن ساخته می‌شود) و در پایان لینک نهایی شما را نشان می‌دهد.',
  'Live build logs stream into the progress card while Liara builds — no guessing about what went wrong.':
    'در حین بیلد روی لیارا، لاگ‌های زنده در کارت پیشرفت نمایش داده می‌شود — دیگر حدس‌وزدن دربارهٔ علت خطا نیست.',
  'The agent writes a minimal liara.json (detected platform) only when the repo has none — your own liara.json always wins.':
    'ایجنت فقط وقتی مخزن liara.json ندارد، یک فایل کمینه با پلتفرم تشخیص‌داده‌شده می‌نویسد — liara.json خودِ پروژه همیشه اولویت دارد.',
  'After success the project page shows the live link with copy/open buttons — monitoring probes it automatically.':
    'بعد از موفقیت، صفحهٔ پروژه لینک فعال را با دکمهٔ کپی/باز کردن نشان می‌دهد — پایش خودکار هم همان را پروب می‌کند.',
  // ── project detail ───────────────────────────────────────────────────────
  'healthy': 'سالم',
  'HTTP 500 errors': 'خطای HTTP 500',
  'timeouts': 'تایم‌اوت',
  'build failure (deploy)': 'شکست بیلد (استقرار)',
  'start failure (deploy)': 'شکست اجرا (استقرار)',
  'Deployment pipeline started — it will pause at the approval gate':
    'خط لوله استقرار آغاز شد — پیش از اجرا روی دروازهٔ تأیید توقف می‌کند',
  'Fresh analysis complete (bypassed cache)': 'تحلیل تازه کامل شد (بدون استفاده از کش)',
  'Simulated app behavior set to "{mode}" — demo control only': 'رفتار شبیه‌سازی‌شدهٔ برنامه روی «{mode}» تنظیم شد — فقط برای حالت نمایشی',
  'Monitoring policy set to {policy}': 'سیاست پایش روی {policy} تنظیم شد',
  'never deployed': 'هرگز مستقر نشده',
  'deployed @ {sha}': 'مستقرشده با کامیت {sha}',
  'Re-analyze': 'تحلیل دوباره',
  'Request deployment': 'درخواست استقرار',
  'Workflow progress (live)': 'پیشرفت زندهٔ گردش‌کار',
  'What the agent discovered': 'کشف‌های ایجنت',
  Language: 'زبان',
  Framework: 'فریم‌ورک',
  'Package manager': 'مدیر بسته',
  'Node version': 'نسخه Node',
  Build: 'دستور بیلد',
  Start: 'دستور اجرا',
  Port: 'پورت',
  Dockerfile: 'داکرفایل',
  yes: 'دارد',
  no: 'ندارد',
  'Required env vars (names only — values never read)': 'متغیرهای محیطی لازم (فقط نام — مقدارها هرگز خوانده نمی‌شوند)',
  '* required (empty value in .env.example)': '* الزامی (مقدار خالی در .env.example)',
  'Blockers:': 'مانع‌ها:',
  'Evidence ({n}) — progressive disclosure': 'شواهد ({n}) — نمایش تدریجی',
  'README excerpt (untrusted content, never executed)': 'گزیدهٔ README (محتوای غیرمعتبر، هرگز اجرا نمی‌شود)',
  'Analyzed {time} @ {sha}': 'تحلیل‌شده {time} با کامیت {sha}',
  'No analysis yet — connect triggers it automatically.': 'هنوز تحلیلی وجود ندارد — اتصال مخزن آن را خودکار آغاز می‌کند.',
  'Plans & executions': 'برنامه‌ها و اجراها',
  'No plans yet. Request a deployment to generate one.': 'هنوز برنامه‌ای نیست. با درخواست استقرار، برنامه ساخته می‌شود.',
  'Plan {sha} · {method}': 'برنامهٔ {sha} · {method}',
  'Risks: {risk}': 'ریسک‌ها: {risk}',
  'Missing env: {vars}': 'متغیرهای غایب: {vars}',
  'mock execution': 'اجرای شبیه‌سازی',
  'attempts: {n} · exit: {code}': 'تلاش‌ها: {n} · کد خروج: {code}',
  'Monitoring & demo controls': 'پایش و کنترل‌های نمایشی',
  'Monitoring policy': 'سیاست پایش',
  'low-cost (5 min interval, fewer investigations)': 'کم‌هزینه (بازهٔ ۵ دقیقه، تحلیل‌های کمتر)',
  'balanced (1 min interval)': 'متعادل (بازهٔ ۱ دقیقه)',
  'fast detection (30s interval, higher cost)': 'تشخیص سریع (بازهٔ ۳۰ ثانیه، هزینهٔ بیشتر)',
  'Trade-off: slower detection = fewer LLM/probe calls.': 'موازنه: تشخیص کندتر = فراخوانی کمترِ LLM و پروب.',
  'Simulated app behavior': 'رفتار شبیه‌سازی‌شدهٔ برنامه',
  'demo only': 'فقط نمایشی',
  'Drives the bundled simulated target app for incident scenarios.': 'اپلیکیشن هدفِ شبیه‌سازی‌شدهٔ همراه برنامه را برای سناریوهای حادثه کنترل می‌کند.',
  'Open incidents': 'حوادث باز',
  'None — service healthy.': 'هیچ — سرویس سالم است.',
  'Latest workflow': 'آخرین گردش‌کار',
  'Health history: {up}/{total} checks up (last 40)': 'تاریخچهٔ سلامت: {up} از {total} بررسی سالم (از ۴۰ مورد اخیر)',
  // ── incidents ────────────────────────────────────────────────────────────
  'No incidents': 'حادثه‌ای وجود ندارد',
  'The lightweight monitor (plain code, no LLM) keeps watching connected services.':
    'پایشگر سبک (کد ساده، بدون LLM) دائماً سرویس‌های متصل را تحت نظر دارد.',
  'first seen {first} · last {last}': 'اولین مشاهده {first} · آخرین {last}',
  diagnosed: 'تشخیص داده‌شده',
  'remediation proposed': 'راهکار اصلاحی پیشنهاد شد',
  'Investigation started — evidence is collected deterministically; the LLM is only invoked for diagnosis':
    'بررسی آغاز شد — شواهد به‌صورت قطعی جمع می‌شود؛ LLM فقط برای تشخیص به کار می‌رود',
  'Run investigation': 'اجرای بررسی',
  'Investigation progress (live)': 'پیشرفت زندهٔ بررسی',
  'Diagnosis (correlation is not causation)': 'تشخیص (همبستگی به معنای علیّت نیست)',
  'Observed facts': 'مشاهدات ثبت‌شده',
  'Probable causes': 'علل محتمل',
  'confidence: {c}': 'اطمینان: {c}',
  'Uncertainty: {u}': 'ابهام: {u}',
  'Impact: {i}': 'اثر: {i}',
  'Proposed remediation (smallest reversible action)': 'راهکار اصلاحی پیشنهادی (کوچک‌ترین اقدام بازگشت‌پذیر)',
  'View proposed patch (diff — never auto-applied)': 'مشاهدهٔ پچ پیشنهادی (diff — هرگز خودکار اعمال نمی‌شود)',
  'Review pending approval': 'مرور تأییدیهٔ در انتظار',
  'Evidence package (bounded & redacted)': 'بستهٔ شواهد (محدود و پاک‌سازی‌شده)',
  'Health checks ({n})': 'بررسی‌های سلامت ({n})',
  'Log evidence (redacted, bounded)': 'شواهد لاگ (پاک‌سازی‌شده و محدود)',
  'Recent deployments': 'استقرارهای اخیر',
  // ── approvals ────────────────────────────────────────────────────────────
  'Approved — workflow resumes from the approval gate': 'تأیید شد — گردش‌کار از دروازهٔ تأیید ادامه می‌یابد',
  'Rejected — no action will be taken': 'رد شد — هیچ اقدامی اجرا نمی‌شود',
  'Approval queue is empty': 'صف تأییدیه خالی است',
  'Consequential operations (deploys, restarts, env changes) pause here for your decision.':
    'عملیات حساس (استقرار، ری‌استارت، تغییر متغیرهای محیطی) برای تصمیم شما اینجا توقف می‌کنند.',
  'These requests are policy-bound: the approval is tied to the exact plan hash and expires. Changing the plan invalidates the approval.':
    'این درخواست‌ها به سیاست مقیدند: هر تأیید به هش دقیق همان برنامه گره خورده و مهلت دارد. تغییر برنامه، تأیید را باطل می‌کند.',
  'Why approval is required': 'چرا تأیید لازم است',
  'Reversibility:': 'بازگشت‌پذیری:',
  reversible: 'بازگشت‌پذیر',
  'hard to reverse': 'به‌سختی بازگشت‌پذیر',
  'Expires in {t} ({time})': 'مهلت تا {t} ({time})',
  '{h}h {m}m': '{h} ساعت و {m} دقیقه',
  '{m}m': '{m} دقیقه',
  'If it fails: {x}': 'اگر شکست بخورد: {x}',
  'see plan': 'برنامه را ببینید',
  'Inspect exact payload & evidence': 'بازبینی دقیق payload و شواهد',
  'Optional note for the audit trail…': 'یادداشت اختیاری برای ردپای حسابرسی…',
  'Approve & execute': 'تأیید و اجرا',
  Reject: 'رد',
  'Decision recorded {t} — audit trail updated.': 'تصمیم {t} ثبت شد — ردپای حسابرسی به‌روزرسانی شد.',
  'decision failed': 'ثبت تصمیم ناموفق بود',
  // ── activity ─────────────────────────────────────────────────────────────
  'Cost controls (last {n}h)': 'کنترل هزینه ({n} ساعت اخیر)',
  'LLM investigations': 'بررسی‌های LLM',
  'Health checks': 'بررسی‌های سلامت',
  '{kind} tokens': 'توکن‌های {kind}',
  'Liara capability registry (honest boundaries)': 'فهرست توانمندی‌های لیارا (با مرزهای صادقانه)',
  'loading registry…': 'در حال بارگذاری فهرست…',
  'Audit trail (every important operation is traceable)': 'ردپای حسابرسی (هر عمل مهم قابل ردیابی است)',
  'No audit events yet.': 'هنوز رویداد حسابرسی ثبت نشده است.',
  // ── chat ─────────────────────────────────────────────────────────────────
  'Contextual chat': 'گفت‌وگوی زمینه‌ای',
  'Same context and permissions as the agent — it answers from evidence, never fabricates.':
    'همان زمینه و دسترسی‌های ایجنت — فقط بر پایهٔ شواهد پاسخ می‌دهد، هرگز نمی‌سازد.',
  'Try asking:': 'می‌توانید بپرسید:',
  'What did you discover about this project?': 'دربارهٔ این پروژه چه کشف کردی؟',
  'Why is the service failing right now?': 'چرا سرویس همین الان دچار مشکل شده؟',
  'What do you need my approval for, and why?': 'به تأیید من برای چه کاری نیاز داری و چرا؟',
  'What changed in the last deployment?': 'در آخرین استقرار چه چیزی تغییر کرد؟',
  'thinking…': 'در حال فکر کردن…',
  'Ask about {name}…': 'دربارهٔ {name} بپرسید…',
  'Ask about your workspace…': 'دربارهٔ فضای کاری خود بپرسید…',
  'Error: {msg}': 'خطا: {msg}',
  'chat failed': 'گفت‌وگو ناموفق بود',
  send: 'ارسال',
  // ── settings ─────────────────────────────────────────────────────────────
  'not connected': 'متصل نیست',
  'connected · via {via}': 'متصل · از طریق {via}',
  pat: 'توکن دسترسی',
  oauth: 'OAuth',
  'Settings & Connections': 'تنظیمات و اتصال‌ها',
  'No site login is needed — the workspace is open. Connect the services the agent operates with: GitHub, GitLab, ChatGPT and the Liara platform. Tokens are validated against the provider, then stored AES-256-GCM encrypted — the plaintext is never shown again.':
    'ورود به سایت لازم نیست — فضای کاری آزاد است. سرویس‌هایی را که ایجنت با آن‌ها کار می‌کند متصل کنید: گیت‌هاب، گیت‌لب، ChatGPT و سکوی لیارا. توکن‌ها اول در سرویس‌دهنده اعتبارسنجی می‌شوند، سپس با رمزنگاری AES-256-GCM ذخیره می‌شوند — متن آشکار توکن هرگز دوباره نمایش داده نمی‌شود.',
  'Connect to analyze private repositories with your own token, and to unlock higher API rate limits.':
    'برای تحلیل مخزن‌های خصوصی با توکن خودتان و دسترسی به سقف نرخ بالاتر API متصل شوید.',
  'env GITHUB_TOKEN {mask}': 'متغیر GITHUB_TOKEN: {mask}',
  'Connect token': 'اتصال با توکن',
  Disconnect: 'قطع اتصال',
  'Connect with GitHub OAuth': 'اتصال با OAuth گیت‌هاب',
  'OAuth connect (one-click, no token pasting) unlocks after setting GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET env vars. A classic PAT with repo scope works right now.':
    'اتصال OAuth (یک‌کلیکی، بدون جای‌گذاری توکن) پس از تنظیم متغیرهای GITHUB_CLIENT_ID و GITHUB_CLIENT_SECRET فعال می‌شود. یک PAT کلاسیک با دسترسی repo همین حالا هم کار می‌کند.',
  'gitlab.com or any self-hosted instance. Personal access token needs read_api (or api) scope.':
    'gitlab.com یا هر نمونهٔ self-hosted. توکن دسترسی شخصی باید دسترسی read_api (یا api) داشته باشد.',
  'Connect with GitLab OAuth': 'اتصال با OAuth گیت‌لب',
  'OAuth connect unlocks after setting GITLAB_CLIENT_ID + GITLAB_CLIENT_SECRET (add GITLAB_URL for self-hosted instances).':
    'اتصال OAuth پس از تنظیم GITLAB_CLIENT_ID و GITLAB_CLIENT_SECRET فعال می‌شود (برای نمونهٔ self-hosted مقدار GITLAB_URL را هم بدهید).',
  'GitHub connected': 'گیت‌هاب متصل شد',
  'verified as @{login} — private repos of this account are now analyzable': 'تأییدشده به‌عنوان @{login} — مخزن‌های خصوصی این حساب اکنون قابل تحلیل‌اند',
  'GitHub connection failed': 'اتصال گیت‌هاب ناموفق بود',
  'GitLab connected': 'گیت‌لب متصل شد',
  'verified as @{login} on {url}': 'تأییدشده به‌عنوان @{login} روی {url}',
  'GitLab connection failed': 'اتصال گیت‌لب ناموفق بود',
  'GitHub disconnected': 'اتصال گیت‌هاب قطع شد',
  'GitLab disconnected': 'اتصال گیت‌لب قطع شد',
  // LLM brain
  'ChatGPT (OpenAI) — agent brain': 'ChatGPT (OpenAI) — مغز ایجنت',
  'Where the LLM is used for decision-making:': 'جاهایی که LLM برای تصمیم‌گیری به کار می‌رود:',
  'Chat replies — grounded in the workspace evidence.': 'پاسخ‌های گفت‌وگو — بر پایهٔ شواهد فضای کاری.',
  'Incident diagnosis — root-cause analysis, confidence and impact, from bounded evidence.': 'تشخیص حادثه — تحلیل ریشه‌ای، سطح اطمینان و اثر، از شواهد محدود.',
  'Deploy reports & plan rationales — explains why each step is safe to run.': 'گزارش‌های استقرار و توجیه برنامه‌ها — توضیح می‌دهد چرا هر گام امن است.',
  'active: ChatGPT': 'فعال: ChatGPT',
  'active: z-ai built-in': 'فعال: مدل داخلی z-ai',
  'model: {m}': 'مدل: {m}',
  'OPENAI_API_KEY not set — using fallback': 'OPENAI_API_KEY تنظیم نشده — از جایگزین استفاده می‌شود',
  'To switch the brain to ChatGPT: 1) get an API key from platform.openai.com, 2) set it on the server: liara env set OPENAI_API_KEY=sk-… -a your-app (or put it in .env locally), 3) restart the app — the badge turns to chatgpt. Optional: OPENAI_MODEL (default gpt-4o-mini), OPENAI_BASE_URL, LLM_PROVIDER=openai|zai|auto. If OpenAI fails, the built-in z-ai model answers automatically — the agent never goes down.':
    'برای اتصال مغز ایجنت به ChatGPT: ۱) از platform.openai.com یک کلید API بگیرید، ۲) روی سرور تنظیمش کنید: liara env set OPENAI_API_KEY=sk-… -a your-app (یا در .env محلی)، ۳) برنامه را ری‌استارت کنید — نشانِ هدر به ChatGPT تغییر می‌کند. اختیاری: OPENAI_MODEL (پیش‌فرض gpt-4o-mini)، OPENAI_BASE_URL و LLM_PROVIDER=openai|zai|auto. اگر OpenAI در دسترس نباشد، مدل داخلی z-ai خودکار پاسخ می‌دهد — ایجنت هرگز از کار نمی‌افتد.',
  // liara platform card
  'Real operations (deploy/restart/scale/logs) run only when the server has LIARA_API_TOKEN.':
    'عملیات واقعی (استقرار/ری‌استارت/مقیاس/لاگ) فقط وقتی اجرا می‌شود که سرور LIARA_API_TOKEN داشته باشد.',
  'LIARA_API_TOKEN configured {mask}': 'LIARA_API_TOKEN تنظیم شده {mask}',
  'not configured — running in clearly-labeled mock mode': 'تنظیم نشده — در حالت نمایشیِ برچسب‌دار اجرا می‌شود',
  'Set it with liara env set LIARA_API_TOKEN=… -a your-app (token from Liara panel → API Token), then restart the app. The Liara CLI is bundled inside the deployed image, so approved operations run against your real apps.':
    'با دستور liara env set LIARA_API_TOKEN=… -a your-app تنظیم کنید (توکن از پنل لیارا ← API Token)، سپس برنامه را ری‌استارت کنید. ابزار CLI لیارا داخل ایمیج مستقرشده هست، پس عملیاتِ تأییدشده روی اپ‌های واقعی شما اجرا می‌شود.',
  // ── stages ───────────────────────────────────────────────────────────────
  Queued: 'در صف',
  'Reading repository': 'خواندن مخزن',
  'Analyzing configuration': 'تحلیل پیکربندی',
  'Checking infrastructure': 'بررسی زیرساخت',
  'Assessing readiness': 'ارزیابی آمادگی',
  'Preparing plan': 'آماده‌سازی برنامه',
  'Validating policy': 'اعتبارسنجی سیاست',
  'Waiting for your approval': 'منتظر تأیید شما',
  'Executing operation': 'اجرای عملیات',
  'Verifying service health': 'بررسی سلامت سرویس',
  'Preparing report': 'آماده‌سازی گزارش',
  Completed: 'کامل شد',
  Failed: 'شکست خورد',
  'Collecting evidence': 'جمع‌آوری شواهد',
  'Investigating (LLM)': 'در حال بررسی (LLM)',
  'Planning remediation': 'برنامه‌ریزی اصلاح',
  'Applying remediation': 'اعمال اصلاح',
  'Verifying recovery': 'بررسی بهبودی',
  Resuming: 'از سرگیری',
  // ── statuses ─────────────────────────────────────────────────────────────
  succeeded: 'موفق',
  resolved: 'حل‌شده',
  up: 'بالاست',
  approved: 'تأییدشده',
  executed: 'اجرا شد',
  running: 'در حال اجرا',
  investigating: 'در حال بررسی',
  verifying: 'در حال راستی‌آزمایی',
  detected: 'تشخیص داده شد',
  'awaiting approval': 'منتظر تأیید',
  pending: 'در انتظار',
  degraded: 'تنزل‌یافته',
  failed: 'شکست خورده',
  down: 'خارج از سرویس',
  rejected: 'ردشده',
  escalated: 'ارجاع‌شده',
  timeout: 'تایم‌اوت',
  unhealthy: 'ناسالم',
  cancelled: 'لغوشده',
  // ── misc bits ────────────────────────────────────────────────────────────
  'demo/mock': 'نمایشی/شبیه‌سازی',
  'real mode': 'حالت واقعی',
  'No evidence recorded.': 'شواهدی ثبت نشده است.',
  '(no output)': '(بدون خروجی)',
  'health: {status}': 'سلامت: {status}',
  'Waiting for workflow events…': 'در انتظار رویدادهای گردش‌کار…',
  details: 'جزئیات',
  'The workflow is paused durably and will resume from the approval gate — even if the server restarts. Go to Approvals to decide.':
    'گردش‌کار به‌صورت پایدار متوقف شده و از دروازهٔ تأیید ادامه می‌یابد — حتی اگر سرور ری‌استارت شود. برای تصمیم به «تأییدیه‌ها» بروید.',
  'waiting for your approval': 'منتظر تأیید شما',
  // time
  '{n}s ago': '{n} ثانیه پیش',
  '{n}m ago': '{n} دقیقه پیش',
  '{n}h ago': '{n} ساعت پیش',
  '{n}d ago': '{n} روز پیش',
  'just now': 'همین حالا',
  // language
  'Switch language': 'تغییر زبان',
  trigger: 'محرک',
  verified: 'تأییدشده',
  'documented unverified': 'مستند—تأییدنشده',
  'CLI only': 'فقط CLI',
  unsupported: 'پشتیبانی‌نشده',

  // ── nav (new views) ─────────────────────────────────────────────────────
  Dashboard: 'داشبورد',
  'Deploy guide': 'راهنما',

  // ── overview hero / summary ─────────────────────────────────────────────
  'Live workspace summary': 'خلاصه زنده فضای کاری',
  '{n} projects connected, {m} deployed on Liara, {k} open incidents':
    '{n} پروژه متصل، {m} مستقرشده روی لیارا، {k} حادثه باز',
  'The agent is waiting for your decision on {n} operation(s).': 'ایجنت منتظر تصمیم شما برای {n} عملیات است.',
  'No pending decisions — the agent only acts after your explicit approval.':
    'تصمیم معلقی در کار نیست — ایجنت فقط با تأیید صریح شما عمل می‌کند.',
  'Full dashboard': 'داشبورد کامل',
  'Latest events': 'آخرین اتفاق‌ها',
  'View all activity': 'مشاهده همه فعالیت‌ها',
  'No events yet — load the demo workspace or connect a repository to see the agent in action.':
    'هنوز رخدادی نیست — فضای کاری نمایشی را بارگذاری کنید یا مخزنی متصل کنید تا ایجنت را در عمل ببینید.',
  deployed: 'مستقرشده',
  'pending approvals': 'تأییدهای معلق',
  'open incidents': 'حوادث باز',
  you: 'شما',
  system: 'سیستم',
  agent: 'ایجنت',
  'approval requested': 'درخواست تأیید',
  'approval granted': 'تأیید صادر شد',
  'approval denied': 'تأیید رد شد',
  'approval expired': 'تأیید منقضی شد',
  'execution started': 'اجرای عملیات آغاز شد',
  'execution finished': 'اجرای عملیات پایان یافت',
  'incident opened': 'حادثه باز شد',
  'incident resolved': 'حادثه حل شد',
  'policy validated': 'سیاست اعتبارسنجی شد',
  'deploy requested': 'استقرار درخواست شد',
  'repository connected': 'مخزن متصل شد',
  'analysis requested': 'تحلیل درخواست شد',
  'GitHub token connected': 'توکن گیت‌هاب متصل شد',
  'GitLab token connected': 'توکن گیت‌لب متصل شد',
  'demo workspace loaded': 'فضای کاری نمایشی بارگذاری شد',

  // ── dashboard ───────────────────────────────────────────────────────────
  'Loading dashboard…': 'در حال بارگذاری داشبورد…',
  'stats unavailable': 'آمار در دسترس نیست',
  'Agent runs — last 14 days': 'اجراهای ایجنت — ۱۴ روز گذشته',
  'Deploy pipelines, investigations and chat assists per day': 'خط لوله استقرار، بررسی حادثه و کمک گفت‌وگو در هر روز',
  'succeeded runs': 'اجراهای موفق',
  'failed runs': 'اجراهای ناموفق',
  'active runs': 'اجراهای در جریان',
  'Status mix (14 days)': 'ترکیب وضعیت‌ها (۱۴ روز)',
  'other statuses': 'سایر وضعیت‌ها',
  'deploy success rate': 'نرخ موفقیت استقرار',
  'Connected projects': 'پروژه‌های متصل',
  '{n} deployed on Liara': '{n} مستقرشده روی لیارا',
  'Runs (14 days)': 'اجراها (۱۴ روز)',
  '{n} active right now': '{n} در حال اجرا',
  '{n} resolved so far': '{n} حل‌شده تا کنون',
  'Awaiting approval': 'منتظر تأیید',
  '{n} approved · {n2} rejected': '{n} تأییدشده · {n2} ردشده',
  'Health checks (24h)': 'بررسی‌های سلامت (۲۴ ساعت)',
  'total checks': 'کل بررسی‌ها',
  'uptime rate': 'نرخ در دسترس‌بودن',
  'avg latency': 'میانگین تأخیر',
  'open incidents view': 'باز کردن نمای حوادث',
  'Incidents by kind': 'حوادث بر اساس نوع',
  'No incidents recorded — all clear.': 'حادثه‌ای ثبت نشده — همه‌چیز مرتب است.',
  'http 5xx': 'خطای HTTP 5xx',
  'deployment failed': 'شکست استقرار',
  'resource threshold': 'عبور از آستانه منابع',
  'Recent runs': 'اجراهای اخیر',
  'No runs yet — connect a project and request a deployment.': 'هنوز اجرایی ثبت نشده — پروژه‌ای متصل کنید و استقرار بخواهید.',
  'Deploy pipeline': 'خط لوله استقرار',
  'Incident investigation': 'بررسی حادثه',
  'Chat assist': 'کمک گفت‌وگو',
  workspace: 'فضای کاری',
  'Connected services': 'سرویس‌های متصل',
  'Decision engine (LLM)': 'مغز تصمیم‌گیر (LLM)',
  'model {model}': 'مدل {model}',
  'Built-in model — add OPENAI_API_KEY for ChatGPT': 'مدل داخلی — برای ChatGPT مقدار OPENAI_API_KEY را اضافه کنید',
  connected: 'متصل',
  'env fallback': 'پشتیبان محیطی',
  'Connect a token in Settings': 'توکن را در «تنظیمات» متصل کنید',
  'Liara platform': 'پلتفرم لیارا',
  'real operations': 'عملیات واقعی',
  'demo mode': 'حالت نمایشی',
  'LIARA_API_TOKEN configured — CLI/API operations are real': 'LIARA_API_TOKEN تنظیم شده — عملیات CLI/API واقعی است',
  'Set LIARA_API_TOKEN for real deploys': 'برای استقرار واقعی، LIARA_API_TOKEN را تنظیم کنید',
  'Tokens are stored as encrypted references and always masked in UI/logs.':
    'توکن‌ها به‌صورت مرجع رمزنگاری‌شده ذخیره می‌شوند و در رابط و لاگ‌ها همیشه ماسک هستند.',

  // ── deploy guide ────────────────────────────────────────────────────────
  'Copy command': 'کپی دستور',
  'Liara deployment guide': 'راهنمای استقرار روی لیارا',
  'Take LiaraPilot live on the Liara platform — in five guided steps':
    'لیاراپایلوت را روی پلتفرم لیارا در پنج گام راهنمادار بالا بیاورید',
  'The project already ships with liara.json, a multi-stage Dockerfile and an idempotent entrypoint (automatic prisma db push). All you need is an API token and a disk.':
    'پروژه از قبل liara.json، داکرفایل چندمرحله‌ای و entrypoint مقاوم (db push خودکار Prisma) دارد. فقط یک API Token و یک دیسک لازم دارید.',
  'Log in to the Liara CLI': 'ورود به CLI لیارا',
  'From the Liara panel, create an API Token (Panel → API Token), then log in locally. The same token can later be set as LIARA_API_TOKEN for the deployed agent to perform real operations.':
    'از پنل لیارا یک API Token بسازید (پنل → API Token) و سپس در سیستم خود وارد شوید. همین توکن را بعداً می‌توانید به‌عنوان LIARA_API_TOKEN تنظیم کنید تا ایجنتِ مستقرشده عملیات واقعی انجام دهد.',
  'Create the persistent disk (before the first deploy)': 'ساخت دیسک پایدار (پیش از اولین دیپلوی)',
  'SQLite needs a persistent disk mounted at /app/data. Create it once — it must exist before the first deployment, otherwise the deploy fails with “Disk does not exist”.':
    'SQLite به یک دیسک پایدار متصل‌شده در /app/data نیاز دارد. یک‌بار می‌سازید — باید پیش از اولین استقرار وجود داشته باشد، وگرنه دیپلوی با خطای «Disk does not exist» شکست می‌خورد.',
  'Why before the first deploy?': 'چرا پیش از اولین دیپلوی؟',
  'Disk creation and first deploy are order-sensitive: the mount must exist when the platform starts your container. Re-running this command is safe; skip it if the disk already exists.':
    'ترتیب ساخت دیسک و اولین دیپلوی مهم است: mount باید هنگام استارت کانتینر وجود داشته باشد. اجرای دوباره این دستور بی‌خطر است؛ اگر دیسک از قبل هست، ردش کنید.',
  'Set environment variables — including the AI brain': 'تنظیم متغیرهای محیطی — از جمله مغز هوش مصنوعی',
  'Register the database URL and the AI key. ChatGPT is activated with a single variable; without it the built-in z-ai model automatically takes over so the agent keeps working.':
    'آدرس دیتابیس و کلید هوش مصنوعی را ثبت کنید. ChatGPT با یک متغیر فعال می‌شود؛ بدون آن، مدل داخلی z-ai به‌طور خودکار جایگزین می‌شود و ایجنت به کار ادامه می‌دهد.',
  'Warning: the “envs” key in liara.json wipes variables': 'هشدار: کلید «envs» در liara.json متغیرها را پاک می‌کند',
  'Do not manage variables through liara.json “envs” — a deploy with that key replaces ALL existing variables. Always use “liara env set” for secrets like OPENAI_API_KEY.':
    'متغیرها را از طریق «envs» در liara.json مدیریت نکنید — دیپلوی با آن کلید، همه متغیرهای موجود را جایگزین می‌کند. برای مقادیر محرمانه مثل OPENAI_API_KEY همیشه از «liara env set» استفاده کنید.',
  Deploy: 'دیپلوی',
  'Easiest path: the guided graphical script (8 phases: preflight → login → disk → envs → confirm → deploy with live build logs → health polling → success card). Direct CLI also works — liara deploy auto-creates the app on first run.':
    'ساده‌ترین مسیر: اسکریپت گرافیکی راهنما (۸ فاز: پیش‌بازرسی → ورود → دیسک → متغیرها → تأیید → دیپلوی با لاگ زندهٔ بیلد → پایش سلامت → کارت موفقیت). CLI مستقیم هم کار می‌کند — liara deploy در اولین اجرا اپ را خودش می‌سازد.',
  'Two known pitfalls': 'دو مشکل شناخته‌شده',
  'Verify: health check and live logs': 'بررسی نهایی: health check و لاگ زنده',
  'The container pushes the DB schema on first boot (automatic prisma db push), then the built-in health endpoint answers. Watch colorized logs at any time.':
    'کانتینر در اولین بوت، اسکیمای دیتابیس را اعمال می‌کند (db push خودکار Prisma) و سپس endpoint سلامت پاسخ می‌دهد. هر زمان خواستید لاگ‌های رنگی را دنبال کنید.',
  'Where the AI (ChatGPT) makes decisions': 'هوش مصنوعی (ChatGPT) کجا تصمیم می‌گیرد؟',
  'The workflow itself is deterministic: evidence collection, planning and execution follow fixed rules. The LLM only reasons over bounded evidence — and its output always passes the human approval gate before anything runs.':
    'خودِ گردش کار قطعی است: جمع‌آوری شواهد، برنامه‌ریزی و اجرا طبق قواعد ثابت پیش می‌رود. LLM فقط روی شواهد محدود استدلال می‌کند — و خروجی‌اش همیشه پیش از هر اجرایی از دروازهٔ تأیید انسانی رد می‌شود.',
  'Chat & answers': 'چت و پاسخ‌گویی',
  'Answers chat questions grounded in logs, health and repository evidence': 'به سؤال‌های چت بر پایهٔ لاگ، سلامت و شواهد مخزن پاسخ می‌دهد',
  'Incident diagnosis': 'تشخیص حادثه',
  'Root-cause analysis from the collected evidence, written in Persian': 'ریشه‌یابی از روی شواهد جمع‌شده، با نگارش فارسی',
  'Deploy reports': 'گزارش‌های استقرار',
  'Summarizes each run: what happened, risks, next steps': 'هر اجرا را خلاصه می‌کند: چه شد، ریسک‌ها، گام‌های بعدی',
  'optional custom gateway — plus automatic z-ai fallback': 'درگاه دلخواه اختیاری — به‌همراه fallback خودکار z-ai',
  'Post-deploy test checklist': 'چک‌لیست تست پس از دیپلوی',
  'Full Liara platform docs': 'مستندات کامل پلتفرم لیارا',
  'Open the app URL — the Persian RTL workspace loads without a login screen': 'آدرس اپ را باز کنید — فضای کاری فارسی و راست‌به‌چپ بدون صفحهٔ ورود بالا می‌آید',
  'Header shows the ChatGPT (or z-ai) brain badge': 'نشان مغز ChatGPT (یا z-ai) در هدر دیده می‌شود',
  'Settings → connect GitHub or GitLab PAT and see the masked token': 'تنظیمات → توکن PAT گیت‌هاب یا گیت‌لب را متصل کنید و ماسک توکن را ببینید',
  'Connect a repository — analysis runs and the deploy plan is written in Persian': 'از «مخازن من» یکی از مخزن‌هایتان را متصل کنید — تحلیل اجرا می‌شود و برنامهٔ استقرار به فارسی نوشته می‌شود',
  'Ask a question in Chat — the answer cites real evidence': 'در گفت‌وگو سؤال بپرسید — پاسخ به شواهد واقعی ارجاع می‌دهد',
  'Approve the deployment from the Approvals view and watch live progress': 'از نمای تأییدیه‌ها استقرار را تأیید کنید و پیشرفت زنده را ببینید',
  'Health check shows healthy and the Liara app link opens': 'بررسی سلامت «سالم» می‌شود و لینک اپ لیارا باز می‌شود',
  'Switch language to English and back — layout flips LTR/RTL cleanly': 'زبان را به English برگردانید و برگردانید — چیدمان تمیز بین LTR/RTL جابه‌جا می‌شود',

  // ── commercial: per-user connections (no env, no demo) ──────────────────
  'Every browser is its own private workspace — connect YOUR services below. Tokens are validated live against each provider, then stored AES-256-GCM encrypted. Nothing is read from environment variables.': 'هر مرورگر یک فضای کاری خصوصی برای خودش است — سرویس‌های «خودتان» را از همین‌جا وصل کنید. توکن‌ها ابتدا به‌صورت زنده نزد سرویس‌دهنده اعتبارسنجی می‌شوند و سپس با AES-256-GCM رمزنگاری می‌شوند. هیچ توکنی از متغیرهای محیطی خوانده نمی‌شود.',
  'Login with browser (Device Flow)': 'ورود با مرورگر (Device Flow)',
  'A code is shown — enter it at github.com/login/device in your browser and authorize. This window polls automatically until you finish.': 'یک کد نمایش داده می‌شود — آن را در github.com/login/device داخل مرورگر خود وارد کنید و تأیید کنید. همین پنجره تا پایان به‌صورت خودکار بررسی می‌کند.',
  'Open github.com/login/device': 'باز کردن github.com/login/device',
  'Waiting for authorization…': 'در انتظار تأیید شما در مرورگر…',
  'Authorization denied': 'تأیید توسط شما رد شد',
  'Code expired — start again': 'کد منقضی شد — دوباره شروع کنید',
  'Connected via browser as @{login}': 'با مرورگر وصل شد به‌عنوان @{login}',
  'Copy code': 'کپی کد',
  'Copied': 'کپی شد',
  'Browser login requires the OAuth App Client ID to be saved once for this deployment (Settings → OAuth App). Until then, a Personal Access Token works right now.': 'برای ورود مرورگری، Client ID اپ OAuth باید یک‌بار برای این نصب ذخیره شود (تنظیمات ← ثبت OAuth App). تا آن موقع، Personal Access Token همین حالا کار می‌کند.',
  'Set up OAuth App (client IDs)': 'ثبت OAuth App (شناسه‌های کلاینت)',
  'One-time setup for this deployment — enables "login with browser" for every visitor without any env vars:': 'راه‌اندازی یک‌باره برای این نصب — «ورود با مرورگر» را برای همه بازدیدکنندگان فعال می‌کند، بدون هیچ متغیر محیطی:',
  'GitHub OAuth App → github.com/settings/developers → New OAuth App → enable Device Flow → copy the Client ID.': 'GitHub: در github.com/settings/developers یک OAuth App بسازید، Device Flow را فعال کنید و Client ID را کپی کنید.',
  'GitLab: your-instance → User Settings → Applications → new app with read_api scope + Device Authorization Grant → copy the Application ID.': 'GitLab: در تنظیمات کاربری ← Applications یک اپ با دسترسی read_api و گزینه Device Authorization Grant بسازید و Application ID را کپی کنید.',
  'Client IDs are public by design — no secret is needed for GitHub Device Flow.': 'Client IDها عمومی‌اند و افشای آن‌ها مشکلی ندارد — برای Device Flow گیتهاب به secret نیازی نیست.',
  'Save OAuth app config': 'ذخیره تنظیمات OAuth App',
  'OAuth app config saved': 'تنظیمات OAuth App ذخیره شد',
  'Liara API token': 'توکن API لیارا',
  'Paste an API token from console.liara.ir (API Keys menu). The agent uses it for REAL operations on YOUR apps: deploy, restart, scale, logs.': 'یک توکن API از console.liara.ir (منوی کلیدهای API) وارد کنید. ایجنت با آن عملیات «واقعی» روی اپ‌های خودتان را انجام می‌دهد: استقرار، ری‌استارت، مقیاس و لاگ‌ها.',
  'Liara connected as {account}': 'لیارا وصل شد به‌عنوان {account}',
  'Liara disconnected': 'اتصال لیارا قطع شد',
  'Liara connection failed': 'اتصال لیارا ناموفق بود',
  'AI (ChatGPT / OpenAI-compatible)': 'هوش مصنوعی (ChatGPT / سازگار با OpenAI)',
  'Bring your own key: OpenAI, Azure OpenAI, OpenRouter, or any OpenAI-compatible endpoint. Used for chat replies, incident diagnosis and deploy reports.': 'کلید خودتان را وصل کنید: OpenAI، Azure OpenAI، OpenRouter یا هر سرویس سازگار با OpenAI. برای پاسخ گفت‌وگوها، تشخیص حوادث و گزارش‌های استقرار استفاده می‌شود.',
  'API key': 'کلید API',
  'Base URL': 'آدرس پایه',
  'Model': 'مدل',
  'Save & test': 'ذخیره و آزمایش',
  'Save without test': 'ذخیره بدون آزمایش',
  'AI connected ({model})': 'هوش مصنوعی وصل شد ({model})',
  'AI disconnected': 'اتصال هوش مصنوعی قطع شد',
  'AI endpoint test failed': 'آزمایش سرویس هوش مصنوعی ناموفق بود',
  'Open settings & connect': 'باز کردن تنظیمات و اتصال',
  'Welcome to LiaraPilot': 'به LiaraPilot خوش آمدید',
  'Your autonomous DevOps & SRE copilot for Liara. Connect your services once, then chat, deploy and let the agent watch your apps 24/7.': 'دستیار خودکار DevOps و SRE شما برای لیارا. سرویس‌هایتان را یک‌بار وصل کنید، سپس گفت‌وگو کنید، مستقر کنید و بگذارید ایجنت ۲۴/۷ اپ‌هایتان را زیر نظر بگیرد.',
  '1 — Connect GitHub or GitLab': '۱ — گیت‌هاب یا گیت‌لب را وصل کنید',
  'Browser login or a personal token — the agent reads YOUR repos (never writes code without approval).': 'ورود مرورگری یا توکن شخصی — ایجنت مخزن‌های خودتان را می‌خواند (بدون تأیید شما هرگز کد نمی‌نویسد).',
  '2 — Connect Liara': '۲ — لیارا را وصل کنید',
  'Paste an API token from the Liara Console — deploys run for real on your own apps, always behind a human approval gate.': 'توکن API را از کنسول لیارا وارد کنید — استقرارها واقعاً روی اپ‌های خودتان اجرا می‌شوند و همیشه پشت دروازهٔ تأیید انسانی هستند.',
  '3 — Connect your AI (optional)': '۳ — هوش مصنوعی خودتان را وصل کنید (اختیاری)',
  'Your OpenAI-compatible key powers chat, diagnosis and reports. Without it, the agent still watches and reports deterministically.': 'کلید سازگار با OpenAI شما گفت‌وگو، تشخیص و گزارش‌ها را قدرت می‌دهد. بدون آن هم ایجنت به‌صورت قطعی پایش و گزارش می‌کند.',
  'First connection takes ~30 seconds': 'اولین اتصال حدود ۳۰ ثانیه طول می‌کشد',
  'No events yet — connect a repository to see the agent in action.': 'هنوز رویدادی نیست — یک مخزن وصل کنید تا ایجنت را در عمل ببینید.',
  'Connection triggers automatic analysis only — never an automatic deployment. Public repositories work without a token; connect GitHub/GitLab in Settings for private repos.': 'اتصال فقط تحلیل خودکار را آغاز می‌کند — هرگز استقرار خودکار انجام نمی‌شود. مخازن عمومی بدون توکن کار می‌کنند؛ برای مخازن خصوصی، GitHub/GitLab را در «تنظیمات» وصل کنید.',
  'GitHub browser login started': 'ورود مرورگری گیت‌هاب آغاز شد',
  'GitHub connected via browser': 'گیت‌هاب با مرورگر وصل شد',
  'GitLab browser login started': 'ورود مرورگری گیت‌لب آغاز شد',
  'GitLab connected via browser': 'گیت‌لب با مرورگر وصل شد',
  'Liara token connected': 'توکن لیارا وصل شد',
  'AI brain connected': 'مغز هوش مصنوعی وصل شد',
  'AI brain disconnected': 'مغز هوش مصنوعی قطع شد',
  'OAuth app registered': 'اپ OAuth ثبت شد',
  'Built-in z-ai model answering — connect your own AI key in Settings': 'مدل داخلی z-ai در حال پاسخ‌گویی است — کلید هوش مصنوعی خود را در «تنظیمات» وصل کنید',
  'No AI connected — connect your own AI key in Settings': 'هوش مصنوعی متصل نیست — کلید خود را در «تنظیمات ← هوش مصنوعی» وصل کنید',
  'ai off': 'هوش مصنوعی خاموش',
  'real': 'واقعی',
  'LiaraPilot — evidence over assumptions. Consequential operations require approval; every action is audited.': 'LiaraPilot — شواهد به‌جای حدس. عملیات مهم نیازمند تأیید شماست؛ هر اقدامی ثبت می‌شود.',
  'Private per-browser workspace · tokens encrypted (AES-256-GCM) · no env credentials': 'فضای کاری خصوصی هر مرورگر · توکن‌ها رمزنگاری‌شده (AES-256-GCM) · بدون اعتبارنامهٔ env',
  'Connect your AI in Settings': 'هوش مصنوعی خود را در «تنظیمات» وصل کنید',
  'Browser login or a token in Settings': 'ورود مرورگری یا توکن در «تنظیمات»',
  'Connect your Liara API token in Settings': 'توکن API لیارا را در «تنظیمات» وصل کنید',
  'Built-in model — connect your own key in Settings': 'مدل داخلی — کلید خودتان را در «تنظیمات» وصل کنید',
  'Take LiaraPilot live on the Liara platform — in seven guided steps': 'LiaraPilot را روی پلتفرم لیارا اجرا کنید — در هفت گام راهنمادار',
  'The project ships with liara.json, a multi-stage Dockerfile and an idempotent entrypoint (automatic prisma db push). Deployment needs ZERO environment variables — every service is connected inside the app afterwards, per browser workspace.': 'این پروژه با liara.json، داکرفایل چندمرحله‌ای و entrypoint با تکرارپذیری (prisma db push خودکار) عرضه می‌شود. دیپلوی به «هیچ» متغیر محیطی نیاز ندارد — همهٔ سرویس‌ها بعداً داخل خود اپ و برای هر فضای کاری جدا وصل می‌شوند.',
  'Create an API key in the Liara Console (Panel → API → build new key), then log in locally. This is only for running the deploy from YOUR machine — the deployed agent never needs this token.': 'در کنسول لیارا یک کلید API بسازید (پنل ← API ← ساخت کلید جدید) و در سیستم خودتان وارد شوید. این فقط برای اجرای دیپلوی از کامپیوتر خودتان است — ایجنتِ مستقروشده به این توکن نیازی ندارد.',
  'Deploy — no env vars needed': 'دیپلوی — بدون هیچ متغیر محیطی',
  'Easiest path: the guided graphical script (8 phases: preflight → login → disk → confirm → deploy with live build logs → health polling → success card). Direct CLI also works — liara deploy auto-creates the app on first run.': 'ساده‌ترین مسیر: اسکریپت گرافیکی راهنما (۸ فاز: پیش‌بازرسی → ورود → دیسک → تأیید → دیپلوی با لاگ زندهٔ بیلد → پایش سلامت → کارت موفقیت). CLI مستقیم هم کار می‌کند — liara deploy در اولین اجرا خودش اپ را می‌سازد.',
  'Zero-environment deployment': 'دیپلوی بدون متغیر محیطی',
  'Nothing to configure here: DATABASE_URL is injected by the entrypoint, encryption keys are auto-generated on the data disk, and ALL service tokens (GitHub/GitLab/Liara/AI) are entered by each user inside the app.': 'اینجا چیزی برای پیکربندی نیست: DATABASE_URL را entrypoint تزریق می‌کند، کلیدهای رمزنگاری روی دیسک داده به‌صورت خودکار ساخته می‌شوند و «همهٔ» توکن‌های سرویس‌ها (GitHub/GitLab/Liara/AI) را هر کاربر داخل خود اپ وارد می‌کند.',
  'Do not manage variables through liara.json “envs” — a deploy with that key replaces ALL existing variables. LiaraPilot does not need any; if you add your own later, always use “liara env set”.': 'متغیرها را از طریق «envs» در liara.json مدیریت نکنید — دیپلوی با آن کلید، همه متغیرهای موجود را جایگزین می‌کند. LiaraPilot به هیچ‌کدام نیاز ندارد؛ اگر بعداً متغیر خودتان را اضافه کردید، همیشه از «liara env set» استفاده کنید.',
  'Connect your services inside the app (Settings)': 'سرویس‌هایتان را داخل خود اپ وصل کنید (تنظیمات)',
  'Open the deployed app, go to Settings and connect the services — each visitor connects their own:': 'اپ مستقرشده را باز کنید، به «تنظیمات» بروید و سرویس‌ها را وصل کنید — هر بازدیدکننده سرویس‌های خودش را:',
  'GitHub — “Login with browser” shows a one-time code at github.com/login/device; or paste a PAT with the repo scope.': 'GitHub — «ورود با مرورگر» یک کد یک‌بارمصرف در github.com/login/device نشان می‌دهد؛ یا توکن شخصی با دسترسی repo وارد کنید.',
  'GitLab — the same browser flow on your instance; or a PAT with read_api scope.': 'GitLab — همان جریان مرورگری روی نصب خودتان؛ یا توکن شخصی با دسترسی read_api.',
  'Liara — paste an API token from console.liara.ir/panel/api-keys; it is validated live against api.liara.ir (GET /v1/me) and stored encrypted. This enables REAL deploys on your apps.': 'Liara — یک توکن API از console.liara.ir/panel/api-keys وارد کنید؛ به‌صورت زنده مقابل api.liara.ir اعتبارسنجی و رمزنگاری‌شده ذخیره می‌شود. همین، استقرار «واقعی» روی اپ‌های شما را فعال می‌کند.',
  'AI — any OpenAI-compatible key (OpenAI, Azure, OpenRouter…). Powers chat, incident diagnosis and deploy reports.': 'هوش مصنوعی — هر کلید سازگار با OpenAI (OpenAI، Azure، OpenRouter…). گفت‌وگو، تشخیص حادثه و گزارش‌های استقرار را تأمین می‌کند.',
  'Privacy model': 'مدل حریم خصوصی',
  'Every browser is its own private workspace; tokens are validated against each provider and stored AES-256-GCM encrypted with a key auto-generated on your data disk. Nothing is shared between visitors and nothing lives in env vars.': 'هر مرورگر یک فضای کاری خصوصی است؛ توکن‌ها نزد هر سرویس‌دهنده اعتبارسنجی و با کلیدی که خودکار روی دیسک داده ساخته می‌شود، با AES-256-GCM رمزنگاری می‌شوند. بین بازدیدکنندگان چیزی مشترک نیست و هیچ‌چیز در env نمی‌ماند.',
  'Optional: register the OAuth App (enables browser login for everyone)': 'اختیاری: ثبت OAuth App (ورود مرورگری را برای همه فعال می‌کند)',
  '“Login with browser” uses the OAuth Device Flow and needs a Client ID registered once by the deployment owner:': '«ورود با مرورگر» از OAuth Device Flow استفاده می‌کند و به Client ID نیاز دارد که یک‌بار توسط مالک نصب ثبت شود:',
  'GitHub: github.com/settings/developers → New OAuth App (any homepage URL) → create → enable Device Flow → copy the Client ID.': 'GitHub: در github.com/settings/developers ← New OAuth App (هر آدرس صفحهٔ اصلی) ← ساخت ← فعال‌کردن Device Flow ← کپی Client ID.',
  'GitLab: User Settings → Applications → new app with read_api scope + Device Authorization Grant → copy the Application ID (secret only for confidential apps).': 'GitLab: تنظیمات کاربری ← Applications ← اپ جدید با دسترسی read_api و گزینهٔ Device Authorization Grant ← کپی Application ID (secret فقط برای اپ‌های محرمانه).',
  'Paste them in Settings → “Set up OAuth App (client IDs)” and save — done, no restart, no env vars.': 'آن‌ها را در «تنظیمات ← ثبت OAuth App» وارد و ذخیره کنید — تمام؛ بدون ری‌استارت و بدون متغیر محیطی.',
  'Why Client ID and not a secret?': 'چرا فقط Client ID و بدون secret؟',
  'The Device Flow is designed for public clients: only the Client ID is required for GitHub; user authorization happens on github.com and the token is delivered back to the app directly.': 'Device Flow برای کلاینت‌های عمومی طراحی شده: برای گیتهاب فقط Client ID لازم است؛ تأیید کاربر روی github.com انجام می‌شود و توکن مستقیماً به اپ تحویل داده می‌شود.',
  'Where the AI makes decisions': 'هوش مصنوعی کجا تصمیم می‌گیرد',
  'bring your own key': 'کلید خودتان را بیاورید',
  '— defaults are pre-filled; every OpenAI-compatible endpoint works (Azure, OpenRouter, local vLLM…)': '— مقادیر پیش‌فرض از قبل پر شده‌اند؛ هر سرویس سازگار با OpenAI کار می‌کند (Azure، OpenRouter، vLLM محلی…)',
  'Settings → connect GitHub via browser (or PAT) — the masked account appears': 'تنظیمات ← گیت‌هاب را با مرورگر (یا PAT) وصل کنید — حساب با ماسک نمایش داده می‌شود',
  'Settings → paste your Liara API token — it is validated live against api.liara.ir': 'تنظیمات ← توکن API لیارا را وارد کنید — به‌صورت زنده مقابل api.liara.ir اعتبارسنجی می‌شود',
  'Health URL (public)': 'آدرس سلامت (عمومی)',
  'The URL the agent probes every cycle for availability & incidents.': 'آدرسی که ایجنت در هر چرخه برای در دسترس‌بودن و حوادث بررسی می‌کند.',
  'Health URL saved — the agent now probes it on schedule': 'آدرس سلامت ذخیره شد — ایجنت از این پس طبق برنامه آن را بررسی می‌کند',
  'Monitoring': 'پایش',

  // ── commercial: per-user connections (no env, no demo) ──────────────────
  'Get token from Liara Console': 'گرفتن توکن از کنسول لیارا',
  'The token is validated live against api.liara.ir before it is stored.': 'توکن پیش از ذخیره، به‌صورت زنده مقابل api.liara.ir اعتبارسنجی می‌شود.',

  // ── drag & drop: dashboard layout + chat file attach ────────────────────
  'Drag to rearrange': 'برای جابه‌جایی بکشید',
  'Move up': 'انتقال به بالا',
  'Move down': 'انتقال به پایین',
  'Reset layout': 'بازنشانی چیدمان',
  'Drag the handle on any card to rearrange — the order is saved for this browser.':
    'دستگیرهٔ هر کارت را بکشید تا داشبورد مرتب شود — این چیدمان برای همین مرورگر ذخیره می‌شود.',
  'Drop the file to attach its contents to your message': 'فایل را رها کنید تا محتوایش به پیام شما اضافه شود',
  'You can also drop a log or text file here — its contents are attached to your message.':
    'همچنین می‌توانید یک فایل لاگ یا متنی اینجا رها کنید — محتوای آن به پیام شما پیوست می‌شود.',
  'File contents attached: {name}': 'محتوای فایل پیوست شد: {name}',
  'Could not read the file as text': 'خواندن فایل به‌صورت متن ممکن نشد',
};

let activeLocale: Locale = 'fa';

export function formatNumber(n: number, locale: Locale = activeLocale): string {
  try {
    return n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  } catch {
    return String(n);
  }
}

/** Relative time ("۳ دقیقه پیش") — locale-aware, re-renders with the provider. */
export function timeAgo(iso: string | null | undefined, locale: Locale = activeLocale): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  const n = (v: number) => formatNumber(v, locale);
  if (s < 5) return translate('just now', undefined, locale);
  if (s < 60) return translate('{n}s ago', { n: s }, locale);
  const m = Math.floor(s / 60);
  if (m < 60) return translate('{n}m ago', { n: m }, locale);
  const h = Math.floor(m / 60);
  if (h < 24) return translate('{n}h ago', { n: h }, locale);
  return translate('{n}d ago', { n: Math.floor(h / 24) }, locale);
}

/** Clock time — Jalali-aware in fa (fa-IR locale renders Persian digits). */
export function fmtClock(iso: string | Date, locale: Locale = activeLocale): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  try {
    return d.toLocaleTimeString(locale === 'fa' ? 'fa-IR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.toISOString();
  }
}

/** Full date — Jalali calendar in fa mode. */
export function fmtDate(iso: string | Date, locale: Locale = activeLocale): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  try {
    return d.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

export function translate(
  key: string,
  vars?: Record<string, string | number>,
  locale: Locale = activeLocale,
): string {
  let s = locale === 'fa' ? (FA[key] ?? key) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(typeof v === 'number' ? formatNumber(v, locale) : v);
    }
  }
  return s;
}

interface I18nValue {
  locale: Locale;
  dir: Dir;
  isRtl: boolean;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = 'lp_locale';

// Locale lives in localStorage — an external store, so we subscribe the React
// way (useSyncExternalStore): server snapshot is 'fa', the client snapshot
// re-renders after hydration with the saved choice (no hydration mismatch).
let localeListeners: Array<() => void> = [];

function subscribeLocale(cb: () => void): () => void {
  localeListeners.push(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    localeListeners = localeListeners.filter((l) => l !== cb);
    window.removeEventListener('storage', onStorage);
  };
}

function readLocaleSnapshot(): Locale {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'fa';
  } catch {
    return 'fa'; // private mode
  }
}

function writeLocale(l: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* private mode */
  }
  for (const cb of [...localeListeners]) cb();
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, readLocaleSnapshot, () => 'fa' as Locale);

  useEffect(() => {
    activeLocale = locale;
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === 'fa' ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    activeLocale = l; // immediate for timeAgo/formatters
    writeLocale(l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, vars, locale),
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, dir: locale === 'fa' ? 'rtl' : 'ltr', isRtl: locale === 'fa', setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  // Fallback keeps callers safe outside the provider (SSR, tests).
  return v ?? { locale: 'fa', dir: 'rtl', isRtl: true, setLocale: () => undefined, t: translate };
}
