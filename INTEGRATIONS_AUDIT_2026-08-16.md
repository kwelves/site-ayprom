# Инвентаризация доступов и интеграций

Дата аудита: 16 августа 2026, Asia/Almaty. Проверка выполнена в контексте
Codex Desktop и рабочего каталога `C:\Erkin\site-for-kirsan`. Значения
токенов, ключей, паролей, cookie и ID, не нужные для управления, намеренно не
включены.

## Как читать статусы

- **Авторизовано и проверено** — сервис ответил на безопасный read-only запрос.
- **Настроено локально** — есть конфигурация или ключи, но этот сеанс не даёт
  инструмента/подтверждения OAuth-доступа.
- **Установлено/активно в Codex** — плагин включён и его инструменты доступны;
  это само по себе не подтверждает доступ к конкретному бизнес-аккаунту.
- **Кэшировано** — файлы плагина есть на диске; это не равнозначно подключённому
  аккаунту.

Codex не хранит нормализированную статистику «сколько раз использовался каждый
навык/плагин» за всё время. В истории есть 33 локальных сеанса за 10–16 августа,
но поиск по ней смешивает реальные вызовы с описаниями инструментов. Поэтому
точный all-time счётчик был бы недостоверен; ниже приведены только точно
наблюдаемые вызовы в этом аудите.

## Подтверждённые внешние подключения

| Сервис | Статус и владелец/контекст | Реальные права и роль | Использование в аудите |
|---|---|---|---|
| GitHub App | Авторизована как `Emldzn`; репозиторий — `kwelves/site-ayprom` | Для этого публичного репозитория App имеет только `pull`; нет `push`, admin, maintain или triage. Может читать репозиторий через App-инструменты, но не публиковать изменения в нём. | `get_user_login` 1; `get_repo` 1 успешный (+1 отклонённый из-за неверного формата входа). |
| Figma | Авторизована как `Erkin`; команда «Эркин's team», Starter, место `View` | Доступ на просмотр; в распоряжении Codex есть 33 операции Figma (чтение дизайна, экспорт, генерация и т. п.), но создание/изменение будет зависеть от прав конкретного файла и плана. | `whoami` 1 успешный; перед ним 1 OAuth-подтверждение. |
| OpenAI Sites | Плагин установлен и доступен | Есть 22 операции: создать/сохранить/развернуть сайт, домены, access, логи, переменные среды и встроенная БД. В текущем аккаунте список сайтов пуст. | `list_sites` 1. |
| n8n | Инструменты приложения опубликованы, но авторизация/сервер не подтверждены | API включает поиск проектов/воркфлоу, исполнение и публикацию; проверка списка проектов вернула internal error. Нельзя считать доступ рабочим. | `search_projects` 1, ошибка. |

### GitHub: важное расхождение

Локальный Git настроен на `https://github.com/kwelves/site-ayprom.git`; локальная
Git-идентичность — `kwelves`. Но GitHub CLI (`gh`) считает токен аккаунта
`kwelves` недействительным. То есть есть три разных уровня: локальная история и
remote работают как метаданные Git; GitHub App подтверждённо читает репозиторий;
GitHub CLI сейчас не авторизован. Права App на этот репозиторий — read-only.

## Настроенные бизнес-сервисы, не подтверждённые этим сеансом

