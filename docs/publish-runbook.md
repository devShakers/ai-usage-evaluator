# Publish runbook — `shakers-cli` (npm)

> **PUBLICACIÓN DIFERIDA (2026-08-25).** El paquete es **local-only** por ahora y
> NO se publica a ningún registro (ni público ni privado): `package.json` lleva
> `"private": true`. Motivos: (1) no hay backend público por defecto — un
> `npx shakers-cli ai-usage` externo sin config deja las features conectadas
> (persist/login/certify) inertes; (2) la licencia está pendiente de revisión por
> legal. Este runbook se conserva como referencia para cuando se decida publicar:
> habrá que quitar `"private": true`, restaurar `publishConfig` y resolver ambos
> bloqueos antes de ejecutar nada de lo de abajo.

> HUMAN ACTION ONLY. Every step below is executed by a person on their own
> machine, never by an agent or in CI without explicit sign-off. Nothing here
> runs automatically. The packaging is already prepared and verified on
> `feat/talents-ai-score`; this file is the checklist to actually publish.

## Naming (fixed decision)

- **npm package name:** `shakers-cli` (the bare `shakers` name is taken on the
  public registry by an unrelated package).
- **Installed binary:** `shakers` — what the user types once installed
  (`shakers ai-usage`, `shakers certify`, …).
- **Bootstrap without installing:** `npx shakers-cli ai-usage`.

## Pre-flight (verify before publishing)

1. Be on a clean tree at the intended commit (the packaging change on
   `feat/talents-ai-score`, or after it is merged — decide where you publish
   from; publishing from a feature branch is fine but tag it).
2. Confirm the target registry is the PUBLIC one. `package.json` pins it via
   `publishConfig.registry = https://registry.npmjs.org/`, so an ambient
   `~/.npmrc` that adds the private `git.shakers.tools` registry for the
   `@shakers` scope does NOT affect this unscoped package. Sanity check:
   ```sh
   npm config get registry            # expect https://registry.npmjs.org/
   npm pack --dry-run                 # re-list tarball, confirm no test/docs/install.sh/mockups
   ```
3. Confirm you are logged into an npm account authorized to publish
   `shakers-cli`:
   ```sh
   npm login                          # or: npm whoami  (if already logged in)
   npm whoami
   ```
4. **First publish only — name ownership.** `shakers-cli` must be either unclaimed
   or owned by your account/org. Check:
   ```sh
   npm view shakers-cli               # 404 => name is free, good to claim on first publish
   ```
   If it exists and you are not an owner/maintainer, STOP — resolve ownership
   before publishing (do not force another name without the owner's OK; the name
   was a fixed decision).

## Publish

```sh
npm publish --access public
```

`--access public` is redundant with `publishConfig.access` but is kept explicit
as a guard (matters if this ever becomes scoped). This is the irreversible step:
a published version cannot be re-published, only superseded or (within 72h)
unpublished. Do not run it until the pre-flight passes.

## Post-publish smoke test

From a throwaway directory, with no local checkout:

```sh
npx shakers-cli@latest ai-usage --help     # exit 0, prints usage
npx shakers-cli@latest                      # exit 0, prints top-level help
```

Optionally install globally and confirm the short binary name resolves:

```sh
npm i -g shakers-cli
which shakers && shakers ai-usage --help    # binary is `shakers`, not `shakers-cli`
npm rm -g shakers-cli                        # cleanup
```

## Version bumps (subsequent releases)

`version` starts at `0.1.0`. Each release needs a new version (npm rejects a
re-publish of an existing version). Use semver:

```sh
npm version patch      # 0.1.0 -> 0.1.1  (fixes)
npm version minor      # 0.1.0 -> 0.2.0  (backward-compatible features)
npm version major      # 0.x   -> 1.0.0  (breaking; still pre-1.0 so minor may break)
npm publish --access public
```

`npm version` creates a git tag and commit — do it via an MR into `develop`, then an MR `develop` -> `release`; the tag `v<version>` goes on `release`, never
on `develop`/`release` directly (repo branch policy).

## Open decisions to resolve before first publish

- **`repository` / `homepage` / `bugs` fields are intentionally omitted** to avoid
  publishing the internal GitLab host (`git.shakers.tools`) on a public registry
  page. If a public source or docs URL exists, add it; otherwise leave omitted.
- **`README.md` ships publicly (~60 kB).** It currently references the internal
  host `git.shakers.tools/...` (around line 825). Scrub or replace internal-only
  links before the first publish, or the tarball leaks internal infra. This is a
  content edit left for you to approve.
- **License is `UNLICENSED` (proprietary, all-rights-reserved).** Publishing
  proprietary source to the public npm registry is a deliberate distribution
  choice consistent with the existing LICENSE ("public access ... solely to allow
  the Software to be run"). Validate with a human expert (legal) that public npm
  distribution is intended before the first publish.
