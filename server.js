import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const BROKER_URL = process.env.BROKER_URL || process.env.PACT_BROKER_BASE_URL || "https://api.guildmaster.otterknight.net";
const CONSUMER_NAME = "Frontend App";
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function consumerVersion() {
  const sha = process.env.GIT_SHA || process.env.COMMIT_SHA;
  if (sha) return sha;
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${crypto.randomBytes(4).toString("hex")}`;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function authHeaders(headers) {
  if (process.env.PACT_BROKER_TOKEN) {
    headers.authorization = `Bearer ${process.env.PACT_BROKER_TOKEN}`;
  } else if (process.env.PACT_BROKER_USERNAME && process.env.PACT_BROKER_PASSWORD) {
    const value = Buffer.from(`${process.env.PACT_BROKER_USERNAME}:${process.env.PACT_BROKER_PASSWORD}`).toString("base64");
    headers.authorization = `Basic ${value}`;
  }
  return headers;
}

function cleanBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function resolveBrokerUrl(href) {
  return new URL(href, `${cleanBaseUrl(BROKER_URL)}/`).toString();
}

async function getPublishUrl() {
  const base = cleanBaseUrl(BROKER_URL);

  try {
    const indexRes = await fetch(`${base}/`, {
      method: "GET",
      headers: authHeaders({ accept: "application/hal+json, application/json" })
    });

    const text = await indexRes.text();
    const data = JSON.parse(text);
    const href = data?._links?.["pb:publish-contracts"]?.href;

    if (href) return resolveBrokerUrl(href);
  } catch {
    // If the index is served as HTML or the relation is not exposed, try the documented path directly.
  }

  return `${base}/contracts/publish`;
}

async function publish(req, res) {
  if (!BROKER_URL) {
    return json(res, 500, { ok: false, error: "BROKER_URL is not set" });
  }

  let input;
  try {
    input = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return json(res, 400, { ok: false, error: "Request body must be valid JSON" });
  }

  const { pact, providerName, consumerVersion } = input;
  const errors = [];

  if (!providerName || typeof providerName !== "string") errors.push("providerName is required");
  if (!consumerVersion || typeof consumerVersion !== "string") errors.push("consumerVersion is required");
  if (!pact || typeof pact !== "object") errors.push("pact is required");
  if (pact?.consumer?.name !== CONSUMER_NAME) errors.push(`pact.consumer.name must be ${CONSUMER_NAME}`);
  if (pact?.provider?.name !== providerName) errors.push("pact.provider.name must match providerName");
  if (!Array.isArray(pact?.interactions) || pact.interactions.length !== 3) errors.push("pact must contain exactly 3 interactions");

  if (errors.length) return json(res, 400, { ok: false, errors });

  const branch = process.env.BRANCH || "main";
  const tags = (process.env.TAGS || branch).split(",").map(x => x.trim()).filter(Boolean);
  const content = Buffer.from(JSON.stringify(pact), "utf8").toString("base64");
  const payload = {
    pacticipantName: CONSUMER_NAME,
    pacticipantVersionNumber: consumerVersion,
    branch,
    tags,
    buildUrl: process.env.BUILD_URL || undefined,
    contracts: [
      {
        consumerName: CONSUMER_NAME,
        providerName,
        specification: "pact",
        contentType: "application/json",
        content
      }
    ]
  };

  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

  try {
    const publishUrl = await getPublishUrl();
    const brokerRes = await fetch(publishUrl, {
      method: "POST",
      headers: authHeaders({ accept: "application/json", "content-type": "application/json" }),
      body: JSON.stringify(payload)
    });

    const text = await brokerRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return json(res, brokerRes.ok ? 200 : brokerRes.status, {
      ok: brokerRes.ok,
      status: brokerRes.status,
      publishedVersion: consumerVersion,
      brokerPublishUrl: publishUrl,
      brokerResponse: data
    });
  } catch (error) {
    return json(res, 502, { ok: false, error: `Could not reach Pact Broker: ${error.message}` });
  }
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/config") {
    return json(res, 200, {
      consumerName: CONSUMER_NAME,
      consumerVersion: consumerVersion(),
      brokerUrl: BROKER_URL,
      branch: process.env.BRANCH || "main"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/publish") return publish(req, res);
  if (req.method === "GET") return serveStatic(url.pathname, res);

  json(res, 404, { ok: false, error: "Not found" });
}).listen(PORT, () => {
  console.log(`Contract builder running on http://localhost:${PORT}`);
});
