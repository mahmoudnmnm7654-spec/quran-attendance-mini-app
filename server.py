
from flask import Flask, request, jsonify, send_from_directory
import sqlite3
import os
import json
import hmac
import hashlib
import urllib.parse
import time
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "attendance.db")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

TEACHER_IDS = {
    x.strip()
    for x in os.environ.get("TEACHER_IDS", "").split(",")
    if x.strip()
}

app = Flask(__name__)

STATUSES = {"حاضرة", "غائبة", "مستمعة", "معتذرة"}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS student_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id TEXT NOT NULL,
                group_id TEXT NOT NULL,
                student_name TEXT NOT NULL,
                requested_at INTEGER NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS student_links (
                telegram_user_id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                student_name TEXT NOT NULL,
                approved_at INTEGER NOT NULL,
                UNIQUE(group_id, student_name)
            )
        """)


init_db()


def verify_telegram_user():
    if not BOT_TOKEN:
        app.logger.error("TELEGRAM_BOT_TOKEN is missing")
        return None

    init_data = request.headers.get("X-Telegram-Init-Data", "")

    if not init_data:
        return None

    try:
        parsed = dict(urllib.parse.parse_qsl(init_data))
        received_hash = parsed.pop("hash", None)

        if not received_hash:
            return None

        data_check_string = "\n".join(
            f"{key}={value}" for key, value in sorted(parsed.items())
        )

        secret_key = hmac.new(
            b"WebAppData",
            BOT_TOKEN.encode("utf-8"),
            hashlib.sha256
        ).digest()

        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(calculated_hash, received_hash):
            app.logger.warning("Telegram initData hash verification failed")
            return None

        auth_date = int(parsed.get("auth_date", "0"))

        if auth_date <= 0 or time.time() - auth_date > 86400:
            return None

        user = json.loads(parsed.get("user", "{}"))
        user_id = user.get("id")

        if not user_id:
            return None

        return str(user_id)

    except (ValueError, TypeError, json.JSONDecodeError):
        app.logger.exception("Telegram initData parsing failed")
        return None


def authorized_user(teacher_only=False):
    user_id = verify_telegram_user()

    if not user_id:
        return None, (jsonify({"error": "Unauthorized"}), 401)

    if teacher_only and user_id not in TEACHER_IDS:
        return None, (
            jsonify({"error": "Teacher access required"}),
            403
        )

    return user_id, None


def load_app_data(conn):
    row = conn.execute(
        "SELECT data FROM app_state WHERE id = 1"
    ).fetchone()

    if not row:
        return None

    try:
        return json.loads(row["data"])
    except (TypeError, json.JSONDecodeError):
        return None


def find_student(data, group_id, student_name):
    if not data or not isinstance(data.get("groups"), list):
        return False

    for group in data["groups"]:
        if (
            str(group.get("id")) == str(group_id)
            and student_name in group.get("students", [])
        ):
            return True

    return False


@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>")
def files(filename):
    if filename in ("app.js", "style.css"):
        return send_from_directory(BASE_DIR, filename)

    return jsonify({"error": "Not found"}), 404


@app.route("/api/me", methods=["GET"])
def get_me():
    user_id, error = authorized_user()

    if error:
        return error

    is_teacher = user_id in TEACHER_IDS

    with get_db() as conn:
        link = conn.execute(
            """SELECT group_id, student_name
               FROM student_links
               WHERE telegram_user_id = ?""",
            (user_id,)
        ).fetchone()

        pending = conn.execute(
            """SELECT id, group_id, student_name
               FROM student_requests
               WHERE telegram_user_id = ?
               ORDER BY id DESC LIMIT 1""",
            (user_id,)
        ).fetchone()

    return jsonify({
        "user_id": user_id,
        "is_teacher": is_teacher,
        "is_student_linked": link is not None,
        "student": dict(link) if link else None,
        "has_pending_request": pending is not None,
        "pending_request": dict(pending) if pending else None
    })


@app.route("/api/groups-for-registration", methods=["GET"])
def groups_for_registration():
    user_id, error = authorized_user()

    if error:
        return error

    with get_db() as conn:
        data = load_app_data(conn)

    if not data or not isinstance(data.get("groups"), list):
        return jsonify({"groups": []})

    groups = [
        {"id": g.get("id"), "name": g.get("name")}
        for g in data["groups"]
    ]

    return jsonify({"groups": groups})


@app.route("/api/data", methods=["GET"])
def get_data():
    user_id, error = authorized_user(teacher_only=True)

    if error:
        return error

    with get_db() as conn:
        row = conn.execute(
            "SELECT data FROM app_state WHERE id = 1"
        ).fetchone()

    if row:
        return app.response_class(
            row["data"],
            mimetype="application/json"
        )

    return jsonify({"message": "no_data"})


@app.route("/api/data", methods=["POST"])
def save_data():
    user_id, error = authorized_user(teacher_only=True)

    if error:
        return error

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "Invalid data"}), 400

    if not isinstance(data.get("groups"), list):
        return jsonify({"error": "Invalid groups"}), 400

    encoded = json.dumps(data, ensure_ascii=False)

    with get_db() as conn:
        conn.execute("""
            INSERT INTO app_state (id, data)
            VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data
        """, (encoded,))

    return jsonify({"ok": True})


@app.route("/api/student/request", methods=["POST"])
def request_student_link():
    user_id, error = authorized_user()

    if error:
        return error

    if user_id in TEACHER_IDS:
        return jsonify({"error": "Teacher account"}), 403

    body = request.get_json(silent=True) or {}
    group_id = str(body.get("group_id", "")).strip()
    student_name = str(body.get("student_name", "")).strip()

    if not group_id or not student_name or len(student_name) > 100:
        return jsonify({"error": "اختاري المجموعة والاسم بشكل صحيح."}), 400

    with get_db() as conn:
        existing_link = conn.execute(
            "SELECT 1 FROM student_links WHERE telegram_user_id = ?",
            (user_id,)
        ).fetchone()

        if existing_link:
            return jsonify({"error": "هذا الحساب مرتبط بطالبة بالفعل."}), 409

        data = load_app_data(conn)

        if not find_student(data, group_id, student_name):
            return jsonify({"error": "الاسم غير موجود في المجموعة."}), 400

        pending = conn.execute(
            """SELECT id, group_id, student_name
               FROM student_requests
               WHERE telegram_user_id = ?""",
            (user_id,)
        ).fetchone()

        if pending:
            if (
                pending["group_id"] == group_id
                and pending["student_name"] == student_name
            ):
                return jsonify({"ok": True, "pending": True})

            return jsonify({
                "error": "لديك طلب سابق ينتظر موافقة المعلمة."
            }), 409

        conn.execute(
            """INSERT INTO student_requests
               (telegram_user_id, group_id, student_name, requested_at)
               VALUES (?, ?, ?, ?)""",
            (user_id, group_id, student_name, int(time.time()))
        )

    return jsonify({"ok": True, "pending": True})


@app.route("/api/teacher/requests", methods=["GET"])
def get_student_requests():
    user_id, error = authorized_user(teacher_only=True)

    if error:
        return error

    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, group_id, student_name, requested_at
            FROM student_requests
            ORDER BY requested_at ASC
        """).fetchall()

        data = load_app_data(conn)

    group_names = {}
    if data:
        for g in data.get("groups", []):
            group_names[str(g.get("id"))] = g.get("name", "")

    requests_list = []

    for row in rows:
        item = dict(row)
        item["group_name"] = group_names.get(str(item["group_id"]), "")
        requests_list.append(item)

    return jsonify({"requests": requests_list})