| Сервис | Наблюдаемая конфигурация | Что это означает сейчас |
|---|---|---|
| Supabase | `.mcp.json` содержит HTTP MCP, привязанный к проекту; `.env.local` содержит публичные и серверные Supabase-переменные; проект использует `@supabase/supabase-js` 2.110.7 и versioned migrations. | Проект действительно связан с Supabase и имеет локальные учётные данные для приложения. MCP-инструменты Supabase в этот сеанс не опубликованы, поэтому я не могу подтвердить OAuth-доступ, прочитать БД или выполнять SQL через MCP. Supabase CLI установлен, но его проверка версии в песочнице не прошла из-за запрета записи telemetry вне workspace — это не проверка логина. |
| Vercel | `.vercel/project.json` связывает рабочую папку с Vercel project/team; используется `@vercel/speed-insights` 2.0.0. | Привязка проекта существует. CLI `vercel` не установлен, Vercel App/MCP в этом сеансе нет; доступ к deployment, доменам и переменным не подтверждён. |
| Sentry | В `.env.local` присутствуют DSN, org/project и auth-token переменные; зависимость `@sentry/nextjs` 10.69.0. | Код подготовлен к мониторингу и есть локальная конфигурация. Доступ в Sentry и действительность токена не проверялись: плагина/инструмента Sentry нет. |
| remove.bg / rembg | Есть `REMBG_API_KEY`; в проекте есть `scripts/remove-background-rembg.mjs`. | Локально настроена обработка фона изображений; внешнее API не вызывалось и его доступность не подтверждалась. |

Перечисленные секреты не передавались во внешние сервисы и не раскрываются в
этом отчёте.

## Установленные и активные плагины Codex

Все App-плагины наследуют глобальную политику Codex **«разрешать low-risk
действия»**: безопасные действия одобряются автоматически, потенциально
чувствительные могут блокироваться. У GitHub, Figma и Sites нет отдельного
переопределения.

| Плагин/поставщик | Версия/кэш обновлён | Состояние | Назначение |
|---|---:|---|---|
| Figma (OpenAI curated remote) | 2.0.17; 11.08.2026 | установлен, авторизован | Дизайн, FigJam/Slides, чтение контекста, экспорт, Code Connect, генерация дизайна. |
| GitHub (OpenAI curated remote) | 0.1.8-2841cf9749ae; 13.08.2026 | установлен, авторизован частично | Репозитории, PR, issues, Actions; фактический доступ к `kwelves/site-ayprom` только на чтение. |
| Sites (OpenAI bundled) | 0.1.37; 15.08.2026 | установлен, без сайтов | Хостинг и публикация сайтов. |
| Browser (OpenAI bundled) | 26.810.50856; 15.08.2026 | включён | Управление in-app browser; не является авторизацией в пользовательских сайтах. |
| Visualize (OpenAI bundled) | 1.0.21; 15.08.2026 | включён | Интерактивные визуализации в диалоге. |
| Documents / PDF / Spreadsheets / Presentations / Template Creator (OpenAI runtime) | 26.813.12317; 14.08.2026 | включены в конфиге | Работа с файлами Office/PDF и шаблонами. Подключённого Excel/Google Sheets/PowerPoint-документа в этом аудите не найдено. |
| Plugin Management | 0.1.0; 14.08.2026 | доступен | Инвентаризация плагинов, зависимостей и их политик доступа. |
| Data Analytics (OpenAI curated remote) | 0.2.8-13ceeea1f599; 13.08.2026 | файлы/виджеты доступны, не установлен как App | Аналитика, KPI, отчёты и дашборды; нет подключённого источника данных. |
| Google Calendar / Slack (OpenAI curated) | кэш 11c74d6b; 13.08.2026 | включены в локальном конфиге, но App-проверка вернула `not_installed` | В этой сессии нет инструментов Calendar/Slack и нет подтверждения OAuth. Это следы локальной установки/кэша, не активное подключение. |
| OpenAI Templates | 0.1.1; 13.08.2026 | кэшировано | Набор шаблонов аналитических и бизнес-артефактов; не отдельный авторизованный сервис. |

Дата в таблице — время создания/обновления локального кэша, а не доказанная
дата установки, подключения OAuth или первого использования.

## MCP-серверы и специальные интерфейсы

