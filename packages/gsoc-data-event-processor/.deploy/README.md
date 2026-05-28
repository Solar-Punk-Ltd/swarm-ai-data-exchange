# gsoc-data-event-processor — Deployment

This deploy script hardly rely on a SolarPunk owned development server with docker and bee nodes running on it but it can be a useful starting point for anyone who want to play around with this solution.

Deploys the GSOC subscriber to a remote host as a Docker container in `network_mode: host`. The process is a pure subscriber — it does not expose an HTTP port; observe it via container logs.

## Files

- `Dockerfile` — multi-stage build (Node 22 alpine, pnpm). Installs `typescript` + `@types/node` in the builder stage since neither is declared in the package's own `devDependencies` (both live in the workspace root). Bakes `.env.dev` into the image as `.env`.
- `docker-compose.yml` — single-instance compose. Uses `network_mode: host` and labels the container `app=gsoc-data-event-processor` so sibling compose stacks don't prune it as an orphan.
- `deploy.sh` — rsync + remote `docker compose`.

The build uses `tsconfig.docker.json` (in the package root, not here) instead of the regular `tsconfig.json` — the regular one extends the repo-root `tsconfig.base.json`, which isn't reachable from the Docker build context.

## Prerequisites

- SSH access to the target host (defaults to the SSH alias `dev`).
- Docker + `docker compose` plugin installed on the remote host.
- A populated `.env.dev` in the **package root** — see `../.env.example` for the variable list. Not committed.

## Deploy

From the package root:

```bash
./.deploy/deploy.sh
```

Overrides (optional):

```bash
REMOTE_HOST=my-host REMOTE_DIR=path/on/remote ./.deploy/deploy.sh
```

What it does:

1. `rsync -az --delete` the package to `~/$REMOTE_DIR` on the remote (excludes `node_modules`, `dist`, `.env`, lockfiles, etc.).
2. `docker compose down` the existing stack. Note: no `--remove-orphans` — the label on the container prevents accidental removal by other stacks, and we avoid it here for symmetry.
3. `docker compose up -d --build` the new stack.

## Observe

```bash
ssh dev 'cd ~/swarm-ai-data-exchange/gsoc-data-event-processor/.deploy && docker compose logs -f'
ssh dev 'cd ~/swarm-ai-data-exchange/gsoc-data-event-processor/.deploy && docker compose ps'
ssh dev 'docker ps --filter label=app=gsoc-data-event-processor'
```

A healthy subscriber prints `[gsoc] subscribed …` once on boot, then `[gsoc] received …` for each inbound message.

## Notes

- The image bakes the env file in at build time via the `ENV_FILE` build-arg. Changing `GSOC_BEE_URL`, `GSOC_RESOURCE_ID`, or `GSOC_TOPIC` requires a rebuild.
- `network_mode: host` means the container reaches the Bee node on `GSOC_BEE_URL` directly over the host's network. If pointing at a local Bee (e.g. `http://localhost:1633`), that must be the Bee node on the **remote** host, not the developer's laptop.
