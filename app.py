import json
import secrets
import time
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename


app = Flask(__name__, static_folder=".")

ROOT = Path(__file__).parent
DATA_FILE = ROOT / "data.json"
FACE_LIBRARY = ROOT / "face_library"
CLASS_UPLOADS = ROOT / "class_uploads"
MIN_CONFIDENCE = 0.62
RECOGNITION_COOLDOWN_SECONDS = 8

SESSIONS = {}


def utc_now_iso():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def seed_data():
    return {
        "faces": [],
        "users": [
            {
                "id": "u-admin-1",
                "username": "admin",
                "password": "admin123",
                "name": "System Admin",
                "role": "admin",
                "batch_ids": [],
            },
            {
                "id": "u-teacher-1",
                "username": "teacher1",
                "password": "teacher123",
                "name": "Neha Teacher",
                "role": "teacher",
                "batch_ids": ["batch-a"],
            },
            {
                "id": "u-coord-1",
                "username": "coordinator1",
                "password": "coord123",
                "name": "Aman Coordinator",
                "role": "coordinator",
                "batch_ids": ["batch-a"],
            },
            {
                "id": "u-student-1",
                "username": "student1",
                "password": "student123",
                "name": "Aarav Singh",
                "role": "student",
                "batch_ids": ["batch-a"],
                "roll_no": "S101",
            },
            {
                "id": "u-student-2",
                "username": "student2",
                "password": "student123",
                "name": "Diya Patel",
                "role": "student",
                "batch_ids": ["batch-a"],
                "roll_no": "S102",
            },
        ],
        "batches": [
            {
                "id": "batch-a",
                "name": "CSE-A",
                "branch": "CSE",
                "division": "A",
            }
        ],
        "attendance_sessions": [],
    }


def load_db():
    if not DATA_FILE.exists():
        db = seed_data()
        save_db(db)
        return db
    with DATA_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_db(db):
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(db, f, indent=2)


def ensure_dirs():
    FACE_LIBRARY.mkdir(parents=True, exist_ok=True)
    CLASS_UPLOADS.mkdir(parents=True, exist_ok=True)


def friendly_name_from_filename(filename: str) -> str:
    stem = Path(filename or "").stem
    cleaned = stem.replace("_", " ").replace("-", " ")
    cleaned = " ".join(cleaned.split())
    return cleaned.title() if cleaned else "Unknown"


def public_user(user):
    return {
        "id": user["id"],
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
        "batch_ids": user.get("batch_ids", []),
        "roll_no": user.get("roll_no", ""),
    }


def get_current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth.replace("Bearer ", "", 1).strip()
    session = SESSIONS.get(token)
    if not session:
        return None
    return session.get("user")


def auth_required(roles=None):
    roles = roles or []

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            if not user:
                return jsonify({"error": "Unauthorized"}), 401
            if roles and user["role"] not in roles:
                return jsonify({"error": "Forbidden"}), 403
            return func(user, *args, **kwargs)

        return wrapper

    return decorator


