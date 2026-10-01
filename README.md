# Accessibility

Plateforme d'audit d'accessibilité (EAA / RGAA). Voir [plan.md](plan.md) pour la feuille de route et [AGENTS.md](AGENTS.md) pour les règles de travail.

## Prérequis

- Node 24 (`.nvmrc`)
- pnpm 11 (`corepack enable` puis la version de `packageManager` est utilisée)
- Docker (PostgreSQL local)

## Démarrage

```sh
pnpm install
cp .env.example .env        # puis adapter les valeurs
docker compose up -d --wait # PostgreSQL sur 127.0.0.1:5432
```

## Commandes de validation

| Commande            | Rôle                                              |
| ------------------- | ------------------------------------------------- |
| `pnpm lint`         | ESLint (+ jsx-a11y sur `apps/app`, `packages/ui`) |
| `pnpm format:check` | Prettier (`pnpm format` pour corriger)            |
| `pnpm typecheck`    | `tsc` / `astro check` via Turborepo               |
| `pnpm test`         | Vitest via Turborepo                              |
| `pnpm build`        | Build de chaque app via Turborepo                 |

La CI (`.github/workflows/ci.yml`) exécute les mêmes commandes, plus `pnpm audit`.

## Structure

```
apps/site      Astro (site public, SEO)
apps/app       React + Vite (espace client)
apps/api       Fastify
apps/worker    Worker d'audit (Playwright + axe-core à venir)
packages/db  contracts  rules  ui
```
