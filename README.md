# Pact Contract Website

Small Node + browser app for creating a Pact contract with exactly three interactions:

- successful GET
- failed GET
- successful POST

The browser builds the Pact JSON preview. The backend publishes it to the external Pact Broker.

## Why this version uses the Pact CLI

The upload route now mirrors the command that already worked for you:

```bash
npx pact broker publish pacts \
  --consumer-app-version $VERSION \
  --broker-base-url https://api.guildmaster.otterknight.net/ \
  --branch $BRANCH
```

The backend writes the generated Pact JSON to a temporary `pacts` folder and runs the local Pact CLI from `node_modules/.bin/pact`. The Docker image uses Debian slim instead of Alpine because the Pact CLI package ships platform binaries, and Debian avoids musl/glibc binary issues.

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

The app does not start a local Pact Broker or Postgres database.

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
npm install
BROKER_URL=https://api.guildmaster.otterknight.net/ npm start
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
TAGS=
BUILD_URL=https://ci/builds/1234
PACT_BROKER_USERNAME=
PACT_BROKER_PASSWORD=
PACT_BROKER_TOKEN=
GIT_SHA=
COMMIT_SHA=
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

The backend writes one generated Pact file to `/tmp`, then runs:

```bash
pact broker publish /tmp/generated-pacts \
  --consumer-app-version <generated-version> \
  --broker-base-url <BROKER_URL> \
  --branch <BRANCH>
```

If publishing fails, the UI now shows the Pact CLI stdout and stderr instead of hiding the real error behind a generic 502.