| Компонент | Статус | Роль |
|---|---|---|
| `node_repl` MCP | активен, локальный | Долгоживущий JavaScript runtime; может работать с browser-интеграциями. Не даёт сам по себе доступ к чужим аккаунтам. |
| Supabase MCP | настроен в `.mcp.json`, не опубликован этому агенту | Потенциальный OAuth-доступ к конкретному Supabase-проекту; сейчас не проверен. |
| Codex App MCP | активен | Публикует Figma, GitHub, Sites, n8n и управление подключёнными документами. |
| Data Analytics Widgets MCP | активен | Рендер/валидация аналитических таблиц, графиков, отчётов и дашбордов. |
| Chrome DevTools MCP | **не настроен** | Есть навык-инструкция, но самого сервера/инструментов в сеансе нет. |

## Локальные инструменты разработки

- **VS Code** установлен: `code` 1.132.1. Это редактор, не облачная
  авторизация; старые сеансы были запущены из VS Code.
- **Git** установлен; активная ветка `main`, рабочее дерево на момент аудита
  чистое.
- **GitHub CLI** установлен, но токен недействителен.
- **Supabase CLI** установлен; использовать можно после устранения sandbox
  ограничения на telemetry и отдельной проверки логина.
- **Node/npm**, **Graphify** установлены. `graphify update .` выполнен один раз
  в этом аудите; граф кода обновлён без топологических изменений.
- **Vercel CLI** и **n8n CLI** не установлены.

## Проекты и владение

1. Локальный проект: `site-for-kirsan`, version `0.1.0`, private npm package.
2. Git remote: `kwelves/site-ayprom`, public, default branch `main`. Владелец
   GitHub-репозитория — пользователь `kwelves`; его же имя/e-mail стоят в
   локальной Git-идентичности. Это не доказывает, что подключённая GitHub App
   имеет права записи: она их не имеет.
3. Supabase — один привязанный проект (идентификатор не публикуется здесь),
   источник истины для каталога и миграций по `PROJECT_BRIEF.md`.
4. Vercel — одна локальная project/team linkage (внутренние ID скрыты), но без
   подтверждённого доступа к панели.
5. Figma — одна доступная команда: «Эркин's team», Starter, `View` seat.
6. Sites — связанных опубликованных сайтов пока 0.

## Полный каталог навыков

### Системные (6)

`imagegen`, `openai-docs`, `plugin-creator`, `review-agent`, `skill-creator`,
`skill-installer` — создание изображений, документация OpenAI/Codex, создание,
ревью и установка навыков/плагинов.

### Навыки проекта `.agents/skills` (67)

`animate`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `babysit`,
`brandkit`, `browser-testing-with-devtools`, `ci-security-scanning-with-strix`,
`cloud-sync`, `design-is`, `design-taste-frontend`,
`design-taste-frontend-v1`, `do`, `emil-design-eng`,
`extract-design-system`, `find-animation-opportunities`,
`fix-security-vulnerabilities-with-strix`, `framer-motion-animator`,
`frontend-design`, `full-output-enforcement`, `gpt-taste`, `graphify`,
`grill-me`, `grilling`, `high-end-visual-design`, `how-it-works`,
`image-to-code`, `imagegen-frontend-mobile`, `imagegen-frontend-web`,
`improve-animations`, `industrial-brutalist-ui`, `knowledge-agent`,
`learn-codebase`, `llm-council`, `make-plan`,
`managed-pentesting-with-strix`, `mem-search`, `microinteractions`,
`minimalist-ui`, `motion-design`, `oh-my-issues`, `pathfinder`,
`penetration-testing-with-strix`, `pick-ui-library`, `prototype`,
`redesign-existing-projects`, `remotion-best-practices`, `responsive-design`,
`review-animations`, `smart-explore`, `standup`, `stitch-code-to-design`,
`stitch-design-taste`, `stitch-extract-design-md`,
`stitch-extract-static-html`, `stitch-generate-design`,
`stitch-manage-design-system`, `stitch-upload-to-stitch`, `supabase`,
`supabase-postgres-best-practices`, `tailwind-design-system`,
`timeline-report`, `ui-ux-pro-max`, `version-bump`, `weekly-digests`,
`what-the`, `wowerpoint`.

