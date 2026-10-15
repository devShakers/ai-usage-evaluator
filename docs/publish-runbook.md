# Publish runbook — `shakers-cli` (npm)

> **Publicación automática en CI.** Desde `ci/prod-channel`, cada tag estable
> `v<X.Y.Z>` que semantic-release crea al mergear a `release` publica `shakers-cli`
> en npmjs (`publish:npm:prod`) junto al `.mcpb` prod, en paralelo con el canal
> staging (`shakers-cli-beta`). Los jobs prod solo existen si la variable CI/CD
> `PROD_ALMA_BASE` está definida, y `preflight:prod` aborta si `src/config.js` no
> mapea `shakers-cli` al perfil `prod`. El sabor se deriva del nombre del paquete
> (`PACKAGE_NAME_ENV`), sin flag en runtime. Ver `.gitlab-ci.yml`.
>
> Lo de abajo es la checklist para una publicación manual de emergencia y para el
> smoke test posterior; el camino normal no requiere ningún paso a mano.

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
NPM_PACKAGE_NAME=shakers-cli BETA_VERSION=<X.Y.Z> node scripts/prepare-beta.js
npm publish --tag latest --access public
git checkout -- package.json
```

The stamp is required: the checkout's `package.json` is `@shakers/shakers-cli`,
which bakes the `dev` backend.

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

The version comes from the tag: semantic-release computes it from the
conventional commits on `release` (`.releaserc.yml`) and CI stamps it into
`package.json` (`scripts/prepare-beta.js`). Do not run `npm version` or tag by hand;
merge `develop` -> `release` through an MR.

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
