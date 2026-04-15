
        const state = {
            token: localStorage.getItem("token") || "",
            me: null,
            users: [],
            batches: [],
            sessions: [],
            activeSessionId: "",
            settings: null,
        };

        const BRANCHES = [
            "CSE",
            "ENTC",
            "AIML",
            "CIVIL",
            "MECHANICAL",
            "ROBOTICS AND AUTOMATION",
        ];

        const SUBJECTS_BY_BRANCH = {
            CSE: [
                "Software Engineering",
                "Python Programming",
                "Computer Architecture and Organisation",
                "Cyber Security",
                "Linear Algebra",
                "Microcontroller and Sensors",
            ],
        };

        const API_BASE = (window.location.origin && window.location.origin.startsWith("http"))
            ? window.location.origin
            : "http://127.0.0.1:5000";

        const API = {
            async call(path, options = {}) {
                const headers = { ...(options.headers || {}) };
                const isForm = options.body instanceof FormData;
                if (state.token) {
                    headers["Authorization"] = `Bearer ${state.token}`;
                }
                if (!isForm && !headers["Content-Type"]) {
                    headers["Content-Type"] = "application/json";
                }
                const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
                const resp = await fetch(url, { ...options, headers });
                const body = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    throw new Error(body.error || body.message || "Request failed");
                }
                return body;
            },
        };

        const loginView = document.getElementById("loginView");
        const appView = document.getElementById("appView");
        const nav = document.getElementById("nav");
        const screen = document.getElementById("screen");
        const banner = document.getElementById("globalBanner");

        function setBanner(message, type = "info") {
            if (!message) {
                banner.classList.add("hidden");
                banner.textContent = "";
                return;
            }
            banner.classList.remove("hidden");
            banner.textContent = message;
            banner.style.borderColor = type === "error" ? "#fecaca" : "#bee3f8";
            banner.style.background = type === "error" ? "#fff1f2" : "#ebf8ff";
            banner.style.color = type === "error" ? "#7f1d1d" : "#1a4d74";
        }

        function roleTabs(role) {
            if (role === "admin") {
                return [
                    { key: "overview", label: "Admin Overview" },
                    { key: "batches", label: "Batch Management" },
                    { key: "users", label: "Student/Teacher Control" },
                    { key: "faceLibrary", label: "Face Library" },
                    { key: "allAttendance", label: "All Attendance" },
                ];
            }
            if (role === "teacher") {
                return [
                    { key: "takeAttendance", label: "Take Attendance" },
                    { key: "classPhoto", label: "Class Photo Upload" },
                    { key: "history", label: "Class History" },
                ];
            }
            if (role === "coordinator") {
                return [
                    { key: "monitor", label: "Coordinator Monitor" },
                    { key: "history", label: "Attendance Reports" },
                ];
            }
            return [
                { key: "myAttendance", label: "My Attendance" },
            ];
        }

        function usersByRole(role) {
            return state.users.filter((u) => u.role === role);
        }

        function batchName(batchId) {
            const b = state.batches.find((it) => it.id === batchId);
            return b ? `${b.name} (${b.branch}-${b.division})` : batchId;
        }

        function studentsByBranch(branch) {
            const batchById = Object.fromEntries(state.batches.map((b) => [b.id, b]));
            return state.users.filter((u) => {
                if (u.role !== "student") return false;
                return (u.batch_ids || []).some((bid) => {
                    const b = batchById[bid];
                    return b && (b.branch || "").toUpperCase() === branch.toUpperCase();
                });
            });
        }

        function subjectsForBatchId(batchId) {
            const b = state.batches.find((it) => it.id === batchId);
            if (!b) return [];
            const branch = (b.branch || "").toUpperCase();
            return SUBJECTS_BY_BRANCH[branch] || [];
        }

        async function bootstrap() {
            const data = await API.call("/api/bootstrap");
            state.users = data.users;
            state.batches = data.batches;
            state.sessions = data.attendance_sessions;
            state.faces = data.faces || [];
            state.settings = data.settings;
        }

        function drawNav(defaultKey) {
            nav.innerHTML = "";
            const tabs = roleTabs(state.me.role);
            tabs.forEach((tab, idx) => {
                const b = document.createElement("button");
                b.textContent = tab.label;
                b.className = idx === 0 ? "active" : "";
                b.onclick = () => {
                    [...nav.children].forEach((c) => c.classList.remove("active"));
                    b.classList.add("active");
                    renderScreen(tab.key);
                };
                nav.appendChild(b);
            });
            renderScreen(defaultKey || tabs[0].key);
        }

        function statCard(title, value, note = "") {
            return `
                <div class="stat">
                    <div class="muted">${title}</div>
                    <h4>${value}</h4>
                    ${note ? `<div class="muted">${note}</div>` : ""}
                </div>
            `;
        }

        function renderOverview() {
            const students = usersByRole("student").length;
            const teachers = usersByRole("teacher").length;
            const coordinators = usersByRole("coordinator").length;
            const admins = usersByRole("admin").length;
            const sessions = state.sessions.length;

            screen.innerHTML = `
                <div class="card">
                    <h3>Admin Control Summary</h3>
                    <p class="muted">Manage batches, students, teachers, coordinators, and full attendance data from this panel.</p>
                    <div class="stats" style="margin-top: 14px;">
                        ${statCard("Admins", admins)}
                        ${statCard("Teachers", teachers)}
                        ${statCard("Coordinators", coordinators)}
                        ${statCard("Students", students)}
                    </div>
                    <div class="stats" style="margin-top: 10px;">
                        ${statCard("Batches", state.batches.length)}
                        ${statCard("Attendance Sessions", sessions)}
                        ${statCard("Minimum Confidence", state.settings.min_confidence)}
                        ${statCard("Duplicate Cooldown", state.settings.recognition_cooldown_seconds + " sec")}
                    </div>
                </div>
            `;
        }

        function renderBatches() {
            const branches = ["CSE", "ENTC", "AIML", "CIVIL", "MECHANICAL", "ROBOTICS AND AUTOMATION"];
            screen.innerHTML = `
                <div class="split">
                    <div class="card">
                        <h3>Add Batch</h3>
                        <div class="field"><label>Batch Name</label><input id="batchName" placeholder="CSE-B"></div>
                        <div class="field"><label>Branch</label><input id="batchBranch" placeholder="CSE"></div>
                        <div class="field"><label>Division</label><input id="batchDivision" placeholder="B"></div>
                        <button class="btn-brand" id="addBatchBtn">Add Batch</button>
                    </div>
                    <div class="card">
                        <h3>Existing Batches</h3>
                        <table>
                            <thead><tr><th>Batch</th><th>Division</th><th>Action</th></tr></thead>
                            <tbody>
                                ${state.batches.map((b) => `
                                    <tr>
                                        <td>${b.name}</td>
                                        <td>${b.branch}-${b.division}</td>
                                        <td><button class="btn-danger" data-del-batch="${b.id}">Remove</button></td>
                                    </tr>
                                `).join("") || "<tr><td colspan='3'>No batches</td></tr>"}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="card">
                    <h3>Branches & Students</h3>
                    <p class="muted">Click a branch to see students assigned via their batches.</p>
                    <div class="branch-grid">
                        ${branches.map((b) => `<button class='btn-soft' data-branch='${b}'>${b}</button>`).join("")}
                    </div>
                    <div id="branchDetail" class="muted" style="margin-top:10px;">Select a branch to view students.</div>
                </div>
            `;

            document.getElementById("addBatchBtn").onclick = async () => {
                try {
                    await API.call("/api/batches", {
                        method: "POST",
                        body: JSON.stringify({
                            name: document.getElementById("batchName").value.trim(),
                            branch: document.getElementById("batchBranch").value.trim(),
                            division: document.getElementById("batchDivision").value.trim(),
                        }),
                    });
                    await bootstrap();
                    renderBatches();
                    setBanner("Batch created successfully.");
                } catch (err) {
                    setBanner(err.message, "error");
                }
            };

            screen.querySelectorAll("[data-del-batch]").forEach((btn) => {
                btn.onclick = async () => {
                    try {
                        await API.call(`/api/batches/${btn.dataset.delBatch}`, { method: "DELETE" });
                        await bootstrap();
                        renderBatches();
                        setBanner("Batch removed.");
                    } catch (err) {
                        setBanner(err.message, "error");
                    }
                };
            });

            const detail = document.getElementById("branchDetail");
            screen.querySelectorAll("[data-branch]").forEach((btn) => {
                btn.onclick = () => {
                    const branch = btn.dataset.branch;
                    const students = studentsByBranch(branch);
                    const list = students.map((s) => `<li>${s.name} (${s.username || ""})</li>`).join("");
                    detail.innerHTML = students.length
                        ? `<strong>${branch}</strong> students:<ul style='margin-top:6px; margin-left:16px;'>${list}</ul>`
                        : `<strong>${branch}</strong>: No students assigned yet.`;
                };
            });
        }

        function roleOptions() {
            return `
                <option value="student">student</option>
                <option value="teacher">teacher</option>
                <option value="coordinator">coordinator</option>
                <option value="admin">admin</option>
            `;
        }

        function batchMultiSelect(id) {
            return `
                <select id="${id}" multiple size="4">
                    ${state.batches.map((b) => `<option value="${b.id}">${batchName(b.id)}</option>`).join("")}
                </select>
            `;
        }

        function renderUsers() {
            const rows = state.users
                .map((u) => `
                    <tr>
                        <td>${u.name}</td>
                        <td>${u.username}</td>
                        <td>${u.role}</td>
                        <td>${u.roll_no || "-"}</td>
                        <td>${(u.batch_ids || []).map(batchName).join(", ") || "-"}</td>
                        <td>${u.id === state.me.id ? "Current user" : `<button class='btn-danger' data-del-user='${u.id}'>Remove</button>`}</td>
                    </tr>
                `)
                .join("");

            screen.innerHTML = `
                <div class="row">
                    <div class="card col-5">
                        <h3>Add User</h3>
                        <div class="field"><label>Name</label><input id="uName"></div>
                        <div class="field"><label>Username</label><input id="uUsername"></div>
                        <div class="field"><label>Password</label><input id="uPassword" value="pass123"></div>
                        <div class="field"><label>Role</label><select id="uRole">${roleOptions()}</select></div>
                        <div class="field"><label>Roll No (for student)</label><input id="uRoll"></div>
                        <div class="field"><label>Assign Batches</label>${batchMultiSelect("uBatches")}</div>
                        <button class="btn-brand" id="createUserBtn">Create User</button>
                    </div>
                    <div class="card col-8">
                        <h3>User Directory</h3>
                        <table>
                            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Roll</th><th>Batches</th><th>Action</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            `;

            document.getElementById("createUserBtn").onclick = async () => {
                const selected = [...document.getElementById("uBatches").selectedOptions].map((o) => o.value);
                try {
                    await API.call("/api/users", {
                        method: "POST",
                        body: JSON.stringify({
                            name: document.getElementById("uName").value.trim(),
                            username: document.getElementById("uUsername").value.trim(),
                            password: document.getElementById("uPassword").value.trim(),
                            role: document.getElementById("uRole").value,
                            roll_no: document.getElementById("uRoll").value.trim(),
                            batch_ids: selected,
                        }),
                    });
                    await bootstrap();
                    renderUsers();
                    setBanner("User created.");
                } catch (err) {
                    setBanner(err.message, "error");
                }
            };

            screen.querySelectorAll("[data-del-user]").forEach((btn) => {
                btn.onclick = async () => {
                    try {
                        await API.call(`/api/users/${btn.dataset.delUser}`, { method: "DELETE" });
                        await bootstrap();
                        renderUsers();
                        setBanner("User removed.");
                    } catch (err) {
                        setBanner(err.message, "error");
                    }
                };
            });
        }

        function optionList(arr) {
            return arr.map((v) => `<option value="${v}">${v}</option>`).join("");
        }

        async function renderFaceLibrary() {
            const classes = await API.call("/api/classes");
            const rows = (state.faces || []).map((f) => {
                const faceName = f.name || f.source_filename || "Unknown";
                return `
                <tr>
                    <td>${faceName}</td>
                    <td>${f.branch}</td>
                    <td>${f.division}</td>
                    <td>${f.uploaded_at || "-"}</td>
                    <td><button class='btn-danger' data-del-face='${f.id}'>Delete</button></td>
                </tr>
            `; }).join("") || `<tr><td colspan='5'>No faces uploaded yet.</td></tr>`;

            screen.innerHTML = `
                <div class="card">
                    <h3>Upload Student Faces</h3>
                    <div class="row">
                        <div class="col-5 field"><label>Branch</label><select id="faceBranch">${optionList(classes.branches)}</select></div>
                        <div class="col-3 field"><label>Division</label><select id="faceDivision">${optionList(classes.divisions)}</select></div>
                        <div class="col-6 field"><label>Photos (names from filenames)</label><input id="faceFile" type="file" accept="image/*" multiple></div>
                        <div class="col-12"><button class="btn-brand" id="uploadFaceBtn">Upload & Save</button></div>
                    </div>
                    <p class="muted" style="margin-top:8px;">Select multiple photos at once. Student names are read from filenames (before extension). Files are stored locally in face_library/ for reuse; connect your model training to consume them.</p>
                </div>
                <div class="card">
                    <h3>Stored Faces</h3>
                    <table>
                        <thead><tr><th>Name</th><th>Branch</th><th>Division</th><th>Uploaded</th><th>Action</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;

            document.getElementById("uploadFaceBtn").onclick = async () => {
                const fileInput = document.getElementById("faceFile");
                const files = [...fileInput.files];
                if (!files.length) {
                    setBanner("Select at least one photo to upload.", "error");
                    return;
                }
                const fd = new FormData();
                fd.append("branch", document.getElementById("faceBranch").value);
                fd.append("division", document.getElementById("faceDivision").value);
                files.forEach((file) => fd.append("files", file));
                try {
                    const resp = await API.call("/api/admin/face", { method: "POST", body: fd, headers: {} });
                    await bootstrap();
                    renderFaceLibrary();
                    setBanner(`Stored ${resp.stored_count || files.length} face photo(s). Model training hook pending.`);
                } catch (err) {
                    setBanner(err.message, "error");
                }
            };

            screen.querySelectorAll("[data-del-face]").forEach((btn) => {
                btn.onclick = async () => {
                    try {
                        await API.call(`/api/admin/face/${btn.dataset.delFace}`, { method: "DELETE" });
                        await bootstrap();
                        renderFaceLibrary();
                        setBanner("Face deleted.");
                    } catch (err) {
                        setBanner(err.message, "error");
                    }
                };
            });
        }

        function sessionRows(sessions, roleMode = "full") {
            return sessions.map((s) => {
                const attendance = Object.values(s.attendance || {});
                const present = attendance.filter((a) => a.status === "Present").length;
                const total = attendance.length;
                const pct = total ? ((present / total) * 100).toFixed(1) : "0.0";
                return `
                    <tr>
                        <td>${s.subject}</td>
                        <td>${batchName(s.batch_id)}</td>
                        <td>${s.created_by_name}</td>
                        <td>${present}/${total} (${pct}%)</td>
                        <td>${s.created_at}</td>
                        ${roleMode === "full" ? `<td><button class='btn-soft' data-open-session='${s.id}'>View</button></td>` : ""}
                    </tr>
                `;
            }).join("");
        }

        function renderAllAttendance() {
            const rows = sessionRows(state.sessions, "full") || "<tr><td colspan='6'>No session data yet.</td></tr>";
            screen.innerHTML = `
                <div class="card">
                    <h3>All Classes Attendance</h3>
                    <table>
                        <thead><tr><th>Subject</th><th>Batch</th><th>Taken By</th><th>Present</th><th>Created</th><th>Action</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div class="card" id="sessionDetail"></div>
            `;
            attachSessionDetailHandler();
        }

        function renderTakeAttendance() {
            const myBatchIds = state.me.batch_ids || [];
            const myBatches = state.batches.filter((b) => myBatchIds.includes(b.id));
            const studentPool = state.users.filter((u) => u.role === "student" && u.batch_ids.some((id) => myBatchIds.includes(id)));

            const branchOptions = BRANCHES.map((b) => {
                const hasBatch = myBatches.some((batch) => (batch.branch || "").toUpperCase() === b);
                return hasBatch ? `<option value='${b}'>${b}</option>` : "";
            }).join("") || `<option value="">No branch assigned</option>`;

            screen.innerHTML = `
                <div class="split">
                    <div class="card">
                        <h3>Start Attendance Session</h3>
                        <div class="field">
                            <label>Branch</label>
                            <select id="attBranch">${branchOptions}</select>
                        </div>
                        <div class="field">
                            <label>Batch</label>
                            <select id="attBatch">
                                ${myBatches.map((b) => `<option value='${b.id}'>${batchName(b.id)}</option>`).join("")}
                            </select>
                        </div>
                        <div class="field"><label>Subject</label><select id="attSubject"></select></div>
                        <button class="btn-brand" id="startSessionBtn">Start Session</button>
                        <p class="muted" style="margin-top: 8px;">Session must be started before marking attendance.</p>
                    </div>
                    <div class="card">
                        <h3>Recognition Guardrails</h3>
                        <p class="muted">Duplicate prevention is active:</p>
                        <ul style="margin: 10px 0 0 16px; line-height: 1.6;">
                            <li>Minimum confidence: <strong>${state.settings.min_confidence}</strong></li>
                            <li>Per-face cooldown: <strong>${state.settings.recognition_cooldown_seconds} sec</strong></li>
                            <li>Already-present student cannot be marked again in same class.</li>
                        </ul>
                    </div>
                </div>
                <div class="split">
                    <div class="card">
                        <h3>Live Marking (Face Match Input)</h3>
                        <div class="field">
                            <label>Detected Student</label>
                            <select id="markStudent">
                                ${studentPool.map((s) => `<option value='${s.id}'>${s.name} (${s.username})</option>`).join("")}
                            </select>
                        </div>
                        <div class="field"><label>Model Confidence (fixed)</label><input id="markConfidence" type="number" min="0" max="1" step="0.01" value="1.00" disabled></div>
                        <button class="btn-brand" id="markBtn">Mark Present</button>
                    </div>
                    <div class="card" id="liveSessionCard">
                        <h3>Session Summary</h3>
                        <p class="muted">No active session.</p>
                    </div>
                </div>
            `;

            const attBranchEl = document.getElementById("attBranch");
            const attBatchEl = document.getElementById("attBatch");
            const attSubjectEl = document.getElementById("attSubject");

            function refreshBatches() {
                const branchVal = (attBranchEl.value || "").toUpperCase();
                const filtered = myBatches.filter((b) => (b.branch || "").toUpperCase() === branchVal);
                attBatchEl.innerHTML = filtered.length
                    ? filtered.map((b) => `<option value='${b.id}'>${batchName(b.id)}</option>`).join("")
                    : `<option value="">No batches for branch</option>`;
                attBatchEl.disabled = filtered.length === 0;
                refreshSubjects();
            }

            function refreshSubjects() {
                const subs = subjectsForBatchId(attBatchEl.value) || [];
                attSubjectEl.innerHTML = subs.length
                    ? subs.map((s) => `<option value='${s}'>${s}</option>`).join("")
                    : `<option value="">No subjects configured</option>`;
                attSubjectEl.disabled = subs.length === 0;
            }

            attBranchEl.onchange = refreshBatches;
            attBatchEl.onchange = refreshSubjects;
            refreshBatches();

            document.getElementById("startSessionBtn").onclick = async () => {
                try {
                    const resp = await API.call("/api/attendance/start", {
                        method: "POST",
                        body: JSON.stringify({
                            batch_id: document.getElementById("attBatch").value,
                            subject: document.getElementById("attSubject").value,
                        }),
                    });
                    state.activeSessionId = resp.session.id;
                    await bootstrap();
                    renderTakeAttendance();
                    renderLiveSession(resp.session);
                    setBanner("Attendance session started.");
                } catch (err) {
                    setBanner(err.message, "error");
                }
            };

            document.getElementById("markBtn").onclick = async () => {
                if (!state.activeSessionId) {
                    setBanner("Start session first.", "error");
                    return;
                }
                try {
                    const resp = await API.call("/api/attendance/mark", {
                        method: "POST",
                        body: JSON.stringify({
                            session_id: state.activeSessionId,
                            student_id: document.getElementById("markStudent").value,
                            confidence: 1,
                        }),
                    });
                    await bootstrap();
                    const active = state.sessions.find((s) => s.id === state.activeSessionId);
                    renderLiveSession(active);
                    setBanner(resp.message || "Marked.");
                } catch (err) {
                    setBanner(err.message, "error");
                }
            };

            if (state.activeSessionId) {
                const active = state.sessions.find((s) => s.id === state.activeSessionId);
                if (active) {
                    renderLiveSession(active);
                }
            }
        }

        function renderClassPhoto() {
            const myBatchIds = state.me.batch_ids || [];
            const myBatches = state.batches.filter((b) => myBatchIds.includes(b.id));
            const branchOptions = BRANCHES.map((b) => {
                const hasBatch = myBatches.some((batch) => (batch.branch || "").toUpperCase() === b);
                return hasBatch ? `<option value='${b}'>${b}</option>` : "";
            }).join("") || `<option value="">No branch assigned</option>`;

            screen.innerHTML = `
                <div class="split">
                    <div class="card">
                        <h3>Upload Classroom Photo</h3>
                        <div class="field"><label>Branch</label><select id="cpBranch">${branchOptions}</select></div>
                        <div class="field"><label>Batch</label><select id="cpBatch">${myBatches.map((b) => `<option value='${b.id}'>${batchName(b.id)}</option>`).join("")}</select></div>
                        <div class="field"><label>Subject</label><select id="cpSubject"></select></div>
                        <div class="field"><label>Photo</label><input id="cpFile" type="file" accept="image/*"></div>
                        <button class="btn-brand" id="cpUploadBtn">Upload & Process</button>
                        <p class="muted" style="margin-top:8px;">Stored locally; real face matching model hook is pending.</p>
                    </div>
                    <div class="card" id="cpResult">
                        <h3>Result</h3>
                        <p class="muted">No photo uploaded yet.</p>
                    </div>
                </div>
            `;

            const cpBranchEl = document.getElementById("cpBranch");
            const cpBatchEl = document.getElementById("cpBatch");
            const cpSubjectEl = document.getElementById("cpSubject");

            function refreshCpBatches() {
                const branchVal = (cpBranchEl.value || "").toUpperCase();
                const filtered = myBatches.filter((b) => (b.branch || "").toUpperCase() === branchVal);
                cpBatchEl.innerHTML = filtered.length
                    ? filtered.map((b) => `<option value='${b.id}'>${batchName(b.id)}</option>`).join("")
                    : `<option value="">No batches for branch</option>`;
                cpBatchEl.disabled = filtered.length === 0;
                refreshCpSubjects();
            }

            function refreshCpSubjects() {
                const subs = subjectsForBatchId(cpBatchEl.value) || [];
                cpSubjectEl.innerHTML = subs.length
                    ? subs.map((s) => `<option value='${s}'>${s}</option>`).join("")
                    : `<option value="">No subjects configured</option>`;
                cpSubjectEl.disabled = subs.length === 0;
            }

            cpBranchEl.onchange = refreshCpBatches;
            cpBatchEl.onchange = refreshCpSubjects;
            refreshCpBatches();

            document.getElementById("cpUploadBtn").onclick = async () => {
                const fileInput = document.getElementById("cpFile");
                if (!fileInput.files.length) {
                    setBanner("Select a classroom photo to upload.", "error");
                    return;
                }
                const fd = new FormData();
                fd.append("batch_id", document.getElementById("cpBatch").value);
                fd.append("subject", document.getElementById("cpSubject").value);
                fd.append("file", fileInput.files[0]);
                try {
                    const resp = await API.call("/api/teacher/process_class_photo", { method: "POST", body: fd, headers: {} });
                    document.getElementById("cpResult").innerHTML = `
                        <h3>Result</h3>
                        <p>${resp.message}</p>
                        <p class='muted'>Stored at ${resp.stored_path}</p>
                        <p class='warn'>Note: Hook up the face recognition model to convert this photo into attendance marks.</p>
                    `;
                    setBanner("Photo stored. Integrate face model for marking.");
                } catch (err) {
                    setBanner(err.message, "error");
                }
            };
        }

        function renderLiveSession(session) {
            const card = document.getElementById("liveSessionCard");
            if (!card || !session) return;
            const rows = Object.entries(session.attendance || {}).map(([studentId, rec]) => {
                const student = state.users.find((u) => u.id === studentId) || { name: studentId };
                return `
                    <tr>
                        <td>${student.name}</td>
                        <td><span class='tag ${rec.status.toLowerCase()}'>${rec.status}</span></td>
                        <td>${rec.marked_at || "-"}</td>
                        <td>${rec.confidence || "-"}</td>
                    </tr>
                `;
            }).join("");
            card.innerHTML = `
                <h3>Session Summary: ${session.subject}</h3>
                <p class='muted'>${batchName(session.batch_id)} | Started ${session.created_at}</p>
                <table>
                    <thead><tr><th>Student</th><th>Status</th><th>Marked At</th><th>Confidence</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
        }

        function renderHistory() {
            const rows = sessionRows(state.sessions, "compact") || "<tr><td colspan='5'>No attendance sessions available.</td></tr>";
            screen.innerHTML = `
                <div class='card'>
                    <h3>Attendance History</h3>
                    <table>
                        <thead><tr><th>Subject</th><th>Batch</th><th>Taken By</th><th>Present</th><th>Date</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }

        function renderMonitor() {
            const latest = [...state.sessions].reverse().slice(0, 5);
            const rows = sessionRows(latest, "compact") || "<tr><td colspan='5'>No classes yet.</td></tr>";
            screen.innerHTML = `
                <div class='card'>
                    <h3>Coordinator Monitor</h3>
                    <p class='muted'>Track classes and detect low attendance quickly.</p>
                    <table>
                        <thead><tr><th>Subject</th><th>Batch</th><th>Taken By</th><th>Present</th><th>Date</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }

        async function renderMyAttendance() {
            try {
                const summary = await API.call("/api/student/summary");
                const rows = summary.sessions.map((s) => {
                    const rec = s.attendance[summary.student_id];
                    return `
                        <tr>
                            <td>${s.subject}</td>
                            <td>${batchName(s.batch_id)}</td>
                            <td><span class='tag ${rec.status.toLowerCase()}'>${rec.status}</span></td>
                            <td>${rec.marked_at || "-"}</td>
                        </tr>
                    `;
                }).join("") || "<tr><td colspan='4'>No attendance entries.</td></tr>";

                screen.innerHTML = `
                    <div class='card'>
                        <h3>Student Attendance Dashboard</h3>
                        <div class='stats' style='margin-top: 10px;'>
                            ${statCard("Total Classes", summary.total_classes)}
                            ${statCard("Present", summary.present_classes)}
                            ${statCard("Attendance %", summary.attendance_percent + "%")}
                            ${statCard("Required", "75%", summary.attendance_percent < 75 ? "Below target" : "On target")}
                        </div>
                    </div>
                    <div class='card'>
                        <h3>Class-wise Status</h3>
                        <table>
                            <thead><tr><th>Subject</th><th>Batch</th><th>Status</th><th>Marked At</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            } catch (err) {
                setBanner(err.message, "error");
            }
        }

        function attachSessionDetailHandler() {
            screen.querySelectorAll("[data-open-session]").forEach((btn) => {
                btn.onclick = () => {
                    const session = state.sessions.find((s) => s.id === btn.dataset.openSession);
                    const detail = document.getElementById("sessionDetail");
                    if (!session || !detail) return;
                    const rows = Object.entries(session.attendance).map(([studentId, rec]) => {
                        const u = state.users.find((x) => x.id === studentId) || { name: studentId };
                        return `
                            <tr>
                                <td>${u.name}</td>
                                <td><span class='tag ${rec.status.toLowerCase()}'>${rec.status}</span></td>
                                <td>${rec.marked_at || "-"}</td>
                                <td>${rec.confidence || "-"}</td>
                            </tr>
                        `;
                    }).join("");
                    detail.innerHTML = `
                        <h3>Session Detail: ${session.subject}</h3>
                        <p class='muted'>${batchName(session.batch_id)} | ${session.created_at}</p>
                        <table>
                            <thead><tr><th>Student</th><th>Status</th><th>Marked At</th><th>Confidence</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    `;
                };
            });
        }

        function renderScreen(key) {
            setBanner("");
            if (key === "overview") return renderOverview();
            if (key === "batches") return renderBatches();
            if (key === "users") return renderUsers();
            if (key === "faceLibrary") return renderFaceLibrary();
            if (key === "allAttendance") return renderAllAttendance();
            if (key === "takeAttendance") return renderTakeAttendance();
            if (key === "classPhoto") return renderClassPhoto();
            if (key === "history") return renderHistory();
            if (key === "monitor") return renderMonitor();
            if (key === "myAttendance") return renderMyAttendance();
        }

        async function showApp() {
            document.getElementById("profileName").textContent = state.me.name;
            document.getElementById("profileRole").textContent = state.me.role;
            loginView.style.display = "none";
            appView.style.display = "grid";
            drawNav();
        }

        async function doLogin() {
            const user = document.getElementById("username").value.trim();
            const pass = document.getElementById("password").value;
            const error = document.getElementById("loginError");
            error.style.display = "none";
            try {
                const resp = await API.call("/api/login", {
                    method: "POST",
                    body: JSON.stringify({ username: user, password: pass }),
                });
                state.token = resp.token;
                state.me = resp.user;
                localStorage.setItem("token", resp.token);
                await bootstrap();
                showApp();
            } catch (err) {
                error.textContent = err.message;
                error.style.display = "block";
            }
        }

        async function doLogout() {
            try {
                await API.call("/api/logout", { method: "POST" });
            } catch (err) {
                // No-op
            }
            state.token = "";
            state.me = null;
            state.users = [];
            state.batches = [];
            state.sessions = [];
            state.activeSessionId = "";
            localStorage.removeItem("token");
            appView.style.display = "none";
            loginView.style.display = "grid";
        }

        document.getElementById("loginBtn").onclick = doLogin;
        document.getElementById("logoutBtn").onclick = doLogout;

        document.getElementById("password").addEventListener("keydown", (e) => {
            if (e.key === "Enter") doLogin();
        });

        async function restoreSession() {
            if (!state.token) return;
            try {
                const me = await API.call("/api/me");
                state.me = me.user;
                await bootstrap();
                showApp();
            } catch (err) {
                localStorage.removeItem("token");
                state.token = "";
            }
        }

        restoreSession();
    
