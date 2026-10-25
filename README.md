# המסע לסוכנות AI – דשבורד

דשבורד יומי בעברית: טקס בוקר, עץ מערכות / משימות / תת-משימות, היסטוריה, פידבק מקלוד ומאמן מנטלי.

## סטאק

| שכבה | טכנולוגיה |
|---|---|
| Frontend | React 18 + Vite + TypeScript (`frontend/`) |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Anthropic SDK (`backend/`) |
| DB | PostgreSQL (SQLite לפיתוח מקומי ולבדיקות) |
| אירוח | Railway, אימג׳ Docker אחד שמגיש גם את ה-API וגם את ה-React הבנוי |

## הרצה מקומית

```bash
# backend
cd backend
uv venv .venv && uv pip install -r requirements-dev.txt     # או: python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export ANTHROPIC_API_KEY=sk-ant-...                           # אופציונלי; בלי זה כפתורי קלוד מוסתרים
# בלי DATABASE_URL נוצר קובץ SQLite ב-backend/data/dev.db
.venv/bin/uvicorn app.main:app --reload --port 8000

# frontend (טרמינל שני)
cd frontend
npm install
npm run dev          # http://localhost:5173, קריאות /api מועברות ל-8000
```

בדיקות: `cd backend && .venv/bin/python -m pytest -q`.

## פריסה ב-Railway

1. **New Project → Deploy from GitHub repo** ובוחרים את הריפו הזה. Railway מזהה את ה-`Dockerfile` דרך `railway.json`.
2. באותו פרויקט: **+ New → Database → PostgreSQL**.
3. בשירות של האפליקציה, **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Reference למסד שיצרת).
   - `ANTHROPIC_API_KEY` – חובה כדי שהפידבק והמאמן יעבדו.
   - `DASHBOARD_PASSWORD` – מומלץ מאוד. בלי זה הדשבורד פתוח לכל מי שיש לו את הקישור.
4. **Settings → Networking → Generate Domain**.

אין צורך ב-Volume: כל הנתונים ב-Postgres.

## API

תיעוד אינטראקטיבי ב-`/api/docs`. עיקרי הנקודות:

| Method | Path | תיאור |
|---|---|---|
| GET | `/api/state` | כל המצב: מערכות, משימות, ימים, שיחת המאמן, סטטוס AI |
| PUT / DELETE | `/api/systems/{id}` | יצירה/עדכון/מחיקה של מערכת (מחיקה מחזירה את המשימות לשחזור) |
| PUT / DELETE | `/api/tasks/{id}` | יצירה/עדכון/מחיקה של משימה כולל תת-משימות |
| POST | `/api/tasks/bulk` | יצירה או שחזור של כמה משימות |
| PUT | `/api/tasks/{id}/progress` | עדכון אחוז התקדמות ורישום אירוע ביום |
| PATCH | `/api/days/{YYYY-MM-DD}` | שמירת טקסטים, תוכנית היום וסימון "נשמר" |
| POST | `/api/feedback` | פידבק בוקר מקלוד (streaming) |
| POST / DELETE | `/api/coach/messages` | הודעה למאמן (streaming) / ניקוי השיחה |

## משתני סביבה

| משתנה | ברירת מחדל | תיאור |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/dev.db` | חיבור ל-Postgres. `postgres://` מתורגם אוטומטית ל-psycopg. |
| `ANTHROPIC_API_KEY` | – | מפתח API של Anthropic. |
| `DASHBOARD_PASSWORD` | ריק (ללא הגנה) | סיסמה ל-Basic Auth. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | המודל לפידבק ולמאמן. |
| `CALENDAR_ICS_URL` | – | כתובת ה-iCal הסודית של Google Calendar. מציג פגישות בלשונית משימות שגרה. |
| `CALENDAR_TZ` | `Asia/Jerusalem` | אזור הזמן להצגת שעות מהיומן. |
| `PORT` | `8000` | Railway מגדיר לבד. |

## ייבוא נתונים מהדשבורד הישן ב-claude.ai

הנתונים לא עוברים אוטומטית. אפשר לייצא אותם משם ולטעון דרך ה-API (`PUT /api/systems/{id}`, `POST /api/tasks/bulk`).