@app.route("/api/teacher/requests/<int:request_id>/approve", methods=["POST"])
def approve_student_request(request_id):
    user_id, error = authorized_user(teacher_only=True)

    if error:
        return error

    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")

        req = conn.execute(
            "SELECT * FROM student_requests WHERE id = ?",
            (request_id,)
        ).fetchone()

        if not req:
            return jsonify({"error": "الطلب غير موجود أو تمت معالجته."}), 404

        if not find_student(
            load_app_data(conn),
            req["group_id"],
            req["student_name"]
        ):
            return jsonify({
                "error": "لم يعد الاسم موجودًا في هذه المجموعة."
            }), 400

        already_linked = conn.execute(
            """SELECT 1 FROM student_links
               WHERE telegram_user_id = ?
                  OR (group_id = ? AND student_name = ?)""",
            (
                req["telegram_user_id"],
                req["group_id"],
                req["student_name"]
            )
        ).fetchone()

        if already_linked:
            return jsonify({
                "error": "الحساب أو اسم الطالبة مرتبط مسبقًا."
            }), 409

        conn.execute(
            """INSERT INTO student_links
               (telegram_user_id, group_id, student_name, approved_at)
               VALUES (?, ?, ?, ?)""",
            (
                req["telegram_user_id"],
                req["group_id"],
                req["student_name"],
                int(time.time())
            )
        )

        conn.execute(
            "DELETE FROM student_requests WHERE id = ?",
            (request_id,)
        )

    return jsonify({"ok": True})


@app.route("/api/teacher/requests/<int:request_id>/reject", methods=["POST"])
def reject_student_request(request_id):
    user_id, error = authorized_user(teacher_only=True)

    if error:
        return error

    with get_db() as conn:
        result = conn.execute(
            "DELETE FROM student_requests WHERE id = ?",
            (request_id,)
        )

    if result.rowcount == 0:
        return jsonify({"error": "الطلب غير موجود."}), 404

    return jsonify({"ok": True})


@app.route("/api/student/status", methods=["POST"])
def submit_student_status():
    user_id, error = authorized_user()

    if error:
        return error

    if user_id in TEACHER_IDS:
        return jsonify({"error": "Teacher account"}), 403

    body = request.get_json(silent=True) or {}
    status = str(body.get("status", "")).strip()
    attendance_date = str(body.get("date", "")).strip()

    if status not in STATUSES:
        return jsonify({"error": "حالة الحضور غير صحيحة."}), 400

    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", attendance_date):
        return jsonify({"error": "التاريخ غير صحيح."}), 400

    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")

        link = conn.execute(
            """SELECT group_id, student_name
               FROM student_links
               WHERE telegram_user_id = ?""",
            (user_id,)
        ).fetchone()

        if not link:
            return jsonify({
                "error": "لم تتم الموافقة على ربط حسابك بعد."
            }), 403

        data = load_app_data(conn)

        if not find_student(data, link["group_id"], link["student_name"]):
            return jsonify({
                "error": "تعذر العثور على اسمك في المجموعة. تواصلي مع المعلمة."
            }), 400

        if not data.get("records"):
            data["records"] = {}

        key = f'{link["group_id"]}_{attendance_date}'

        if not isinstance(data["records"].get(key), dict):
            data["records"][key] = {}

        data["records"][key][link["student_name"]] = status

        conn.execute(
            "UPDATE app_state SET data = ? WHERE id = 1",
            (json.dumps(data, ensure_ascii=False),)
        )

    return jsonify({"ok": True, "status": status})


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )
