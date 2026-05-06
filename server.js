import { createServer } from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const BROKER_URL =
    process.env.BROKER_URL ||
    process.env.PACT_BROKER_BASE_URL ||
    "https://api.guildmaster.otterknight.net/";

const CONSUMER_NAME = "Frontend App";
const PUBLIC_DIR = join(APP_DIR, "public");

const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
};

function makeConsumerVersion() {
    return (
        process.env.GIT_SHA ||
        process.env.COMMIT_SHA ||
        `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
    );
}

function json(res, status, body) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.on("data", chunk => {
            body += chunk;
            if (body.length > 2_000_000) {
                reject(new Error("Request body too large"));
            }
        });

        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

function cleanBaseUrl(url) {
    return url.replace(/\/+$/, "");
}

async function publishDirect(pact, providerName, version) {
    const body = {
        pacticipantName: pact.consumer.name,
        pacticipantVersionNumber: version,
        branch: process.env.BRANCH || "main",
        tags: (process.env.TAGS || "")
            .split(",")
            .map(x => x.trim())
            .filter(Boolean),
        buildUrl: process.env.BUILD_URL || undefined,
        contracts: [
            {
                consumerName: pact.consumer.name,
                providerName,
                specification: "pact",
                contentType: "application/json",
                content: Buffer.from(JSON.stringify(pact)).toString("base64")
            }
        ]
    };

    const response = await fetch(`${cleanBaseUrl(BROKER_URL)}/contracts/publish`, {
        method: "POST",
        headers: {
            "content-type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!response.ok) {
        throw Object.assign(new Error(`Broker returned ${response.status}`), {
            status: response.status,
            response: data
        });
    }

    return data;
}

async function publish(req, res) {
    let input;

    try {
        input = JSON.parse((await readBody(req)) || "{}");
    } catch {
        return json(res, 400, {
            ok: false,
            error: "Request body must be valid JSON"
        });
    }

    const { pact, providerName } = input;
    const errors = [];

    if (!providerName || typeof providerName !== "string") {
        errors.push("providerName is required");
    }

    if (!pact || typeof pact !== "object") {
        errors.push("pact is required");
    }

    if (pact?.consumer?.name !== CONSUMER_NAME) {
        errors.push(`pact.consumer.name must be ${CONSUMER_NAME}`);
    }

    if (pact?.provider?.name !== providerName) {
        errors.push("pact.provider.name must match providerName");
    }

    if (!Array.isArray(pact?.interactions) || pact.interactions.length !== 3) {
        errors.push("pact must contain exactly 3 interactions");
    }

    if (errors.length) {
        return json(res, 400, {
            ok: false,
            errors
        });
    }

    const version = makeConsumerVersion();

    try {
        const result = await publishDirect(pact, providerName, version);

        return json(res, 200, {
            ok: true,
            publishedVersion: version,
            brokerUrl: cleanBaseUrl(BROKER_URL),
            result
        });
    } catch (error) {
        console.error("Publish failed:", error);

        return json(res, 500, {
            ok: false,
            error: error.message,
            status: error.status,
            response: error.response,
            brokerUrl: cleanBaseUrl(BROKER_URL)
        });
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

        res.writeHead(200, {
            "content-type": types[extname(filePath)] || "application/octet-stream"
        });

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
            consumerVersion: makeConsumerVersion(),
            brokerUrl: BROKER_URL,
            branch: process.env.BRANCH || "main"
        });
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
        return publish(req, res);
    }

    if (req.method === "GET") {
        return serveStatic(url.pathname, res);
    }

    return json(res, 404, {
        ok: false,
        error: "Not found"
    });
}).listen(PORT, () => {
    console.log(`Contract builder running on http://localhost:${PORT}`);
});