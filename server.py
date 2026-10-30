
from flask import Flask, request, jsonify, send_from_directory
import sqlite3
import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "attendance.db")

app = Flask(__name__)


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL
            )
        """)


# تجهيز قاعدة البيانات عند تشغيل الخادم
init_db()


@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>")
def files(filename):
    if filename in ("app.js", "style.css"):
        return send_from_directory(BASE_DIR, filename)
    return jsonify({"error": "Not found"}), 404


@app.route("/api/data", methods=["GET"])
def get_data():
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT data FROM app_state WHERE id = 1"
        ).fetchone()

    if row:
        return app.response_class(
            row[0], mimetype="application/json"
        )

    return jsonify({"message": "no_data"})


@app.route("/api/data", methods=["POST"])
def save_data():
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
    print("الخادم يعمل على http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False)
