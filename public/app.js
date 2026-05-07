const requests = [
  {
    key: "successGet",
    title: "Successful GET",
    method: "GET",
    description: "a request for a resource",
    given: "a resource exists",
    endpoint: "/resources/1",
    headers: '{\n  "Accept": ["application/json"]\n}',
    code: 200,
    response: '{\n  "id": 1,\n  "name": "Example"\n}'
  },
  {
    key: "failedGet",
    title: "Failed GET",
    method: "GET",
    description: "a request for a missing resource",
    given: "no resource exists",
    endpoint: "/resources/999",
    headers: '{\n  "Accept": ["application/json"]\n}',
    code: 404,
    response: ''
  },
  {
    key: "successPost",
    title: "Successful POST",
    method: "POST",
    description: "a request to create a resource",
    given: "the resource can be created",
    endpoint: "/resources",
    headers: '{\n  "Content-Type": ["application/json"],\n  "Accept": ["application/json"]\n}',
    requestBody: '{\n  "name": "Created example"\n}',
    code: 201,
    response: ''
  }
];

const el = id => document.getElementById(id);
let config = {};

function requestHtml(request) {
    return `
    <section class="request">
      <h3>${request.title} <small>(${request.method})</small></h3>
      <label>
        Description
        <input id="${request.key}-description" value="${request.description}">
      </label>
      <label class="fieldGap">
        Given
        <input id="${request.key}-given" value="${request.given}">
      </label>
      <div class="grid2 fieldGap">
        <label>
          Endpoint
          <input id="${request.key}-endpoint" value="${request.endpoint}">
        </label>
        <label>
          Response code
          <input id="${request.key}-code" type="number" value="${request.code}">
        </label>
      </div>
      <label class="fieldGap">
        Headers
        <textarea id="${request.key}-headers">${request.headers}</textarea>
      </label>
      ${request.method === "POST" ? `
      <label class="fieldGap">
        Request body
        <textarea id="${request.key}-requestBody">${request.requestBody || ""}</textarea>
      </label>` : ""}
      <label class="fieldGap">
        Response
        <textarea id="${request.key}-response">${request.response}</textarea>
      </label>
    </section>`;
}

function parseJson(raw, fallback, label, errors) {
    const value = raw.trim();
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        errors.push(`${label}: ${error.message}`);
        return fallback;
    }
}

function buildMatchingRules(value, path, rules) {
    if (Array.isArray(value)) {
        rules[path] = { combine: "AND", matchers: [{ match: "type", min: 1 }] };
        const template = value[0];
        if (template !== undefined && typeof template === "object" && template !== null) {
            buildMatchingRules(template, `${path}[*]`, rules);
        }
    } else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
            const childPath = `${path}.${key}`;
            if (Array.isArray(child) || (child !== null && typeof child === "object")) {
                buildMatchingRules(child, childPath, rules);
            } else {
                rules[childPath] = { combine: "AND", matchers: [{ match: "type" }] };
            }
        }
    }
}

function buildResponseBody(responseBody) {
    if (responseBody === null || responseBody === undefined) {
        return { bodyEnvelope: undefined, matchingRules: null };
    }
    const bodyEnvelope = { content: responseBody, contentType: "application/json", encoded: false };
    const bodyRules = {};
    buildMatchingRules(responseBody, "$", bodyRules);
    const matchingRules = Object.keys(bodyRules).length > 0 ? { body: bodyRules } : null;
    return { bodyEnvelope, matchingRules };
}

