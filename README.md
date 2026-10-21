# המסע לסוכנות AI – דשבורד

דשבורד יומי בעברית: טקס בוקר, עץ מערכות/משימות/תת-משימות, היסטוריה, פידבק מקלוד ומאמן מנטלי.

הדשבורד נבנה במקור כ-Artifact ב-claude.ai. כאן הוא רץ כאפליקציית Node עצמאית:

- `public/index.html` – הדשבורד עצמו (ללא שינוי בלוגיקה).
- `public/claude-shim.js` – מחליף את `claude.use('db')` ו-`claude.use('sample')` בקריאות לשרת.
- `server.js` – שרת Express: מסד נתונים בקובץ JSON, עדכונים חיים (SSE), ופרוקסי ל-API של Anthropic.

## הרצה מקומית

```bash
npm install
cp .env.example .env   # ולמלא ANTHROPIC_API_KEY
export $(grep -v '^#' .env | xargs)
npm start
```

פותחים את http://localhost:3000.

## פריסה ב-Railway

1. ב-Railway: **New Project → Deploy from GitHub repo** ובוחרים את הריפו הזה. Railway מזהה לבד את `package.json` ואת `railway.json`.
2. ב-**Variables** של השירות מוסיפים:
   - `ANTHROPIC_API_KEY` – חובה כדי שהפידבק והמאמן יעבדו.
   - `DASHBOARD_PASSWORD` – מומלץ מאוד. בלי זה הדשבורד פתוח לכל מי שיש לו את הקישור.
   - `DATA_DIR=/data`
3. ב-**Settings → Volumes** מוסיפים Volume עם mount path `/data`. בלי Volume המשימות יימחקו בכל deploy.
4. ב-**Settings → Networking** לוחצים **Generate Domain** כדי לקבל כתובת ציבורית.

## משתני סביבה

| משתנה | ברירת מחדל | תיאור |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | מפתח API של Anthropic. בלי זה כפתורי קלוד מוסתרים. |
| `DASHBOARD_PASSWORD` | ריק (ללא הגנה) | סיסמה ל-Basic Auth. שם המשתמש לא משנה. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | המודל לפידבק ולמאמן. |
| `DATA_DIR` | `./data` | תיקיית קובץ הנתונים `db.json`. |
| `PORT` | `3000` | Railway מגדיר לבד. |

## ייבוא נתונים מהדשבורד הישן

הנתונים ב-claude.ai נשמרים במסד הנתונים של ה-Artifact ולא עוברים אוטומטית. אפשר לייצא אותם משם ולהעלות ל-`/data/db.json` במבנה:

```json
{ "systems": { "<id>": {...} }, "tasks": { "<id>": {...} }, "days": { "<YYYY-MM-DD>": {...} }, "coach": { "log": {...} } }
```
