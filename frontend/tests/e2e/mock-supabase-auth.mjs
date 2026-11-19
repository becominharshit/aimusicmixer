import http from "node:http";

const PORT = Number(process.env.MOCK_SUPABASE_PORT || 54321);
const VALID_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMDAxIiwiZW1haWwiOiJlbmdpbmVlckBtaXhiZW5jaC5zdHVkaW8iLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6NDA3MDkwODgwMH0.mock_signature";
const MOCK_USER = {
  id: "test-user-001",
  aud: "authenticated",
  role: "authenticated",
  email: "engineer@mixbench.studio",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "http://127.0.0.1:3000";
  const requestedHeaders =
    req.headers["access-control-request-headers"] ||
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, x-retry-count";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
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

  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
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
    });
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

  if (url.pathname.startsWith("/rest/v1/profiles")) {
    if (req.method === "GET") {
      sendJson(res, 200, {
        id: MOCK_USER.id,
        email: MOCK_USER.email,
        allow_metrics_ai: false,
        allow_audio_ai: false,
        allow_dataset_retention: false,
      });
      return;
    }
    sendJson(res, 200, []);
    return;
  }

  if (url.pathname.startsWith("/rest/v1/analyses")) {
    sendJson(res, 200, []);
    return;
  }

  sendJson(res, 200, {});
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Supabase Auth listening on http://127.0.0.1:${PORT}`);
});
