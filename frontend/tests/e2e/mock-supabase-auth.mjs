import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.MOCK_SUPABASE_PORT || 54321);
const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const JWT_PAYLOAD = Buffer.from(
  JSON.stringify({
    sub: "test-user-001",
    email: "engineer@mixit.studio",
    role: "authenticated",
    exp: 4070908800,
  })
).toString("base64url");
const VALID_TOKEN = `${JWT_HEADER}.${JWT_PAYLOAD}.mock_signature`;

const MOCK_USER = {
  id: "test-user-001",
  aud: "authenticated",
  role: "authenticated",
  email: "engineer@mixit.studio",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { display_name: "Studio Engineer" },
  created_at: "2026-01-01T00:00:00Z",
};

function createDefaultProfile() {
  return {
    id: MOCK_USER.id,
    display_name: "Studio Engineer",
    default_genre: "electronic",
    default_stage: "unmastered_mix",
    preferred_daw: "Mixit Web DAW",
    default_theme: "dark",
    allow_metrics_ai: false,
    allow_audio_ai: false,
    allow_dataset_retention: false,
    updated_at: new Date().toISOString(),
  };
}

let profileRow = createDefaultProfile();
let analysesRows = [];
let dawProjectRows = [];
const storageObjects = new Map();

function resetState() {
  profileRow = createDefaultProfile();
  analysesRows = [];
  dawProjectRows = [];
  storageObjects.clear();
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "http://127.0.0.1:3000";
  const requestedHeaders =
    req.headers["access-control-request-headers"] ||
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, x-retry-count, accept, x-upsert";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "content-range");
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  for (const [k, v] of Object.entries(extraHeaders)) {
    res.setHeader(k, v);
  }
  res.end(JSON.stringify(payload));
}

