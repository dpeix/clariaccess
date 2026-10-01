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

La CI (`.github/workflows/ci.yml`) exécute les mêmes commandes, plus `pnpm audit`.

## Structure

```
apps/site      Astro (site public, SEO)
apps/app       React + Vite (espace client)
apps/api       Fastify
apps/worker    Worker d'audit (Playwright + axe-core à venir)
packages/db  contracts  rules  ui
```
