
from flask import Flask, request, jsonify, send_from_directory
import sqlite3
import os
import json
import hmac
import hashlib
import urllib.parse
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "attendance.db")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

TEACHER_IDS = {
    x.strip()
    for x in os.environ.get("TEACHER_IDS", "").split(",")
    if x.strip()
}

app = Flask(__name__)


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL
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

        # Remove hash only. Keep all other fields, including signature.
        received_hash = parsed.pop("hash", None)

        if not received_hash:
            return None

        data_check_string = "\n".join(
            f"{key}={value}"
            for key, value in sorted(parsed.items())
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

    return jsonify({
        "user_id": user_id,
        "is_teacher": user_id in TEACHER_IDS
    })


@app.route("/api/data", methods=["GET"])
def get_data():
    user_id, error = authorized_user()

    if error:
        return error

    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT data FROM app_state WHERE id = 1"
        ).fetchone()

    if row:
        return app.response_class(
            row[0],
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

    encoded = json.dumps(data, ensure_ascii=False)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            INSERT INTO app_state (id, data)
            VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data
        """, (encoded,))

    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )
