# Contributing

This repository tracks the upstream
[Open ETP Client](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-client)
and carries the SPI packaging and production hardening used by the Azure-native OSDU
deployment.

> [!IMPORTANT]
> Code contributions are limited to Microsoft employees at this time. Anyone can report
> a bug or request a feature through [GitHub Issues](../../issues).

## Where a change belongs

This tree has three owners; [`.github/CODEOWNERS`](.github/CODEOWNERS) maps the paths.

| Area | Owner | Where to make the change |
|---|---|---|
| `.spi/`, `spi/`, `.github/upstream-filter.yml`, `.github/CODEOWNERS`, `CONTRIBUTING.md`, `README.md` | This repository | A pull request here. |
| `.github/` (except the files above), `build/`, `.release-please-config.json` | [`Azure/osdu-spi`](https://github.com/Azure/osdu-spi) | The template. Template sync overwrites these files here. |
| Everything else (shared service code) | OSDU community | Upstream in [OSDU GitLab](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-client). Contribute changes upstream when possible. SPI-required hardening must explain why it remains fork-local and how upstream sync conflicts will be handled. |

## Making a change

1. Branch from `main` with a type prefix: `feat/…`, `fix/…`, `chore/…`.
2. Use the Node version declared in `.spi/service.yaml`, then run `npm ci`,
   `npm run lint`, `npm run build`, and `npm run test-coverage`, as CI does.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and the pull request title; release-please versions from them.
4. Open a pull request against `main`. Merging needs passing CodeQL and validation checks, every review thread resolved, and a code owner's approval.

## Pull request descriptions

Lead with why the change is needed, then explain what changed. Add notes only for
choices or limitations a reviewer would otherwise stop and question. Do not repeat CI
results as a validation checklist.

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE).
