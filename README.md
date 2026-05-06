# Pact Contract Website

Small Node + browser app for creating a Pact contract with exactly three interactions:

- successful GET
- failed GET
- successful POST

The browser builds the Pact JSON preview. The backend publishes it to the external Pact Broker.

## Files

```txt
pact-contract-website/
  server.js
  package.json
  Dockerfile
  docker-compose.yml
  .env.example
  public/
    index.html
    styles.css
    app.js
```

## Broker

The app no longer starts a local Pact Broker or Postgres database.

By default, Docker Compose points the app at:

```txt
https://api.guildmaster.otterknight.net/
```

The backend reads the broker URL from:

```txt
BROKER_URL
```

## Run with Docker Compose

```bash
docker compose up --build
```

Open the app:

```txt
http://localhost:3000
```

## Run without Docker

You need Node 20 or newer.

```bash
BROKER_URL=https://api.guildmaster.otterknight.net/ node server.js
```

Then open:

```txt
http://localhost:3000
```

## Configuration

Copy `.env.example` to `.env` if you want to override values locally.

```txt
BROKER_URL=https://api.guildmaster.otterknight.net/
BRANCH=main
TAGS=main
BUILD_URL=https://ci/builds/1234
PACT_BROKER_USERNAME=...
PACT_BROKER_PASSWORD=...
PACT_BROKER_TOKEN=...
GIT_SHA=...
COMMIT_SHA=...
```

Consumer name is hard coded in `server.js`:

```js
const CONSUMER_NAME = "Frontend App";
```

Change that constant if the real consumer pacticipant should have another name.

Consumer version is generated automatically. If `GIT_SHA` or `COMMIT_SHA` exists, the app uses that. Otherwise it uses a timestamp plus random suffix.

## Upload behavior

When you click upload, the browser calls the app backend:

```txt
POST /api/publish
```

The backend then publishes to the Pact Broker. It first tries to read the broker index and use the `pb:publish-contracts` link. If that relation is not available to the client, it falls back to:

```txt
POST ${BROKER_URL}/contracts/publish
```

The backend sends this shape:

```json
{
  "pacticipantName": "Frontend App",
  "pacticipantVersionNumber": "generated-version",
  "branch": "main",
  "tags": ["main"],
  "contracts": [
    {
      "consumerName": "Frontend App",
      "providerName": "Provider API",
      "specification": "pact",
      "contentType": "application/json",
      "content": "base64 encoded pact json"
    }
  ]
}
```
