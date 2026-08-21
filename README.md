<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [@osdu/open-etp-client](#osduopen-etp-client)
  - [Architecture](#architecture)
  - [Interfaces](#interfaces)
  - [Setup](#setup)
    - [Installation](#installation)
    - [Configuration](#configuration)
  - [Deployment](#deployment)
  - [Contributing](#contributing)
    - [Integrate with your tools](#integrate-with-your-tools)
    - [Collaborate with your team](#collaborate-with-your-team)
    - [Build](#build)
  - [Tests](#tests)
    - [Unit tests](#unit-tests)
    - [Integration tests](#integration-tests)
    - [Bruno API tests](#bruno-api-tests)
    - [Set up a local ETP Server using Docker images](#set-up-a-local-etp-server-using-docker-images)
  - [Code style and validation](#code-style-and-validation)
    - [Linter and prettier](#linter-and-prettier)
    - [Validation](#validation)
  - [Changelog](#changelog)
    - [Create a package](#create-a-package)
    - [Publishing](#publishing)
  - [Partitioning](#partitioning)
  - [Schema Version Support](#schema-version-support)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# @osdu/open-etp-client

REST and GraphQL gateway for [OpenETPServer](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-server). It bridges HTTP/JSON consumers to the binary Avro ETP 1.2 protocol, providing dataspace management, RESQML/WITSML/PRODML object access, data array streaming, OSDU manifest generation, and well search.

```
┌──────────────┐  REST / GraphQL   ┌──────────────────┐  Binary Avro ETP 1.2  ┌────────────────┐
│  Consumers   │ ◀───────────────▶ │  open-etp-client │ ◀──────────────────▶  │ open-etp-server│
│  (apps, CI,  │   HTTP/JSON/GQL   │  (this service)  │   WebSocket frames    │   (C++ binary) │
│   Swagger)   │                   │  NestJS · :8003  │                       │   :9004 → PG   │
└──────────────┘                   └────────┬─────────┘                       └────────────────┘
                                            │ OSDU APIs (optional)
                                   ┌────────▼─────────┐
                                   │  Schema Service   │  Kind version resolution
                                   │  Storage Service  │  Manifest ingestion
                                   │  CRS Service      │  Coordinate transforms
                                   └──────────────────┘
```

## Documentation

| Document | Description |
|----------|-------------|
| [CHANGELOG](./CHANGELOG.M27.md) | Summary of features, new interfaces, and behavioral changes per milestone |
| [REST API Reference](./RestApi.md) | Full endpoint reference with request/response examples and workflow recipes |
| [RESQML → OSDU Guide](./ResqmlOsduGuide.md) | How to populate RESQML metadata for lossless OSDU manifest roundtrips |
| [OpenETPServer README](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-server/-/blob/main/README.md) | C++ ETP server: build, deploy, usage, telemetry, and server-side behavior |
| [RddmsGov](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/rddmsmg/-/blob/main/docs/rddms/RddmsGov.md) | Governance, design principles, dataspace lifecycle, and responsibility model |

## Architecture

The open-etp-client is a **NestJS** application that acts as a protocol bridge:

- **Inbound:** REST API (Swagger UI) + GraphQL endpoint for consumers
- **Outbound:** Binary Avro ETP 1.2 over WebSocket to the C++ OpenETPServer
- **Storage:** OpenETPServer stores XML metadata and HDF5 arrays in PostgreSQL
- **OSDU integration (optional):** Queries Schema Service at startup for kind versions, calls CRS Service for coordinate transforms, and generates OSDU manifests from ETP dataspaces

ETP protocols are **auto-negotiated** at session open — the client registers all protocol handlers and the server responds with which it supports. Unsupported endpoints return 501.

| ETP Protocol | ID | Purpose |
|---|---|---|
| Core | 0 | Session management |
| Discovery | 3 | Resource enumeration, graph traversal |
| Store | 4 | GetDataObjects, PutDataObjects, DeleteDataObjects |
| DataArray | 9 | Array read/write with chunking |
| DiscoveryQuery | 13 | FindResources by URI pattern |
| StoreQuery | 14 | FindDataObjects with content |
| GrowingObject | 6 | Growing object parts (log curves, trajectory stations) |
| ChannelSubscribe | 21 | Real-time channel metadata |
| Transaction | 18 | Start/commit/rollback |
| Dataspace | 24 | Create/delete/lock dataspaces |
| SupportedTypes | 25 | Type enumeration |

## Interfaces

### REST API

Interactive Swagger UI at the configured root path (default: `http://localhost:8003/Reservoir/v2/`). See [RestApi.md](./RestApi.md) for full reference.

| Category | Key endpoints |
|----------|---------------|
| **Dataspaces** | CRUD, clone, lock/unlock |
| **Resources** | List, get, graph traversal (sources/targets) |
| **Data Arrays** | Array metadata, content, upload with chunking |
| **Query** | FindResources, batch graph search, growing object parts, channel metadata |
| **Write** | PutDataObjects, DeleteDataObjects (requires transaction) |
| **Transactions** | Start, commit, rollback |
| **Manifest** | OSDU manifest generation from ETP dataspaces |
| **Wells** | Cross-dataspace well search with hierarchy resolution |
| **WITSML** | Store/query WITSML 2.1 and 1.4.1 XML objects |
| **PWLS** | Curve mnemonic resolution and validation |
| **Health** | Liveness, readiness, server info, converter registry |

### GraphQL API

Available at `/graphql` (with GraphQL Playground in development mode). Provides the same data as the REST API with field-level selection and DataLoader batching for efficient ETP session reuse.

Key query types: `dataspaces`, `resources`, `graph`, `objectContent`, `arrayMetadata`.

### ETP Client Library

The `ResqmlClient` class can be used directly as a TypeScript library for programmatic ETP access. See [src/examples/](./src/examples/) for usage patterns.

## Setup

### Installation

OSDU GitLab does not contain an NPM repository and OSDU has no domain on npmjs.org. The library must be built manually using the process described in the [Build](#build) section.

### Configuration

Copy `config.user.env.sample` to `config.user.env` and set your values. This overrides defaults in `config.default.env`.

Key environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RDMS_ETP_HOST` | `localhost` | ETP server hostname |
| `RDMS_ETP_PORT` | `9004` | ETP server port |
| `RDMS_ETP_PROTOCOL` | `ws` | `ws` or `wss` |
| `RDMS_REST_PORT` | `8003` | REST API listen port |
| `RDMS_REST_ROOT_PATH` | `/Reservoir/v2` | REST API base path |
| `RDMS_DATA_PARTITION_MODE` | `single` | `single` or `multipartition` — see [Partitioning](#partitioning) |
| `RDMS_ETP_SSL_VERIFY` | `true` | Set `false` for self-signed certs |
| `RDMS_OSDU_URL` | — | OSDU platform URL (enables Schema Service, CRS lookups) |
| `OSDU_MILESTONE` | — | Schema milestone (`M26` or `M27`) for manifest kind versions |

## Deployment

### Azure (AKS)

See [devops/azure/README.md](devops/azure/README.md) for Helm chart installation and Azure DevOps pipeline setup.

### Docker Compose (local)

```sh
npm run docker:compose:start    # starts OpenETPServer + PostgreSQL
npm run start                   # starts the REST API locally against the Docker ETP server
```

### CSP deployment notes

- The ETP server and this client are **separate containers** — deploy them independently with a shared network
- OpenETPServer requires a **PostgreSQL** instance (stores XML and HDF5 arrays)
- For OSDU integration, configure `RDMS_OSDU_URL` — the client queries Schema Service at startup and falls back to static kind versions if unavailable
- Health endpoints (`/health/liveness`, `/health/readiness`) are Kubernetes-ready
- SIGTERM triggers graceful shutdown: stops accepting requests, rolls back open ETP transactions, exits within 30s

## Contributing

### Integrate with your tools

- [ ] [Set up project integrations](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-client/-/settings/integrations)

### Collaborate with your team

- [ ] [Invite team members and collaborators](https://docs.gitlab.com/ee/user/project/members/)
- [ ] [Create a new merge request](https://docs.gitlab.com/ee/user/project/merge_requests/creating_merge_requests.html)
- [ ] [Automatically close issues from merge requests](https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#closing-issues-automatically)
- [ ] [Enable merge request approvals](https://docs.gitlab.com/ee/user/project/merge_requests/approvals/)
- [ ] [Automatically merge when pipeline succeeds](https://docs.gitlab.com/ee/user/project/merge_requests/merge_when_pipeline_succeeds.html)

### Build

1. Clone it:

   ```sh
   git clone https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-client.git
   ```

2. Configure

   Copy the `config.user.env.sample` file located at the root of the repository to `config.user.env` file.
   Edit the new file and fill the requested values. Make sure the specified [partition mode](#partitioning) is correct.
   Note: this can be used to override default values located in `config.default.env` file.

3. Install / Build

   You can use the traditional npm commands to build the package:
   `npm install && npm run build`.

But also the custom script: `npm run all`.

This script performs the different steps:

- Dependencies installation
- Git hooks installation
- Build
- Validation (linter, prettier and tests)

## Tests

### Unit tests

```sh
npm run test                              # all unit tests (parallel, with coverage)
npm run test pattern1 pattern2            # subset by pattern
npm run test:single pattern1              # sequential, no coverage (debugging)
```

### Integration tests

Require a running ETP server:

```sh
npm run test:integration                  # TestClient + TestProtocols + TestWitsmlQuery
```

### Bruno API tests

The `bruno/` folder contains a full [Bruno](https://www.usebruno.com/) collection for manual and CI testing of the REST API. Environments are provided for Local, Azure, and CI.

Typical workflow:

1. Run the `_Setup/` folder requests in order (create dataspace, seed data)
2. Run individual endpoint tests (Resources, Arrays, Query, Wells, WITSML, etc.)
3. Run `_Cleanup/` to delete the test dataspace

Bruno tests can also be run headless via the Bruno CLI:

```sh
npx bru run bruno/ --env Local
```

### Set up a local ETP Server using Docker images

Uses the Docker images produced on GitLab — a Linux server closer to real deployment.

[See image](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-server/container_registry)

Once the server is set up, run (or copy-paste to terminal):

1. `npm run docker:login` only once to access the ACR
2. `npm run docker:update` to update to the latest version (download, install)
3. `npm run docker:compose:start` to run the servers:
   - OpenETPServer is available on `localhost:9004`

## Code style and validation

### Linter and prettier

The source code is analyzed (see _.eslintrc.json_ file for configuration) with [eslint](https://eslint.org) and formatted with [prettier](https://prettier.io/).

The CI relies on those to validate code. Each tool can be run separately:

```sh
npm run lint
npm run prettier
```

Or with the validate script mentioned below.

For developers, these tools can be used to automatically fix the code:

```sh
npm run lint:fix
npm run prettier:write
```

Those checks are performed inside the provided git `pre-commit` hook using `lint-staged`.

### Validation

A custom script allows you to run in parallel linter, prettier, and tests:

```sh
npm run validate
```

Developers can also run the all-in-one fix variant, which will run both eslint and prettier in auto-fix mode as described above.

```sh
npm run validate:fix
```

## Changelog

Recently Updated? Please read the changelog.

### Create a package

You can create a package with your changes for testing it in an application:

- Create a package

  After running the build, you can run `npm pack`.

  You will now have a `osdu-open-etp-client-x.x.x.tgz` archive in the root folder, which can be installed.

- Install it locally in a client code

  ```sh
  npm i /path/to/osdu-open-etp-client/osdu-open-etp-client-x.x.x.tgz
  ```

### Publishing

To publish a new version of the library, please follow these instructions:

1. Update package version in `package.json` and update `package-lock.json` with `npm i`
2. Update the changelog (`CHANGELOG.md` file)
3. Create a PR with message "Bump version to v[new\_version]" (for example: "Bump
   version to v0.4.2")
4. Send the PR => the new version will be automatically published when the PR will be approved and completed

## Partitioning

There are two modes of how the ETP client handles partitions. They are the same as [those of the ETP server](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-server/-/blob/main/README.md#partition-modes).

In the **single-partition mode**, the ETP Client deals with a specific partition and does not transmit it to the server.

The **multi-partition mode** allows you to work with several partitions. The ETP Client expects the data partition specified in the `data-partition-id` header in REST requests and transmits the value to the server.

Specify the partition mode in the [config](config.default.env#L34) before building.

## Schema Version Support

The manifest builder emits OSDU schema kinds whose versions are resolved at startup:

1. **Schema Service query** — on boot, `initSchemaVersions()` queries the OSDU Schema Service for the latest published kind versions (M27+).
2. **Static fallback** — if the Schema Service is unavailable (401, timeout, or no `RDMS_OSDU_URL`), a built-in `FALLBACK_KINDS` map provides M27 versions (e.g., `WellLog:1.3.0`, `Well:1.2.0`).

No configuration is required — the service adapts automatically to whatever versions the target platform supports.

## Extended ETP Protocol Support

The following ETP protocols are **auto-negotiated** during session establishment:

| Protocol | ID | REST endpoints |
|---|---|---|
| DiscoveryQuery | 13 | `POST /query/resources/find` |
| StoreQuery | 14 | (used internally) |
| GrowingObject | 6 | `POST /query/growing/metadata`, `POST /query/growing/range` |
| ChannelSubscribe | 21 | `POST /query/channels/metadata` |

The client always requests all protocols. The ETP server responds with which ones it supports (`OpenSession.supportedProtocols`). If an endpoint is called but the server did not negotiate that protocol, the REST API returns **501 Not Implemented** with a descriptive message.

No environment variable is needed to enable or disable these protocols.