@app.route("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    db = load_db()
    user = next(
        (u for u in db["users"] if u["username"] == username and u["password"] == password),
        None,
    )
    if not user:
        return jsonify({"error": "Invalid username or password"}), 401

    token = secrets.token_hex(24)
    SESSIONS[token] = {
        "user": public_user(user),
        "created_at": time.time(),
    }
    return jsonify({"token": token, "user": public_user(user)})


@app.route("/api/logout", methods=["POST"])
@auth_required()
def logout(user):
    auth = request.headers.get("Authorization", "")
    token = auth.replace("Bearer ", "", 1).strip()
    if token in SESSIONS:
        del SESSIONS[token]
    return jsonify({"success": True})


@app.route("/api/me", methods=["GET"])
@auth_required()
def me(user):
    return jsonify({"user": user})


@app.route("/api/bootstrap", methods=["GET"])
@auth_required()
def bootstrap(user):
    db = load_db()
    users = [public_user(u) for u in db["users"]]

    if user["role"] == "admin":
        scoped_users = users
        scoped_sessions = db["attendance_sessions"]
    elif user["role"] in {"teacher", "coordinator"}:
        scoped_users = [u for u in users if u["role"] == "student"]
        scoped_sessions = [
            s for s in db["attendance_sessions"] if s["batch_id"] in user.get("batch_ids", [])
        ]
    else:
        scoped_users = [u for u in users if u["id"] == user["id"]]
        scoped_sessions = [
            s
            for s in db["attendance_sessions"]
            if user["id"] in s.get("attendance", {})
        ]

    return jsonify(
        {
            "users": scoped_users,
            "batches": db["batches"],
            "attendance_sessions": scoped_sessions,
            "faces": db.get("faces", []),
            "settings": {
                "min_confidence": MIN_CONFIDENCE,
                "recognition_cooldown_seconds": RECOGNITION_COOLDOWN_SECONDS,
            },
        }
    )


CLASSES = {
    "branches": [
        "CSE",
        "ENTC",
        "AIML",
        "CIVIL",
        "MECHANICAL",
        "ROBOTICS AND AUTOMATION",
    ],
    "divisions": ["A", "B", "C"],
    "subdivisions": ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3"],
}


@app.route("/api/classes", methods=["GET"])
@auth_required()
def get_classes(user):
    return jsonify(CLASSES)


@app.route("/api/batches", methods=["POST"])
@auth_required(["admin"])
def create_batch(user):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    branch = (data.get("branch") or "").strip()
    division = (data.get("division") or "").strip()
    if not name or not branch or not division:
        return jsonify({"error": "name, branch and division are required"}), 400

    db = load_db()
    batch = {
        "id": f"batch-{uuid.uuid4().hex[:8]}",
        "name": name,
        "branch": branch,
        "division": division,
    }
    db["batches"].append(batch)
    save_db(db)
    return jsonify({"success": True, "batch": batch})


@app.route("/api/batches/<batch_id>", methods=["DELETE"])
@auth_required(["admin"])
def delete_batch(user, batch_id):
    db = load_db()
    db["batches"] = [b for b in db["batches"] if b["id"] != batch_id]
    for u in db["users"]:
        u["batch_ids"] = [bid for bid in u.get("batch_ids", []) if bid != batch_id]
    save_db(db)
    return jsonify({"success": True})


@app.route("/api/users", methods=["POST"])
@auth_required(["admin"])
def create_user(user):
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    name = (data.get("name") or "").strip()
    role = (data.get("role") or "").strip()
    batch_ids = data.get("batch_ids") or []
    roll_no = (data.get("roll_no") or "").strip()

    if role not in {"student", "teacher", "coordinator", "admin"}:
        return jsonify({"error": "invalid role"}), 400
    if not username or not password or not name:
        return jsonify({"error": "username, password and name are required"}), 400

    db = load_db()
    if any(u["username"] == username for u in db["users"]):
        return jsonify({"error": "username already exists"}), 400

    created = {
        "id": f"u-{role}-{uuid.uuid4().hex[:8]}",
        "username": username,
        "password": password,
        "name": name,
        "role": role,
        "batch_ids": batch_ids,
    }
    if role == "student":
        created["roll_no"] = roll_no or f"R-{uuid.uuid4().hex[:4].upper()}"
    db["users"].append(created)
    save_db(db)
    return jsonify({"success": True, "user": public_user(created)})


@app.route("/api/users/<user_id>", methods=["DELETE"])
@auth_required(["admin"])
def delete_user(user, user_id):
    db = load_db()
    db["users"] = [u for u in db["users"] if u["id"] != user_id]
    save_db(db)
    return jsonify({"success": True})


@app.route("/api/admin/face", methods=["POST"])
@auth_required(["admin"])
def upload_face(user):
    ensure_dirs()
    branch = (request.form.get("branch") or "").strip()
    division = (request.form.get("division") or "").strip()
    files = request.files.getlist("files")
    if not files:
        single = request.files.get("file")
        if single:
            files = [single]

    branch = branch.upper()
    division = division.upper()

    if not branch or not division or not files:
        return jsonify({"error": "branch, division, and at least one file are required"}), 400

    db = load_db()
    faces = db.get("faces", [])
    stored = []

    for file in files:
        filename_raw = file.filename or "face.jpg"
        filename = secure_filename(filename_raw)
        face_id = f"face-{uuid.uuid4().hex[:10]}"
        dest_dir = FACE_LIBRARY / branch / division / face_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        file_path = dest_dir / filename
        file.save(file_path)

        record = {
            "id": face_id,
            "name": friendly_name_from_filename(filename_raw),
            "branch": branch,
            "division": division,
            "subdivision": "",
            "file_path": str(file_path.relative_to(ROOT)),
            "source_filename": filename_raw,
            "uploaded_at": utc_now_iso(),
        }
        faces.append(record)
        stored.append(record)

    db["faces"] = faces
    save_db(db)

    return jsonify(
        {
            "success": True,
            "stored": stored,
            "stored_count": len(stored),
            "message": "Stored face images. Connect model training hook to use them.",
        }
    )


@app.route("/api/admin/face", methods=["GET"])
@auth_required(["admin"])
def list_faces(user):
    db = load_db()
    return jsonify({"faces": db.get("faces", [])})

<<<<<<< HEAD

@app.route("/api/admin/face/<face_id>", methods=["DELETE"])
@auth_required(["admin"])
def delete_face(user, face_id):
    db = load_db()
    faces = db.get("faces", [])
    target = next((f for f in faces if f["id"] == face_id), None)
    if not target:
        return jsonify({"error": "not found"}), 404
    faces = [f for f in faces if f["id"] != face_id]
    db["faces"] = faces
    save_db(db)
    path = ROOT / target["file_path"]
    if path.exists():
        path.unlink()
    return jsonify({"success": True})


@app.route("/api/attendance/start", methods=["POST"])
@auth_required(["admin", "teacher", "coordinator"])
def start_attendance(user):
    data = request.get_json(silent=True) or {}
    batch_id = (data.get("batch_id") or "").strip()
    subject = (data.get("subject") or "").strip()
    if not batch_id or not subject:
        return jsonify({"error": "batch_id and subject are required"}), 400

    db = load_db()
    students = [
        u
        for u in db["users"]
        if u["role"] == "student" and batch_id in u.get("batch_ids", [])
    ]
    if not students:
        return jsonify({"error": "no students assigned to this batch"}), 400

    attendance = {
        s["id"]: {
            "status": "Absent",
            "marked_at": "",
            "confidence": 0,
            "last_seen_ts": 0,
        }
        for s in students
    }

    session = {
        "id": f"sess-{uuid.uuid4().hex[:10]}",
        "batch_id": batch_id,
        "subject": subject,
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": utc_now_iso(),
        "attendance": attendance,
        "audit_log": [],
    }

    db["attendance_sessions"].append(session)
    save_db(db)
    return jsonify({"success": True, "session": session})


@app.route("/api/attendance/mark", methods=["POST"])
@auth_required(["admin", "teacher", "coordinator"])
def mark_attendance(user):
    data = request.get_json(silent=True) or {}
    session_id = (data.get("session_id") or "").strip()
    student_id = (data.get("student_id") or "").strip()
    confidence = float(data.get("confidence") or 0)

    if not session_id or not student_id:
        return jsonify({"error": "session_id and student_id are required"}), 400

    db = load_db()
    session = next((s for s in db["attendance_sessions"] if s["id"] == session_id), None)
    if not session:
        return jsonify({"error": "session not found"}), 404

    if student_id not in session["attendance"]:
        return jsonify({"error": "student not part of this session"}), 400

    entry = session["attendance"][student_id]
    now_ts = int(time.time())

    if confidence < MIN_CONFIDENCE:
        session["audit_log"].append(
            {
                "at": utc_now_iso(),
                "student_id": student_id,
                "action": "ignored_low_confidence",
                "confidence": confidence,
            }
        )
        save_db(db)
        return jsonify(
            {
                "success": False,
                "reason": "low_confidence",
                "message": "Face confidence is too low for attendance marking.",
            }
        )

    if entry["status"] == "Present":
        session["audit_log"].append(
            {
                "at": utc_now_iso(),
                "student_id": student_id,
                "action": "ignored_already_present",
                "confidence": confidence,
            }
        )
        save_db(db)
        return jsonify(
            {
                "success": False,
                "reason": "already_present",
                "message": "Duplicate prevented: student already marked present.",
            }
        )

    if now_ts - int(entry.get("last_seen_ts", 0)) < RECOGNITION_COOLDOWN_SECONDS:
        session["audit_log"].append(
            {
                "at": utc_now_iso(),
                "student_id": student_id,
                "action": "ignored_cooldown",
                "confidence": confidence,
            }
        )
        save_db(db)
        return jsonify(
            {
                "success": False,
                "reason": "cooldown",
                "message": "Duplicate prevented: same face seen too soon.",
            }
        )

    entry["status"] = "Present"
    entry["marked_at"] = utc_now_iso()
    entry["confidence"] = confidence
    entry["last_seen_ts"] = now_ts
    session["audit_log"].append(
        {
            "at": utc_now_iso(),
            "student_id": student_id,
            "action": "marked_present",
            "confidence": confidence,
        }
    )

    save_db(db)
    return jsonify(
        {
            "success": True,
            "message": "Attendance marked successfully.",
            "entry": entry,
        }
    )


@app.route("/api/attendance/session/<session_id>", methods=["GET"])
@auth_required()
def attendance_session(user, session_id):
    db = load_db()
    session = next((s for s in db["attendance_sessions"] if s["id"] == session_id), None)
    if not session:
        return jsonify({"error": "session not found"}), 404

    if user["role"] == "student" and user["id"] not in session.get("attendance", {}):
        return jsonify({"error": "forbidden"}), 403

    if user["role"] in {"teacher", "coordinator"} and session["batch_id"] not in user.get(
        "batch_ids", []
    ):
        return jsonify({"error": "forbidden"}), 403

    return jsonify({"session": session})


@app.route("/api/student/summary", methods=["GET"])
@auth_required(["student"])
def student_summary(user):
    db = load_db()
    sessions = [
        s
        for s in db["attendance_sessions"]
        if user["id"] in s.get("attendance", {})
    ]
    total = len(sessions)
    present = sum(1 for s in sessions if s["attendance"][user["id"]]["status"] == "Present")
    pct = round((present / total) * 100, 2) if total else 0
    return jsonify(
        {
            "student_id": user["id"],
            "student_name": user["name"],
            "total_classes": total,
            "present_classes": present,
            "attendance_percent": pct,
            "sessions": sessions,
        }
    )


@app.route("/api/teacher/process_class_photo", methods=["POST"])
@auth_required(["teacher", "admin", "coordinator"])
def process_class_photo(user):
    ensure_dirs()
    file = request.files.get("file")
    batch_id = request.form.get("batch_id")
    subject = request.form.get("subject")
    if not file or not batch_id or not subject:
        return jsonify({"error": "file, batch_id, and subject are required"}), 400

    filename = secure_filename(file.filename or "classroom.jpg")
    dest_dir = CLASS_UPLOADS / batch_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    saved_path = dest_dir / f"{uuid.uuid4().hex[:8]}-{filename}"
    file.save(saved_path)

    # Placeholder: real face matching to be integrated here.
    return jsonify(
        {
            "success": True,
            "message": "Photo stored. Face matching model hookup pending for production accuracy.",
            "stored_path": str(saved_path.relative_to(ROOT)),
        }
    )


if __name__ == "__main__":
    ensure_dirs()
    load_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
=======
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
    #backend
>>>>>>> 974c054ea1f966ceec93411a2a16b1319d363bd1