function buildPact() {
    const errors = [];
    const providerName = el("providerName").value.trim();
    if (!providerName) errors.push("Provider name is required");

    const interactions = requests.map(request => {
        const description = el(`${request.key}-description`).value.trim();
        const given = el(`${request.key}-given`).value.trim();
        const path = el(`${request.key}-endpoint`).value.trim();
        const status = Number(el(`${request.key}-code`).value);

        const headers = parseJson(el(`${request.key}-headers`).value, {}, `${request.title} headers`, errors);

        const requestBody = request.method === "POST"
            ? parseJson(el(`${request.key}-requestBody`).value, null, `${request.title} request body`, errors)
            : null;

        const rawResponse = el(`${request.key}-response`).value.trim();
        const responseBody = rawResponse
            ? parseJson(rawResponse, null, `${request.title} response`, errors)
            : null;

        if (!description) errors.push(`${request.title}: description is required`);
        if (!given) errors.push(`${request.title}: given is required`);
        if (!path.startsWith("/")) errors.push(`${request.title}: endpoint must start with /`);
        if (!Number.isInteger(status)) errors.push(`${request.title}: response code must be an integer`);

        const pactRequest = { method: request.method, path, headers };
        if (requestBody !== null) {
            pactRequest.body = { content: requestBody, contentType: "application/json", encoded: false };
        }

        const { bodyEnvelope, matchingRules } = buildResponseBody(responseBody);
        const response = { status };
        if (bodyEnvelope !== undefined) response.body = bodyEnvelope;
        if (matchingRules) response.matchingRules = matchingRules;
        if (Object.keys(headers).length > 0 && responseBody !== null) {
            response.headers = { "Content-Type": ["application/json"] };
        }

        return {
            description,
            pending: false,
            providerStates: [{ name: given }],
            request: pactRequest,
            response,
            type: "Synchronous/HTTP"
        };
    });

    return {
        errors,
        providerName,
        pact: {
            consumer: { name: config.consumerName || "" },
            provider: { name: providerName },
            interactions,
            metadata: {
                pactRust: { ffi: "0.5.3", models: "1.3.9" },
                pactSpecification: { version: "4.0" }
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Syntax-highlighted JSON renderer with matchingRules awareness
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe HTML insertion.
 */
function escHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Converts a parsed JS value back to a pretty-printed HTML string where:
 *   - String values          → .jv-string  (teal)
 *   - Number / bool / null   → .jv-literal (purple)
 *   - Object keys            → .jv-key     (blue)
 *   - "matchingRules" key    → .jv-key.jv-rules-key (highlighted)
 *   - The entire value block of a "matchingRules" entry → .jv-rules-block (green tint)
 *   - An interaction whose response has a body but NO matchingRules
 *     gets a .jv-missing-rules warning banner injected just before closing }
 */
function renderJson(value, indent = 0) {
    const pad = "  ".repeat(indent);
    const pad1 = "  ".repeat(indent + 1);

    if (value === null) return `<span class="jv-literal">null</span>`;
    if (typeof value === "boolean") return `<span class="jv-literal">${value}</span>`;
    if (typeof value === "number") return `<span class="jv-literal">${value}</span>`;
    if (typeof value === "string") return `<span class="jv-string">"${escHtml(value)}"</span>`;

    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const items = value.map(v => `${pad1}${renderJson(v, indent + 1)}`).join(",\n");
        return `[\n${items}\n${pad}]`;
    }

    // Plain object
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";

    const lines = keys.map(key => {
        const isRulesKey = key === "matchingRules";
        const keyHtml = isRulesKey
            ? `<span class="jv-key jv-rules-key">"${escHtml(key)}"</span>`
            : `<span class="jv-key">"${escHtml(key)}"</span>`;

        const renderedVal = renderJson(value[key], indent + 1);
        const valHtml = isRulesKey
            ? `<span class="jv-rules-block">${renderedVal}</span>`
            : renderedVal;

        return `${pad1}${keyHtml}: ${valHtml}`;
    });

    // Inject a warning if this object looks like an interaction response that
    // has a body but is missing matchingRules.
    let warning = "";
    if ("status" in value && "body" in value && !("matchingRules" in value)) {
        warning = `\n${pad1}<span class="jv-missing-rules">⚠ matchingRules missing — body will be matched by exact value</span>`;
    }

    return `{\n${lines.join(",\n")}${warning}\n${pad}}`;
}

function renderPreview(pact) {
    el("preview").innerHTML = renderJson(pact);
}

// ---------------------------------------------------------------------------

function updatePreview() {
    const { errors, pact } = buildPact();

    renderPreview(pact);

    el("uploadBtn").disabled = errors.length > 0;

    el("validationState").textContent = errors.length ? `${errors.length} issue(s)` : "Valid";
    el("validationState").className = errors.length ? "error" : "ok";

    if (errors.length) {
        el("uploadResult").textContent = errors.join("\n");
        el("uploadResult").className = "result error";
    } else if (el("uploadResult").className.includes("error")) {
        el("uploadResult").textContent = "";
        el("uploadResult").className = "result";
    }
}

async function loadConfig() {
    const res = await fetch("/api/config");
    config = await res.json();
    el("consumerName").value = config.consumerName || "";
    el("consumerVersion").value = config.consumerVersion || "";
    el("brokerUrl").value = config.brokerUrl || "BROKER_URL is not set";
}

async function upload() {
    const { errors, pact, providerName } = buildPact();
    if (errors.length) return updatePreview();

    el("uploadBtn").disabled = true;
    el("uploadResult").className = "result";
    el("uploadResult").textContent = "Uploading...";

    try {
        const res = await fetch("/api/publish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pact, providerName })
        });

        const data = await res.json();
        el("uploadResult").className = res.ok ? "result ok" : "result error";
        el("uploadResult").textContent = JSON.stringify(data, null, 2);

        if (res.ok) await loadConfig();
    } catch (error) {
        el("uploadResult").className = "result error";
        el("uploadResult").textContent = error.message;
    }

    updatePreview();
}

async function start() {
    await loadConfig();

    el("requests").innerHTML = requests.map(requestHtml).join("");

    document
        .querySelectorAll("input, textarea")
        .forEach(input => input.addEventListener("input", updatePreview));

    el("uploadBtn").addEventListener("click", upload);

    updatePreview();
}

start();