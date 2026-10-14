# AYPROM Search Console MCP

Локальный MCP-сервер для единственного ресурса Google Search Console:

`sc-domain:ayprom-gidravlika.kg`

Он читает Search Analytics, статус ресурса, sitemap и URL Inspection. Отправка и удаление sitemap требуют подтверждения Codex, точной контрольной фразы и локального audit log.

## Ограничения Google

- URL Inspection показывает версию страницы, известную индексу Google. Это не live test.
- Search Console API не предоставляет запрос переобхода обычной страницы.
- Indexing API намеренно не подключён: Google разрешает его только для `JobPosting` и livestream `BroadcastEvent`.

## Где лежат секреты

По умолчанию:

`%LOCALAPPDATA%\AYPROM\search-console-mcp`

Файлы:

- `oauth-client.json` — OAuth Desktop client из Google Cloud;
- `tokens.json` — выданные Google токены;
- `audit.jsonl` — журнал попыток изменения sitemap.

Каталог можно переопределить переменной `AYPROM_GSC_CONFIG_DIR`. Эти файлы не должны попадать в Git.

## Первичная авторизация

1. В Google Cloud выберите или создайте проект, принадлежащий владельцу AYPROM.
2. Включите **Google Search Console API**.
3. Настройте OAuth consent screen. Если приложение находится в Testing, добавьте нужный Google-аккаунт в Test users.
4. Создайте OAuth client типа **Desktop app**.
5. Скачайте JSON и сохраните его как:

   `%LOCALAPPDATA%\AYPROM\search-console-mcp\oauth-client.json`

6. В `tools/search-console-mcp` или установленной папке плагина выполните:

   `npm run auth`

7. В браузере выберите Google-аккаунт, у которого есть доступ к `sc-domain:ayprom-gidravlika.kg`, и подтвердите scope Search Console.

8. После возврата в терминал перезапустите задачу Codex и вызовите `gsc_auth_status`, затем `gsc_property_status`.

## Контроль записей

Для отправки sitemap:

`SUBMIT https://www.ayprom-gidravlika.kg/sitemap.xml`

Для удаления sitemap:

`DELETE https://www.ayprom-gidravlika.kg/sitemap.xml`

Регистр, пробел и нормализованный URL должны совпасть точно. Сервер записывает попытку до обращения к Google. Если журнал недоступен, действие блокируется.

## Локальная проверка

```powershell
npm test
npm start
```

Сервер использует JSON-RPC MCP через stdin/stdout и не обращается к Google до вызова инструмента, которому нужны данные API.
