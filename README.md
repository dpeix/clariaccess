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

Le site public (`apps/site`, Astro) se lance avec `pnpm --filter @accessibility/site dev`. Il lit `PUBLIC_SITE_URL` et `PUBLIC_API_URL` (voir `.env.example`) : `PUBLIC_SITE_URL` doit être l'origine autorisée par le CORS de l'API, `PUBLIC_API_URL` l'adresse de l'API. Le site est statique ; la page `/audit/?id=<id>` (lien du rapport envoyé par email) lit l'identifiant dans l'URL et interroge l'API depuis le navigateur. Ses tests construisent le site dans un dossier temporaire puis vérifient le HTML produit (SEO, liens, poids) ; les tests dans Chromium (axe, parcours avec API simulée) sont ignorés sans navigateur (`pnpm --filter @accessibility/site exec playwright install chromium`) et font échouer la CI avec `SITE_INTEGRATION=1`. Les informations légales (raison sociale, SIREN, hébergeur, contacts) sont à renseigner dans `apps/site/src/legal.ts` : tant que des valeurs « À COMPLÉTER » subsistent, un build avec `SITE_ENV=production` échoue volontairement.

## Espace client (`apps/app`) et comptes

Connexion par lien magique : `POST /auth/login` envoie un email (Mailpit en local, http://127.0.0.1:8025) avec un lien `APP_URL/auth/callback?token=…`, valable 15 minutes et à usage unique ; l'app l'échange contre un cookie de session (`HttpOnly`, `SameSite=Lax`, `Secure` en production). Seul l'hôte `APP_URL` peut utiliser l'API connectée (CORS avec cookies + contrôle de l'en-tête `Origin`).

Parcours : créer une organisation, ajouter un site, **prouver qu'on le contrôle** (enregistrement DNS TXT `_clariaccess.<hôte>` ou fichier `/.well-known/clariaccess-<jeton>.txt`, vérifié par le worker avec la garde anti-SSRF), lancer un audit multi-pages (liens du DOM rendu + `sitemap.xml`, même origine, robots.txt respecté, plafonds `CRAWL_MAX_PAGES` / `CRAWL_MAX_DURATION_MS`), suivre l'historique et les problèmes dans le temps (ouvert, corrigé, régression, ignoré). Un seul audit actif par site, `SITE_DAILY_AUDIT_LIMIT` par jour.

```sh
pnpm --filter @accessibility/api dev      # API (http://localhost:3000)
pnpm --filter @accessibility/worker dev   # worker : sans lui, rien n'est vérifié ni audité
pnpm --filter @accessibility/app dev      # espace client (http://localhost:5173)
```

L'app est une SPA : l'hébergeur doit renvoyer `index.html` pour les chemins inconnus (`/auth/callback`, `/sites/…`). `VITE_API_URL` est lu à la compilation. En local, le worker refuse les adresses privées (anti-SSRF) : un site sur `localhost` ne peut pas être vérifié ni audité ; les tests utilisent des serveurs fixtures avec une garde ouverte. Les tests de l'app construisent le bundle dans un dossier temporaire puis pilotent Chromium contre une API simulée (axe sur chaque écran) ; ils sont ignorés sans navigateur et échouent en CI avec `APP_INTEGRATION=1`.

## Formules, re-scans et plan de correction

Deux formules, définies dans le code (`packages/contracts/src/plans.ts`, un seul endroit à modifier, sans migration) : **Gratuit** (1 site, 10 pages par audit, 2 audits manuels par jour et par site, aucun re-scan) et **Pro** (10 sites, 100 pages, re-scans hebdomadaires ou quotidiens, alertes). Les plafonds de déploiement (`SITE_DAILY_AUDIT_LIMIT`, `CRAWL_MAX_PAGES`) restent des maxima techniques au-dessus des formules.

**Il n'y a pas encore de paiement** : le passage à Pro n'est pas en vente dans l'app. Aujourd'hui, une organisation change de formule par un script d'administration (`pnpm --filter @accessibility/api set-plan <organisation-id> pro`), qui passe par `setOrganizationPlan` (`apps/api/src/billing/set-plan.ts`) ; un futur moyen de paiement appellera la même fonction. Reste à faire pour vendre Pro : choix du prestataire, page d'achat, réception idempotente de ses événements, gestion des échecs de paiement et des résiliations.

- **Re-scans** : sur un site vérifié d'une organisation Pro, `PUT /sites/:id/schedule` programme un audit chaque semaine ou chaque jour. Le worker lance un tick toutes les `SCAN_TICK_CRON` (5 min par défaut, UTC) : le retard maximal d'un re-scan est cet intervalle. Une rétrogradation suspend les re-scans sans effacer la programmation ; un retour à Pro les reprend. Le worker doit tourner.
- **Alertes** : à la fin d'un re-scan, un email part à chaque membre de l'organisation uniquement s'il y a une régression (problème corrigé revenu) ou un nouveau problème sérieux ou critique ; rien sinon, et rien pour le premier audit d'un site. Pas de désinscription individuelle pour l'instant.
- **Plan de correction** : une tâche par règle et par site, classée par priorité (somme de celle des problèmes ouverts), avec une fiche « comment corriger » (`packages/rules/src/remediation.ts`, textes à relire) ; statut à faire / en cours / terminé et assignation à un membre. Une tâche passe à terminé toute seule quand ses problèmes sont corrigés ou ignorés, et repasse à faire s'ils reviennent.

## Audit manuel et déclaration d'accessibilité

Le score d'un audit automatisé ne vaut pas conformité : l'automatique ne peut que **révéler des problèmes**, jamais valider un critère. L'espace client permet donc de vérifier à la main chacun des **106 critères du RGAA 4.1** (`/sites/<id>/audit-manuel` : conforme / non conforme / non applicable, notes, lien de preuve), puis de préparer la **déclaration d'accessibilité** (`/sites/<id>/declaration`).

- **Référentiel** : `packages/rules/src/rgaa-criteria.generated.ts`, importé du dépôt officiel de la DINUM (`DISIC/RGAA`, v4.1, Licence Ouverte 2.0), épinglé à un commit et à l'empreinte SHA-256 du fichier. `pnpm --filter @accessibility/rules import-rgaa` le régénère et refuse tout fichier qui ne compte pas 13 thématiques et 106 critères. Ne pas le modifier à la main.
- **Niveau proposé** (`packages/rules/src/compliance.ts`) : tant qu'un critère applicable n'est pas vérifié, **aucun niveau n'est proposé** et la publication est impossible. Un critère est conforme seulement s'il a été vérifié par une personne et que le scan n'y relève aucun problème ; un problème détecté (ouvert, régressé ou ignoré) le rend non conforme, même marqué conforme à la main. Le taux est arrondi à l'entier inférieur.
- **Publication** : réservée aux propriétaires de l'organisation ; elle exige les mentions obligatoires (éditeur, contact, pages vérifiées, technologies, environnement de test, outils) ; on peut déclarer un niveau plus prudent que celui que l'audit permet d'affirmer, jamais plus favorable. Une publication fige l'état de chaque critère : la page ne change plus quand l'audit évolue, et publier une nouvelle version remplace la précédente (qui reste consultable, signalée comme remplacée).
- **Page publique** : `GET /d/<identifiant>` sur l'API, HTML sans script ni ressource externe (CSP stricte), `GET /d/<identifiant>/pdf` pour le PDF. Le client place un lien vers cette adresse sur son site. Le PDF est produit par le worker (Chromium sans JavaScript ni réseau) et stocké en base ; tant qu'il n'est pas prêt, l'adresse répond 404 avec `Retry-After` et redemande la génération.
- **Textes** : tous derrière des clés (`packages/contracts/src/i18n.ts`), seul le français est livré. Le gabarit ne cite pas d'article de loi : la référence juridique applicable dépend de l'éditeur et **les textes sont à faire relire**. L'outil ne remplace pas un audit réalisé par un auditeur qualifié.

La CI (`.github/workflows/ci.yml`) exécute les mêmes commandes, plus `pnpm audit`.

## Structure

```
apps/site      Astro (site public, SEO)
apps/app       React + Vite (espace client)
apps/api       Fastify
apps/worker    Worker d'audit (pg-boss, Playwright + axe-core)
packages/db  contracts  rules  ui
```
