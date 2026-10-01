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

## Base de données et contrats

| Commande                                          | Rôle                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm --filter @accessibility/db db:generate`     | Génère la migration SQL après un changement de `packages/db/src/schema.ts`   |
| `pnpm --filter @accessibility/db db:migrate`      | Applique les migrations et alimente la table `rules` (`DATABASE_URL`)        |
| `pnpm --filter @accessibility/contracts generate` | Régénère `openapi.json` et `src/generated/api.d.ts` (vérifiés par les tests) |

Les tests de `packages/db` ont besoin de PostgreSQL (`docker compose up -d --wait`) : ils créent une base jetable par fichier de test, sans toucher à la base de développement. Sans `DATABASE_URL` ils sont ignorés en local et échouent en CI.

Les tests de `apps/api` et `packages/queue` qui ont besoin de PostgreSQL sont ignorés sans `DATABASE_URL` ; `API_INTEGRATION=1` / `QUEUE_INTEGRATION=1` (positionnés par la CI) font échouer leur absence. L'API se lance avec `pnpm --filter @accessibility/api dev` (ou `start`) : `POST /audits/free`, `GET /audits/:id`, `GET /audits/:id/report`, `POST /leads` (contrat dans `packages/contracts/openapi.json`). Les emails de rapport partent par SMTP ; en local, Mailpit (`docker compose up -d --wait`) les capture sur http://127.0.0.1:8025. Lancer aussi le worker, sinon les audits restent en attente.

Les tests de `apps/worker` qui ont besoin de PostgreSQL ou de Chromium sont ignorés s'ils sont absents (`pnpm --filter @accessibility/worker exec playwright install chromium` pour le navigateur). Avec `WORKER_INTEGRATION=1`, leur absence fait échouer les tests : c'est le cas du job `worker` de la CI. Le worker se lance avec `pnpm --filter @accessibility/worker dev` (ou `start`) ; il consomme les jobs `run-audit` créés dans pg-boss et ne scanne que des URL publiques autorisées par robots.txt.

La CI (`.github/workflows/ci.yml`) exécute les mêmes commandes, plus `pnpm audit`.

## Structure

```
apps/site      Astro (site public, SEO)
apps/app       React + Vite (espace client)
apps/api       Fastify
apps/worker    Worker d'audit (pg-boss, Playwright + axe-core)
packages/db  contracts  rules  ui
```
