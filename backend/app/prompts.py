"""Prompt builders for the morning feedback and the mental coach.

The wording is the same as in the original dashboard; only the data access moved
from the browser to the database.
"""

from __future__ import annotations

from .logic import TaskTree, he_date, yesterday_of
from .models import Day, System, Task

COACH_RULES = """אתה מאמן מנטלי לאדם שבונה לבד סוכנות AI. הוא מרגיש לחץ ועייפות, ימים עוברים בלי שהוא מסיים משימות, והוא נוטה לעבוד על הרבה דברים במקביל.
דבר בעברית, בגובה העיניים, חם וישיר, כמו חבר טוב שהוא גם מאמן מנוסה. תשובות קצרות: עד 120 מילים. בלי כותרות, בלי רשימות ארוכות, בלי אימוג׳ים, בלי קלישאות.
עקרונות: הקשב קודם, שקף במשפט אחד מה שמעת, שאל שאלה אחת בלבד בכל תשובה. העדף צעד אחד קטן וקונקרטי על פני תוכנית גדולה. הצע כלים פשוטים כשמתאים: התחלה של 10 דקות, הקטנת המשימה, נשימה 4-4-6, סגירת טאבים, בחירת משימה אחת והשהיית השאר.
השתמש בנתוני המשימות רק כשזה עוזר, ואל תקריא אותם. אל תאבחן ואל תיתן ייעוץ רפואי. אם עולים סימנים למצוקה קשה או חוסר תקווה עמוק, אמור בעדינות שכדאי לדבר עם איש מקצוע או עם אדם קרוב, ותישאר נוכח."""


def _events_str(day: Day | None) -> str:
    if not day or not day.events:
        return ""
    return ", ".join(f"{e.get('title')} {e.get('from')}→{e.get('to')}%" for e in day.events)


def feedback_prompt(systems: list[System], tasks: list[Task], days: list[Day], today: str, yesterday_text: str, today_text: str) -> str:
    tree = TaskTree(tasks, today)
    L: list[str] = []
    L.append("אתה מאמן פרודוקטיביות ישר וחם לאדם שבונה סוכנות AI לבד, מרגיש לחץ ועייפות, ונוטה לעבוד על הרבה משימות במקביל בלי לסיים.")
    L.append('ענה בעברית בלבד, עד 160 מילים, בטון של עמית ולא של מורה. בלי כותרות, בלי אימוג׳ים, בלי רשימת "טיפים" גנרית.')
    L.append("המבנה: (1) משפט אחד על קצב ההתקדמות האמיתי מהנתונים, (2) אם יש יותר מ־3 משימות במקביל, אמור זאת ישירות ושאל מה נדחה, (3) המלצה אחת קונקרטית ליום הזה בלבד, (4) משפט סיום קצר ומעודד שמתבסס על עובדה מהנתונים.")
    L.append("")
    L.append(f"תאריך היום: {today} ({he_date(today)})")
    L.append("")
    L.append("מצב המערכות (מערכת > משימה > תת־משימה):")

    def st(x: Task) -> str:
        if tree.is_done(x):
            return "הושלם" + (f" {x.done_at}" if x.done_at else "")
        return "בעבודה" if x.status == "active" else "ממתין"

    for s in sorted(systems, key=lambda s: s.order):
        L.append(f"- {s.name}")
        for t in tree.top_tasks(s.id):
            L.append(f"  - {t.title}: {tree.progress(t)}% | {st(t)}{' | מתוכנן להיום' if tree.is_today(t) else ''}")
            for c in tree.children(t.id):
                L.append(
                    f"    - {c.title}: {tree.progress(c)}% | {st(c)}"
                    f"{' | מתוכנן להיום' if tree.is_today(c) else ''}"
                    f"{' | התחיל ' + c.started_at if c.started_at else ''}"
                )
    L.append("")
    L.append(f"מספר משימות בעבודה במקביל: {len(tree.wip())}. מתוכננות להיום: {sum(1 for t in tasks if tree.is_today(t))}.")
    recent = sorted((d for d in days if d.id != today), key=lambda d: d.id, reverse=True)[:7]
    L.append("")
    L.append("שבעת הימים האחרונים:")
    if not recent:
        L.append("- אין תיעוד קודם. זה היום הראשון.")
    for d in recent:
        plan = ", ".join(p.get("title", "") for p in (d.plan or [])) or "לא תועד"
        fb = f" | פידבק קודם: {d.feedback[:200]}" if d.feedback else ""
        L.append(f"- {d.id}: תוכנן: {plan} | תנועות: {_events_str(d) or 'אין'}{fb}")
    today_doc = next((d for d in days if d.id == today), None)
    te = _events_str(today_doc)
    if te:
        L.append(f"- היום עד עכשיו: {te}")
    L.append("")
    L.append("מה הוא כתב על אתמול: " + (yesterday_text.strip() or "(לא כתב)"))
    L.append("מה הוא כתב על היום: " + (today_text.strip() or "(לא כתב)"))
    return "\n".join(L)


def coach_context(systems: list[System], tasks: list[Task], days: list[Day], today: str) -> str:
    tree = TaskTree(tasks, today)
    L = [f"היום: {today}. בעבודה במקביל: {len(tree.wip())}. מתוכננות להיום: {sum(1 for t in tasks if tree.is_today(t))}. פתוחות: {len(tree.open_leaves())}."]
    for s in sorted(systems, key=lambda s: s.order):
        ls = [t for t in tree.leaves() if t.system_id == s.id]
        done = sum(1 for t in ls if tree.is_done(t))
        todays = [t.title for t in ls if tree.is_today(t)]
        L.append(f"{s.name}: {done}/{len(ls)} הושלמו" + (". להיום: " + ", ".join(todays) if todays else ""))
    y = next((d for d in days if d.id == yesterday_of(today)), None)
    if y and y.events:
        L.append("אתמול: " + _events_str(y))
    t = next((d for d in days if d.id == today), None)
    if t and t.feedback:
        L.append("הפידבק של הבוקר: " + t.feedback[:300])
    return "\n".join(L)
