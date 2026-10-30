import os
import sqlite3
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)

logging.basicConfig(level=logging.INFO)

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TEACHER_IDS = {
    item.strip()
    for item in os.environ.get("TEACHER_IDS", "").split(",")
    if item.strip()
}

DB_NAME = "attendance.db"
TIMEZONE = ZoneInfo("Europe/Istanbul")

WELCOME = (
    "🌿 أهلاً بكِ في الحضور القرآني 🌿\n\n"
    "نسأل الله أن يجعل القرآن ربيع قلوبنا ونور صدورنا 💚\n\n"
    "اختاري حالتكِ اليوم:"
)

STATUSES = {
    "present": "حاضرة 💚",
    "listener": "مستمعة 🌸",
    "excused": "معتذرة 🤍",
    "absent": "غائبة 🌷",
}

MESSAGES = {
    "present": "بارك الله في حضوركِ 🌿 ثباتكِ على القرآن نور لقلبكِ.",
    "listener": "أهلًا بكِ يا محبة القرآن 💚 استماعكِ عبادة وأجر.",
    "excused": "نسأل الله أن ييسر أمركِ ويكتب لكِ الأجر 🌸",
    "absent": "افتقدنا مشاركتكِ اليوم 🌷 ننتظركِ في اللقاء القادم.",
}


def init_db():
    with sqlite3.connect(DB_NAME) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS attendance (
                user_id INTEGER NOT NULL,
                attendance_date TEXT NOT NULL,
                attendance_time TEXT NOT NULL,
                student_name TEXT NOT NULL,
                username TEXT,
                status TEXT NOT NULL,
                PRIMARY KEY (user_id, attendance_date)
            )
        """)


def attendance_keyboard():
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("💚 حاضرة", callback_data="present"),
            InlineKeyboardButton("🌸 مستمعة", callback_data="listener"),
        ],
        [
            InlineKeyboardButton("🤍 معتذرة", callback_data="excused"),
            InlineKeyboardButton("🌷 غائبة", callback_data="absent"),
        ],
    ])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        WELCOME,
        reply_markup=attendance_keyboard(),
    )


async def myid(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        f"رقم حسابكِ في تيليجرام هو:\n`{update.effective_user.id}`",
        parse_mode="Markdown",
    )


async def attendance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    status = query.data
    if status not in STATUSES:
        return

    user = query.from_user
    now = datetime.now(TIMEZONE)
    student_name = " ".join(
        part for part in [user.first_name, user.last_name] if part
    )

    with sqlite3.connect(DB_NAME) as conn:
        conn.execute("""
            INSERT INTO attendance
                (user_id, attendance_date, attendance_time,
                 student_name, username, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, attendance_date)
            DO UPDATE SET
                attendance_time = excluded.attendance_time,
                student_name = excluded.student_name,
                username = excluded.username,
                status = excluded.status
        """, (
            user.id,
            now.strftime("%Y-%m-%d"),
            now.strftime("%H:%M:%S"),
            student_name,
            user.username,
            status,
        ))

    await query.edit_message_text(
        f"{MESSAGES[status]}\n\n"
        f"✅ تم تسجيل حالتكِ: {STATUSES[status]}\n"
        f"📅 التاريخ: {now.strftime('%Y-%m-%d')}\n"
        f"🕒 الوقت: {now.strftime('%H:%M')}",
        reply_markup=attendance_keyboard(),
    )


async def report(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user

    if str(user.id) not in TEACHER_IDS:
        await update.message.reply_text(
            "🔒 هذا التقرير مخصص للمعلمة فقط."
        )
        return

    today = datetime.now(TIMEZONE).strftime("%Y-%m-%d")

    with sqlite3.connect(DB_NAME) as conn:
        rows = conn.execute("""
            SELECT student_name, username, status, attendance_time
            FROM attendance
            WHERE attendance_date = ?
            ORDER BY attendance_time
        """, (today,)).fetchall()

    if not rows:
        await update.message.reply_text(
            f"📋 لا توجد تسجيلات حضور لهذا اليوم: {today}"
        )
        return

    lines = [f"📋 تقرير الحضور القرآني\n📅 {today}\n"]

    for name, username, status, time in rows:
        display_name = f"@{username}" if username else name
        lines.append(
            f"{STATUSES[status]} — {name}\n"
            f"الحساب: {display_name} | الوقت: {time}"
        )

    await update.message.reply_text("\n\n".join(lines))


def main():
    if not TOKEN:
        raise RuntimeError(
            "لم يتم إعداد رمز البوت TELEGRAM_BOT_TOKEN."
        )

    init_db()

    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("myid", myid))
    app.add_handler(CommandHandler("report", report))
    app.add_handler(CallbackQueryHandler(attendance))

    print("تم تشغيل البوت. أوقفيه باستخدام Ctrl+C.")
    app.run_polling()


if __name__ == "__main__":
    main()