function readBodyBuffer(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function wantsSingleObject(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/vnd.pgrst.object+json");
}

function parseEqFilter(url, key) {
  const raw = url.searchParams.get(key);
  if (!raw) return null;
  if (raw.startsWith("eq.")) return raw.slice(3);
  return raw;
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const authHeader = String(req.headers.authorization || "");
  const isAuthed = authHeader === `Bearer ${VALID_TOKEN}`;

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/test/reset" && req.method === "POST") {
    resetState();
    sendJson(res, 200, { reset: true });
    return;
  }

  // Auth routes
  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    const raw = (await readBodyBuffer(req)).toString("utf8");
    try {
      const parsed = JSON.parse(raw || "{}");
      if (parsed.grant_type === "refresh_token" || parsed.email) {
        sendJson(res, 200, {
          access_token: VALID_TOKEN,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "mock-refresh-token-001",
          user: {
            ...MOCK_USER,
            email: parsed.email || MOCK_USER.email,
          },
        });
        return;
      }
    } catch {
      // fall through
    }
    sendJson(res, 400, { error: "invalid_grant", error_description: "Invalid credentials" });
    return;
  }

  if (url.pathname === "/auth/v1/user" && req.method === "GET") {
    if (!isAuthed) {
      sendJson(res, 401, { message: "JWT missing or invalid", status: 401 });
      return;
    }
    sendJson(res, 200, MOCK_USER);
    return;
  }

  if (url.pathname === "/auth/v1/logout" && req.method === "POST") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // REST: profiles
  if (url.pathname.startsWith("/rest/v1/profiles")) {
    if (req.method === "GET") {
      sendJson(res, 200, wantsSingleObject(req) ? profileRow : [profileRow]);
      return;
    }
    if (req.method === "POST" || req.method === "PATCH") {
      const raw = (await readBodyBuffer(req)).toString("utf8");
      try {
        const body = JSON.parse(raw || "{}");
        const patch = Array.isArray(body) ? body[0] : body;
        profileRow = { ...profileRow, ...patch, updated_at: new Date().toISOString() };
      } catch {
        // ignore malformed json
      }
      sendJson(res, 200, wantsSingleObject(req) ? profileRow : [profileRow]);
      return;
    }
  }

  // REST: analyses
  if (url.pathname.startsWith("/rest/v1/analyses")) {
    const idFilter = parseEqFilter(url, "id");
    const userFilter = parseEqFilter(url, "user_id");

    if (req.method === "HEAD") {
      let rows = [...analysesRows];
      if (userFilter) rows = rows.filter((r) => r.user_id === userFilter);
      if (idFilter) rows = rows.filter((r) => r.id === idFilter);
      res.statusCode = 200;
      res.setHeader("Content-Range", `0-${Math.max(0, rows.length - 1)}/${rows.length}`);
      res.end();
      return;
    }

    if (req.method === "GET") {
      let rows = [...analysesRows];
      if (userFilter) rows = rows.filter((r) => r.user_id === userFilter);
      if (idFilter) rows = rows.filter((r) => r.id === idFilter);
      rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      if (wantsSingleObject(req)) {
        if (!rows[0]) {
          sendJson(res, 406, { message: "Row not found" });
          return;
        }
        sendJson(res, 200, rows[0]);
        return;
      }
      sendJson(res, 200, rows, {
        "Content-Range": `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
      });
      return;
    }

    if (req.method === "POST") {
      const raw = (await readBodyBuffer(req)).toString("utf8");
      const body = JSON.parse(raw || "{}");
      const incoming = Array.isArray(body) ? body[0] : body;
      const existingIdx = incoming.id
        ? analysesRows.findIndex((r) => r.id === incoming.id)
        : -1;
      const now = new Date().toISOString();
      const row = {
        id: incoming.id || crypto.randomUUID(),
        user_id: incoming.user_id || MOCK_USER.id,
        track_name: incoming.track_name || "Untitled Mix",
        genre: incoming.genre || "electronic",
        stage: incoming.stage || "unmastered_mix",
        artist_vision: incoming.artist_vision ?? null,
        version_label: incoming.version_label || "v1",
        parent_analysis_id: incoming.parent_analysis_id ?? null,
        proxy_storage_path: incoming.proxy_storage_path ?? null,
        share_token: incoming.share_token ?? null,
        is_public: Boolean(incoming.is_public),
        checklist_progress: incoming.checklist_progress ?? {},
        report_json: incoming.report_json,
        created_at: existingIdx >= 0 ? analysesRows[existingIdx].created_at : now,
      };
      if (existingIdx >= 0) {
        analysesRows[existingIdx] = { ...analysesRows[existingIdx], ...row };
      } else {
        analysesRows.unshift(row);
      }
      sendJson(res, 201, wantsSingleObject(req) ? row : [row]);
      return;
    }

    if (req.method === "PATCH") {
      const raw = (await readBodyBuffer(req)).toString("utf8");
      const patch = JSON.parse(raw || "{}");
      const updated = [];
      analysesRows = analysesRows.map((row) => {
        if ((idFilter && row.id !== idFilter) || (userFilter && row.user_id !== userFilter)) {
          return row;
        }
        const next = { ...row, ...patch };
        updated.push(next);
        return next;
      });
      sendJson(res, 200, wantsSingleObject(req) ? updated[0] ?? {} : updated);
      return;
    }

    if (req.method === "DELETE") {
      analysesRows = analysesRows.filter((row) => {
        if (idFilter && row.id === idFilter) return false;
        if (!idFilter && userFilter && row.user_id === userFilter) return false;
        return true;
      });
      sendJson(res, 200, []);
      return;
    }
  }

  // REST: daw_projects
  if (url.pathname.startsWith("/rest/v1/daw_projects")) {
    const idFilter = parseEqFilter(url, "id");
    const userFilter = parseEqFilter(url, "user_id");

    if (req.method === "HEAD") {
      const rows = userFilter
        ? dawProjectRows.filter((r) => r.user_id === userFilter)
        : dawProjectRows;
      res.statusCode = 200;
      res.setHeader("Content-Range", `0-${Math.max(0, rows.length - 1)}/${rows.length}`);
      res.end();
      return;
    }

    if (req.method === "GET") {
      let rows = [...dawProjectRows];
      if (userFilter) rows = rows.filter((r) => r.user_id === userFilter);
      if (idFilter) rows = rows.filter((r) => r.id === idFilter);
      rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      if (wantsSingleObject(req)) {
        if (!rows[0]) {
          sendJson(res, 406, { message: "Not found" });
          return;
        }
        sendJson(res, 200, rows[0]);
        return;
      }
      sendJson(res, 200, rows, {
        "Content-Range": `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
      });
      return;
    }

    if (req.method === "POST") {
      const raw = (await readBodyBuffer(req)).toString("utf8");
      const body = JSON.parse(raw || "{}");
      const incoming = Array.isArray(body) ? body[0] : body;
      const now = new Date().toISOString();
      const row = {
        id: incoming.id || crypto.randomUUID(),
        user_id: incoming.user_id || MOCK_USER.id,
        name: incoming.name || "Untitled Project",
        project_state: incoming.project_state ?? incoming.state ?? {},
        created_at: now,
        updated_at: incoming.updated_at || now,
      };
      const idx = dawProjectRows.findIndex((r) => r.id === row.id);
      if (idx >= 0) {
        dawProjectRows[idx] = { ...dawProjectRows[idx], ...row };
      } else {
        dawProjectRows.unshift(row);
      }
      sendJson(res, 201, wantsSingleObject(req) ? row : [row]);
      return;
    }

    if (req.method === "DELETE") {
      dawProjectRows = dawProjectRows.filter((row) => {
        if (idFilter && row.id === idFilter) return false;
        if (!idFilter && userFilter && row.user_id === userFilter) return false;
        return true;
      });
      sendJson(res, 200, []);
      return;
    }
  }

  // Storage: createSignedUrl
  if (url.pathname.startsWith("/storage/v1/object/sign/mix-proxies/") && req.method === "POST") {
    const objectPath = decodeURIComponent(
      url.pathname.slice("/storage/v1/object/sign/mix-proxies/".length)
    );
    sendJson(res, 200, {
      signedURL: `/object/public/mix-proxies/${encodeURI(objectPath)}?token=mock-signed`,
    });
    return;
  }

  // Storage: download signed/public object
  if (
    (url.pathname.startsWith("/storage/v1/object/public/mix-proxies/") ||
      url.pathname.startsWith("/storage/v1/object/authenticated/mix-proxies/")) &&
    req.method === "GET"
  ) {
    const prefix = url.pathname.includes("/public/mix-proxies/")
      ? "/storage/v1/object/public/mix-proxies/"
      : "/storage/v1/object/authenticated/mix-proxies/";
    const objectPath = decodeURIComponent(url.pathname.slice(prefix.length));
    const stored = storageObjects.get(objectPath);
    if (!stored) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", stored.contentType || "audio/wav");
    res.end(stored.buffer);
    return;
  }

  // Storage: upload object (extracts multipart file body if uploaded via FormData)
  if (
    url.pathname.startsWith("/storage/v1/object/mix-proxies/") &&
    (req.method === "POST" || req.method === "PUT")
  ) {
    const objectPath = decodeURIComponent(
      url.pathname.slice("/storage/v1/object/mix-proxies/".length)
    );
    const rawBuffer = await readBodyBuffer(req);
    const ct = String(req.headers["content-type"] || "audio/wav");
    let finalBuffer = rawBuffer;
    let finalContentType = ct;

    const boundaryMatch = ct.match(/boundary=([^\s;]+)/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1].replace(/^"|"$/g, "");
      const headerSep = Buffer.from("\r\n\r\n");
      const firstSep = rawBuffer.indexOf(headerSep);
      const closingBoundary = Buffer.from(`\r\n--${boundary}`);
      if (firstSep !== -1) {
        const bodyStart = firstSep + 4;
        const bodyEnd = rawBuffer.indexOf(closingBoundary, bodyStart);
        if (bodyEnd > bodyStart) {
          const partHeaders = rawBuffer.subarray(0, firstSep).toString("utf8");
          const partCt = partHeaders.match(/content-type:\s*([^\r\n]+)/i);
          if (partCt) finalContentType = partCt[1].trim();
          finalBuffer = rawBuffer.subarray(bodyStart, bodyEnd);
        }
      }
    }

    storageObjects.set(objectPath, {
      buffer: finalBuffer,
      contentType: finalContentType,
    });
    sendJson(res, 200, { Key: `mix-proxies/${objectPath}`, Id: objectPath });
    return;
  }

  // Storage: remove objects
  if (url.pathname === "/storage/v1/object/mix-proxies" && req.method === "DELETE") {
    const raw = (await readBodyBuffer(req)).toString("utf8");
    try {
      const body = JSON.parse(raw || "{}");
      for (const prefix of body.prefixes || []) {
        storageObjects.delete(prefix);
      }
    } catch {
      // ignore
    }
    sendJson(res, 200, []);
    return;
  }

  sendJson(res, 200, {});
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Supabase Auth & REST listening on http://127.0.0.1:${PORT}`);
});
