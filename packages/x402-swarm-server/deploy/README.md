# x402-swarm-server — Deployment

This deploy script hardly rely on a SolarPunk owned development server with docker and bee nodes running on it but it can be a useful starting point for anyone who want to play around with this solution.

It deploys the `x402-swarm-server` package to a remote host as a Docker container in `network_mode: host`.

## Files

- `Dockerfile` — multi-stage build (Node 22 alpine, pnpm). Bakes the chosen env file into the image as `.env`.
- `docker-compose.yml` — single-instance compose.
- `docker-compose.multi.yml` — parameterised compose for N instances (uses `INSTANCE_NUM`).
- `deploy.sh` — rsync + remote `docker compose` for a single instance.
- `deploy-multi.sh` — same flow for multiple instances in one pass.

## Prerequisites

- SSH access to the target host (defaults to the SSH alias `dev`).
- Docker + `docker compose` plugin installed on the remote host.
- A populated `.env.dev` (single) or `.env.dev1`, `.env.dev2`, … (multi) in the **package root** — see `../.env.example` for the variable list. These files are **not** committed.

## Single instance

From the package root:

```bash
./deploy/deploy.sh
```

Overrides (optional):

```bash
REMOTE_HOST=my-host REMOTE_DIR=path/on/remote ./deploy/deploy.sh
```

What it does:

1. `rsync -az --delete` the package to `~/$REMOTE_DIR` on the remote (excludes `node_modules`, `dist`, `.env`, lockfiles, etc.).
2. `docker compose down --remove-orphans` the existing stack.
3. `docker compose up -d --build` the new stack.

Logs / status:

```bash
ssh dev 'cd ~/swarm-ai-data-exchange/x402-swarm-server/deploy && docker compose logs -f'
ssh dev 'cd ~/swarm-ai-data-exchange/x402-swarm-server/deploy && docker compose ps'
```

## Multi instance

Each instance needs its own `.env.devN` file in the package root with distinct values (notably a distinct `PORT` since the container runs on the host network).

```bash
./deploy/deploy-multi.sh
```

Defaults to instances `1 2 3`. Override:

```bash
INSTANCES="2 3" ./deploy/deploy-multi.sh
```

Each instance becomes its own compose project (`x402-swarm-server-N`) with container name `x402-swarm-server-N`, labelled `app=x402-swarm-server instance=N`.

Logs / status:

```bash
ssh dev 'docker ps --filter label=app=x402-swarm-server'
ssh dev 'cd ~/swarm-ai-data-exchange/x402-swarm-server/deploy && INSTANCE_NUM=1 docker compose -f docker-compose.multi.yml logs -f'
```

## Notes

- The image bakes the env file in at build time via the `ENV_FILE` build-arg. Changing env values requires a rebuild.
- `network_mode: host` means the server binds directly to the host port from `PORT`. Ensure ports don't collide across instances.
- The `app=x402-swarm-server` label is what prevents sibling compose stacks (e.g. the GSOC processor) from removing these containers as "orphans".
