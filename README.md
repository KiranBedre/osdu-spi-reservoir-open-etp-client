<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [@osdu/open-etp-client](#osduopen-etp-client)
  - [Setup](#setup)
    - [Installation](#installation)
  - [Contributing](#contributing)
    - [Integrate with your tools](#integrate-with-your-tools)
    - [Collaborate with your team](#collaborate-with-your-team)
    - [Build](#build)
  - [Tests](#tests)
    - [Set up a local ETP Server using Docker images](#set-up-a-local-etp-server-using-docker-images)
  - [Code style and validation](#code-style-and-validation)
    - [Linter and prettier](#linter-and-prettier)
    - [Validation](#validation)
  - [Changelog](#changelog)
    - [Create a package](#create-a-package)
    - [Publishing](#publishing)
  - [Usage](#usage)
    - [XML JSON Utils](#xml-json-utils)
    - [Rest API](#rest-api)
    - [Examples](#examples)
  - [Partitioning](#partitioning)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# @osdu/open-etp-client

This library is a client for connecting to ETP servers, serving RESQML data. It provides one main `ResqmlClient` class, which allows to easily perform the main tasks expected from a RESQML ETP client.
This client is able to get data from a server and send data to it. The exchanges try to optimize the size of messages as negotiated between client and server.
The data can be obtained as XML string or Javascript objects.
Most classes functions return promises, allowing to easily chain requests.

## Documentation

| Document | Description |
|----------|-------------|
| [CHANGELOG](./CHANGELOG.M27.md) | All changes vsgit config credential.helper store latest release open-etp-client |
| [REST API Reference](./RestApi.md) | Developer guide for the REST API with workflow recipes and ETP protocol context |
| [RESQML → OSDU Guide](./ResqmlOsduGuide.md) | How to populate RESQML metadata for lossless OSDU manifest roundtrips |
| [OpenETPServer README](./README.openetpserver.md) | C++ ETP server: build, deploy, usage, telemetry, and server-side behavior |
| [RddmsGov](../rddmsmg/docs/rddms/RddmsGov.md) | Governance, design principles, dataspace lifecycle, and responsibility model |

## Setup

### Installation

OSDU gitlab does not contain a NPM repository and OSDU has no domain inside NPM.org repository. Until either of this solution is available, the library has to be built manually, using the process described below in the [Build](#build) section.

[Here](devops/azure/README.md) are the instructions to deploy on Azure.

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

To run all unit tests:

```sh
npm run test
```

You can specify patterns to run a subset of the tests:

```sh
npm run test pattern1 pattern2 ...
```

Run tests sequentially and disable coverage:

```sh
npm run test:single pattern1 pattern2 ...
```

### Set up a local ETP Server using Docker images

This is a more native way to run the REST server using the Docker images we produce on GitLab. It is a Linux server, and installation and updates are faster and closer to the real deployment.

[See image](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-server/container_registry)

Once the server is set up, run (or copy-paste to terminal):

1. `npm run docker:login` only once to access the ACR
2. `npm run docker:update` to update to the latest version (download, install)
3. `npm run docker:compose:start` to run the servers:
   - eml etp12 (aka OpenEtpServer) is available on `localhost:9004`

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

Developers can also run the all-in-one fix variant, which will run both tslint and prettier in auto-fix mode as described above.

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

## Usage

- `openSession()` and `closeSession()` connect/disconnect to the server and create a new session.

In order to discover and get data from a server the following methods are available:

- `getDataspaces()` to get the list of projects/dataspace available
- `getDataspaceTypes()` to get the list of types available in a project
- `getDataObjects()` to get data objects directly from the messages, it will typically contains the row server message with XML string content.
- `getObjects()` to get the object resulting from XML translation into javascript, data object references and data array are not resolved
- `getResolvedObjects()` get the full objects resulting from the XML translation into Javascript, where data object references and data array are resolved and replaced. This may result in very large objects.

ETP protocol handlers are available for advanced queries:

- `discovery` / `discoveryQuery` — FindResources (Protocol 3/13)
- `growingObject` — GetPartsMetadata, GetPartsByRange (Protocol 6)
- `channelSubscribe` — GetChannelMetadata (Protocol 21)

It is also possible to create and delete projects using:

- `createProjects()`
- `deleteProjects()`

It is possible to send objects as XML strings using:

- `putDataObjects()`

Several methods are available to get/send arrays, array metadata and subarrays with:

- `getDataArray()` will try to find the best strategy to download an array according to its size
- `putDataArray()` will try to find the best strategy to send an array according to its size

When an array is too large to fit in memory, the method visitDataArrayValues can be used to visit the values of an array extracted from its subarrays. (see example_statistics)

`startTransaction()`, `commitTransaction()` and `rollbackTransaction()` are available to manage transaction in order to send data in a consistent state.

This is especially important when sending data to a server.

`subscribeNotifications()` and `unSubscribeNotifications()` allow to be notified of changes in the server.

### XML JSON Utils

As part of the conversion from XML to typescript, there is also some capabilities to perform analysis on typescript types with implementation for RESQML schema based types. The two main capabilities are:

- Check that a given typescript object is conforming to a RESQML interface built from the initial XSD schemas
- [Creation](./src/examples/createGQLSchema.ts) of GraphQL schemas from typescript interface.

The class `ResqmlTypeUtils` amd `WitsmlTypeUtils` implement the RESQML and WITSML type tools, and simply encapsulates the loading of resqml interfaces are. It is also possible to redefine the base class `InterfaceTypeUtils` and pre-load other files.

### Rest API

A [REST server](./src/lib/restApi/RestServer.ts) exposes a REST API using an ETP server as backend, with interactive documentation via Swagger UI at the configured root path (e.g., `http://localhost:8080/api/reservoir-ddms/v2/`).

**Endpoint categories:**

| Tag | Description |
|-----|-------------|
| **Resources** | Dataspace CRUD, object discovery, graph traversal, data arrays |
| **Query & Growing Objects** | Deep search (Discovery/Store protocols), growing object range queries, channel metadata |
| **Wells** | Cross-dataspace well search with hierarchy resolution (wellbores, logs, trajectories) |
| **WITSML** | WITSML XML query and object listing from dataspaces |
| **Write** | PutDataObjects, DeleteDataObjects, array upload via ETP Store protocol |
| **Transactions** | ETP transaction lifecycle (start, commit, rollback) |
| **Manifest** | OSDU manifest generation from ETP dataspaces (`POST /manifests/build`) |
| **Authentication** | Token info and session management |
| **Health** | Liveness, readiness, converter registry, PWLS status |
| **PWLS** | PWLS unit/curve catalog lookups (resolve, validate, catalog) |

The REST API can also be used to create the manifest information corresponding to entities stored in the RDMS using (/manifests/build). It will use the information accessible through storage and coordinate system APIs, to resolve references and provide mapping information.

### Examples

Full examples for both graph and direct request chain are available under [src/examples/](./src/examples/):

- [Example1](./src/examples/Example1.ts) shows how to get the resource graph or getting the resources individually
- [ExampleObject](./src/examples/ExampleObject.ts) shows the different options to get and check individual RESQML objects
- [Statistics](./src/examples/ExampleStatistics.ts) shows how to compute the statistics of data arrays when working with large projects

## Partitioning

There are two modes of how the ETP client handles partitions. They are the same as [those of the ETP server](../open-etp-server/README.md#partition-modes).

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
