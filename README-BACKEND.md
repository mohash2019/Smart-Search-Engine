# Smart Search Engine - Backend

هذا الجزء يضيف:

`GET /api/search`

## ما الذي يفعله؟

1. يستقبل عبارة البحث.
2. يرسلها إلى مزود Web Search.
3. يضيف YouTube إذا تم توفير `YOUTUBE_API_KEY`.
4. يوحد شكل النتائج.
5. يزيل التكرار داخل الـBackend.
6. يطبق فلاتر المدة والتاريخ.
7. يعيد JSON إلى `index.html`.

## متغيرات البيئة

ضعها في Vercel Environment Variables:

- `SEARCH_PROVIDER=brave` أو `bing`
- `SEARCH_API_KEY=...`
- `YOUTUBE_API_KEY=...` (اختياري)
- `MAX_RESULTS=50`

لا تضع مفاتيح API داخل `index.html`.

## اختبار

بعد النشر:

`/api/search?q=test`

مثال:

`/api/search?q=football`

مع الفلاتر:

`/api/search?q=football&minDuration=5&maxDuration=60&fromDate=2025-01-01&toDate=2026-12-31`

## ملاحظة مهمة

هذا ليس "زحفًا حرفيًا لكل مواقع الإنترنت". هو طبقة تجميع تعتمد على مزودات البحث والمصادر التي تسمح بالوصول البرمجي. يمكن إضافة مزودات أخرى لاحقًا لتحسين التغطية.
