import { createServer } from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const PORT = process.env.PORT || 3000;
const BROKER_URL = (process.env.BROKER_URL || "https://api.guildmaster.otterknight.net/").replace(/\/+$/, "");
const CONSUMER_NAME = "Frontend App";
const PUBLIC_DIR = "public";

const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript"
};

const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
};

const version = () =>
    process.env.GIT_SHA ||
    process.env.COMMIT_SHA ||
    crypto.randomBytes(4).toString("hex").slice(0, 7)

const body = req =>
    new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => (data += chunk));
        req.on("end", () => resolve(JSON.parse(data || "{}")));
        req.on("error", reject);
    });

async function publish(req, res) {
    try {
        const { pact, providerName } = await body(req);

        if (!providerName) throw new Error("providerName is required");
        if (pact?.consumer?.name !== CONSUMER_NAME) throw new Error(`consumer must be ${CONSUMER_NAME}`);
        if (pact?.provider?.name !== providerName) throw new Error("providerName must match pact.provider.name");
        if (pact?.interactions?.length !== 3) throw new Error("pact must contain exactly 3 interactions");

        const consumerVersion = version();

        const payload = {
            pacticipantName: CONSUMER_NAME,
            pacticipantVersionNumber: consumerVersion,
            branch: process.env.BRANCH || "main",
            contracts: [{
                consumerName: CONSUMER_NAME,
                providerName,
                specification: "pact",
                contentType: "application/json",
                content: Buffer.from(JSON.stringify(pact)).toString("base64")
            }]
        };

        const brokerRes = await fetch(`${BROKER_URL}/contracts/publish`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });

        const result = await brokerRes.json();

        if (!brokerRes.ok) {
            return send(res, 500, { ok: false, status: brokerRes.status, result });
        }

        send(res, 200, { ok: true, publishedVersion: consumerVersion, result });
    } catch (error) {
        send(res, 400, { ok: false, error: error.message });
    }
}

async function serveStatic(path, res) {
    const file = path === "/" ? "index.html" : path.slice(1);

    try {
        const data = await readFile(join(PUBLIC_DIR, file));
        res.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain" });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end("Not found");
    }
}

createServer((req, res) => {
    const path = new URL(req.url, `http://${req.headers.host}`).pathname;

    if (req.method === "GET" && path === "/api/config") {
        return send(res, 200, {
            consumerName: CONSUMER_NAME,
            consumerVersion: version(),
            brokerUrl: BROKER_URL,
            branch: process.env.BRANCH || "main"
        });
    }

    if (req.method === "POST" && path === "/api/publish") {
        return publish(req, res);
    }

    if (req.method === "GET") {
        return serveStatic(path, res);
    }

    send(res, 404, { ok: false, error: "Not found" });
}).listen(PORT, () => {
    console.log(`Running on http://localhost:${PORT}`);
});