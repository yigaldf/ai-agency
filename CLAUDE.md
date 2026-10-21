# הנחיות עבודה לקלוד בריפו הזה

## לפני שבונים מערכת חדשה
**בכל פעם שהמשתמש מבקש לבנות מערכת, אפליקציה או שירות חדשים, שאל קודם מה הסטאק הטכנולוגי הנדרש** (frontend, backend, מסד נתונים, פלטפורמת אירוח) ואל תניח ברירת מחדל. התחל לבנות רק אחרי שהסטאק אושר.

ברירת המחדל של המשתמש בריפו הזה: React (Vite + TypeScript) · Python FastAPI · PostgreSQL · Railway. גם כשזו ברירת המחדל, אשר אותה בשאלה קצרה לפני שמתחילים.

## שפה
המשתמש כותב בעברית או באנגלית. נסח מחדש את השאלה באנגלית, וענה בשפה שבה נשאלה.

## מבנה הפרויקט
- `frontend/` – React + Vite + TypeScript. `npm run build` מייצר `frontend/dist`.
- `backend/` – FastAPI + SQLAlchemy 2. `app/main.py` הוא נקודת הכניסה. בפרודקשן FastAPI גם מגיש את ה-React הבנוי מתוך `backend/static`.
- `Dockerfile` בשורש בונה את שניהם לאימג׳ אחד. Railway משתמש בו דרך `railway.json`.

## בדיקות לפני push
```bash
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run build
```

## מוסכמות
- JSON ב-API הוא camelCase (Pydantic עם `alias_generator=to_camel`); Python נשאר snake_case.
- תאריכים "של היום" מגיעים מהלקוח (`today`), כי השרת רץ ב-UTC והמשתמש בישראל.
- אין Alembic כרגע; הטבלאות נוצרות ב-`create_all` בעלייה. שינוי סכמה דורש מיגרציה ידנית או הוספת Alembic.
