const requests = [
  {
    key: "successGet",
    title: "Successful GET",
    method: "GET",
    description: "a request for a resource",
    given: "a resource exists",
    endpoint: "/resources/1",
    headers: '{\n  "Accept": ["application/json"]\n}',
    requestBody: "",
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
    requestBody: "",
    code: 404,
    response: '{\n  "error": "Not found"\n}'
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
    response: '{\n  "id": 2,\n  "name": "Created example"\n}'
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

      <label class="fieldGap">
        Request body
        <textarea id="${request.key}-requestBody">${request.requestBody || ""}</textarea>
      </label>

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

function buildPact() {
    const errors = [];
    const providerName = el("providerName").value.trim();

    if (!providerName) {
        errors.push("Provider name is required");
    }

    const interactions = requests.map(request => {
        const description = el(`${request.key}-description`).value.trim();
        const given = el(`${request.key}-given`).value.trim();
        const path = el(`${request.key}-endpoint`).value.trim();
        const status = Number(el(`${request.key}-code`).value);

        const headers = parseJson(
            el(`${request.key}-headers`).value,
            {},
            `${request.title} headers`,
            errors
        );

        const requestBody = parseJson(
            el(`${request.key}-requestBody`).value,
            null,
            `${request.title} request body`,
            errors
        );

        const responseBody = parseJson(
            el(`${request.key}-response`).value,
            {},
            `${request.title} response`,
            errors
        );

        if (!description) {
            errors.push(`${request.title}: description is required`);
        }

        if (!given) {
            errors.push(`${request.title}: given is required`);
        }

        if (!path.startsWith("/")) {
            errors.push(`${request.title}: endpoint must start with /`);
        }

        if (!Number.isInteger(status)) {
            errors.push(`${request.title}: response code must be an integer`);
        }

        const pactRequest = {
            method: request.method,
            path,
            headers
        };

        if (requestBody) {
            pactRequest.body = requestBody;
        }

        return {
            description,
            providerStates: [
                { name: given }
            ],
            request: pactRequest,
            response: {
                status,
                body: responseBody
            }
        };
    });

    return {
        errors,
        providerName,
        pact: {
            consumer: {
                name: config.consumerName || ""
            },
            provider: {
                name: providerName
            },
            interactions,
            metadata: {
                pactSpecification: {
                    version: "3.0.0"
                }
            }
        }
    };
}

function updatePreview() {
    const { errors, pact } = buildPact();

    el("preview").textContent = JSON.stringify(pact, null, 2);

    el("uploadBtn").disabled = errors.length > 0;

    el("validationState").textContent =
        errors.length
            ? `${errors.length} issue(s)`
            : "Valid";

    el("validationState").className =
        errors.length
            ? "error"
            : "ok";

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

    if (errors.length) {
        return updatePreview();
    }

    el("uploadBtn").disabled = true;
    el("uploadResult").className = "result";
    el("uploadResult").textContent = "Uploading...";

    try {
        const res = await fetch("/api/publish", {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify({
                pact,
                providerName
            })
        });

        const data = await res.json();

        el("uploadResult").className =
            res.ok
                ? "result ok"
                : "result error";

        el("uploadResult").textContent =
            JSON.stringify(data, null, 2);

        if (res.ok) {
            await loadConfig();
        }
    } catch (error) {
        el("uploadResult").className = "result error";
        el("uploadResult").textContent = error.message;
    }

    updatePreview();
}

async function start() {
    await loadConfig();

    el("requests").innerHTML =
        requests.map(requestHtml).join("");

    document
        .querySelectorAll("input, textarea")
        .forEach(input =>
            input.addEventListener("input", updatePreview)
        );

    el("uploadBtn")
        .addEventListener("click", upload);

    updatePreview();
}

start();