Это инструктивные пакеты, а не авторизации. Они помогают с UX/UI, анимацией,
кодовой базой, планированием, безопасностью, Remotion, Stitch/Figma-потоком,
Supabase, GitHub-процессами и отчётами. Наличие навыка `supabase`, `Strix`,
`stitch`, `remotion` или `browser-testing-with-devtools` не означает, что
соответствующий сервис подключён.

### Навыки из кэшированных плагинов

- **Figma:** `figma-code-connect`, `figma-create-new-file`,
  `figma-design-to-code`, `figma-generate-design`, `figma-generate-diagram`,
  `figma-generate-library`, `figma-implement-motion`, `figma-swiftui`,
  `figma-use`, `figma-use-figjam`, `figma-use-motion`, `figma-use-slides`.
- **GitHub:** `github`, `gh-address-comments`, `gh-fix-ci`, `yeet`.
- **Data Analytics:** `analyze-data-quality`, `build-dashboard`,
  `build-report`, `create-data-context`, `design-kpis`,
  `gather-business-context`, `index`, `jupyter-notebooks`, `kpi-reporting`,
  `market-sizing`, `metric-diagnostics`, `product-business-analysis`,
  `publish-artifact-to-sites`, `validate-data`, `visualize-data`.
- **Документы:** `documents`, `pdf`, `presentations`, `spreadsheets`,
  `excel-live-control`, `template-creator`.
- **Sites/Browser/Visualize:** `sites-building`, `sites-hosting`,
  `control-in-app-browser`, `visualize`.
- **Calendar/Slack (кэш, не активная App-установка):** `google-calendar`,
  `google-calendar-daily-brief`, `google-calendar-free-up-time`,
  `google-calendar-group-scheduler`, `google-calendar-meeting-prep`, `slack`,
  `slack-channel-summarization`, `slack-daily-digest`,
  `slack-notification-triage`, `slack-outgoing-message`,
  `slack-reply-drafting`.
- **Служебные:** `plugin-management` и 20 кэшированных `artifact-template-*`
  шаблонов OpenAI.

## Что использовалось точно в этом аудите

- `graphify update .` — 1 раз (локальное обновление карты кода).
- Plugin Management — 27 безопасных запросов политик доступа: GitHub, Figma и
  Sites найдены; Calendar/Slack и остальные проверенные runtime-плагины не
  считаются установленными как App.
- GitHub App — 2 успешных read-only проверки и 1 отклонённый запрос с неверным
  форматом.
- Figma — 1 OAuth-подтверждение и 1 успешная проверка профиля.
- Sites — 1 read-only список сайтов.
- n8n — 1 неуспешная read-only проверка.
- Исследование локальной конфигурации и Git — только чтение. Внешние записи,
  деплои, изменения БД, публикация в GitHub/Figma/Sites и изменение прав не
  выполнялись.

## Доступные к установке, но не установленные по предоставленному каталогу

`Airtable`, `Apollo.io`, `Asana`, `Atlassian Rovo`, `Base44`, `Box`, `Canva`,
`Cloudflare`, `Codex Security`, `Gmail`, `Google Calendar`, `Google Drive`,
`Granola`, `HeyGen`, `HyperFrames by HeyGen`, `HubSpot`, `Linear`, `Lovable`,
`Monday.com`, `Neon Postgres`, `Notion`, `OpenAI Developers`, `Outlook Calendar`,
`Outlook Email`, `PostHog`, `Remotion`, `Replit`, `Semrush`, `Sentry`,
`SharePoint`, `Slack`, `Stripe`, `Supabase`, `Superpowers`, `Teams`, `Vercel`,
`Wix`, `Zotero`.

Это именно каталог предложений, не список авторизованных сервисов. В частности,
наличие там Vercel/Supabase/Sentry не противоречит локальным конфигурациям выше:
для Codex App они пока не подключены.
