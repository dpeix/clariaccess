# Plan de réalisation — Plateforme d'audit d'accessibilité (EAA / RGAA)

## Contexte
Audit automatisé gratuit (acquisition) → abonnement (surveillance continue, déclaration d'accessibilité, plan de correction priorisé) → prestations de correction. Dépôt vide (seul AGENTS.md). Acquisition par SEO + prospection directe ; code écrit par agents IA ; solo ; France puis UE ; stack choisie pour durer plusieurs années.

Règles de travail : AGENTS.md (vérifier avant de supposer, plus petit changement correct, tests d'abord, rapport final Modification / Tests / Impacts / Incertitudes).

## 1. Décisions d'architecture

**Le projet exige** : un cœur asynchrone (crawl + navigateur + axe-core), un backend indépendant et durable, du SEO uniquement sur un site public statique, et des évolutions probables (API publique, CI, plugin CMS, LLM, white-label, multilingue).

| Sujet | Choix | Justification / alternatives écartées |
|---|---|---|
| Langage | **TypeScript (Node)** | axe-core et Playwright sont natifs JS ; un seul langage ; types partagés. Python écarté (pas de besoin ML central), Rails/Django écartés (couplent front/back, mal adaptés au worker navigateur). |
| API | **Fastify + Zod → OpenAPI**, modules par domaine | Léger, validé à l'entrée, client typé généré. NestJS écarté (surcoût pour un solo). |
| Worker | Processus Node séparé, **Playwright + axe-core**, conteneur dédié | Isolation (navigateur gourmand, pages hostiles), scalable. |
| Jobs | **pg-boss** derrière une interface `JobQueue` | Pas d'infra en plus en v1 ; remplaçable (BullMQ/Temporal) si besoin réel. |
| BDD | **PostgreSQL** + migrations SQL versionnées + **Drizzle** (ou Kysely) | Relationnel + JSONB. |
| Site public | **Astro** (MDX, statique, îlots) | SEO, performance, indépendant du backend. |
| App authentifiée | **React + Vite (SPA)** + TanStack Router/Query, client API généré | Pas de SEO requis, front découplé. |
| UI | Radix + Tailwind, `packages/ui` | Accessibilité native (le produit doit être lui-même conforme). |
| Auth | Sessions cookie côté API (Better Auth ou équivalent TS), domaines `www.` `app.` `api.` | Pas de lock-in front. |
| Paiement | Stripe Billing + webhooks idempotents | |
| Stockage / PDF | S3-compatible UE ; PDF via Playwright | |
| i18n | FR d'abord, clés prêtes pour l'UE | |
| Hébergement | Site : CDN statique ; API + worker : conteneurs UE via Docker | RGPD, pas de lock-in. |

**Monorepo (pnpm workspaces + Turborepo)** plutôt que dépôts séparés : contrat API, règles et schéma BDD partagés ; PR atomiques ; un seul AGENTS.md / CI / lint ; déploiement indépendant par app ; réversible (une app peut être extraite plus tard). Pas de Nx/Bazel.

Structure cible :
```
apps/site      Astro (SEO, audit gratuit)
apps/app       React/Vite (espace client)
apps/api       Fastify
apps/worker    Playwright + axe-core
packages/db         schéma + migrations
packages/contracts  schémas Zod / OpenAPI
packages/rules      axe → WCAG → RGAA / EN 301 549
packages/ui         composants partagés
```

**SEO** : aucun pour l'app authentifiée. Site Astro (~30–100 pages : EAA/RGAA, « Suis-je concerné ? », guides par secteur, modèle de déclaration, landing audit gratuit) avec sitemap, schema.org, hreflang plus tard. Pages de résultats d'audit en `noindex`. SEO lent (3–6 mois) : la prospection directe démarre en parallèle, l'audit gratuit sert d'accroche.

## 2. Modèle de données (PostgreSQL, multi-tenance par `org_id`)
- **organizations** (id, name, plan, stripe_customer_id, sector, size, country, eaa_applicability jsonb)
- **users**, **memberships** (user_id, org_id, role)
- **sites** (id, org_id, base_url, verified_at, verification_method, scan_frequency)
- **pages** (id, site_id, url, template_key, last_seen_at)
- **audits** (id, site_id, type[free|scheduled|manual], status, started_at, finished_at, engine_version, score, pages_scanned)
- **audit_pages** (audit_id, page_id, html_snapshot_key, screenshot_key)
- **rules** (id, source[axe|manual], wcag_criterion, rgaa_criterion, en301549_clause, level, default_impact) — référentiel versionné
- **issues** (id, audit_id, page_id, rule_id, impact, selector, html_excerpt, message, fingerprint, raw jsonb)
- **findings** (id, site_id, rule_id, fingerprint, first_seen_audit_id, last_seen_audit_id, status[open|fixed|ignored|regressed], priority_score)
- **remediation_tasks** (id, finding_id, priority, effort_estimate, assignee, status, fix_guidance, code_suggestion)
- **manual_checks** (site_id, criterion, status[ok|ko|na], notes, evidence_key, checked_by)
- **accessibility_statements** (id, site_id, version, published_at, compliance_status[total|partiel|non], non_accessible_content jsonb, derogations, contact, audit_id, pdf_key, public_slug, locale)
- **service_orders** (id, org_id, type[fix|audit_manuel], scope, quote_amount, status, stripe_payment_id)
- **leads** (email, url, audit_id, consent, source, utm jsonb)
- **subscriptions**, **webhook_events** (idempotence sur l'id d'événement Stripe)
- tables **pg-boss** pour les jobs

Décisions : `fingerprint` (règle + sélecteur normalisé + template) pour suivre un problème dans le temps ; résultats bruts JSONB rejouables ; `priority_score` = impact × fréquence × importance de la page.

## 3. Risques transverses
- L'automatique ne couvre que ~30–40 % des critères : l'afficher (score « automatisé ») + `manual_checks`, sinon risque juridique.
- Crawler : anti-SSRF (IP privées/localhost), robots.txt, limites pages/temps, rate limit par domaine, vérification de propriété du domaine avant scans récurrents.
- RGPD : consentement sur `leads`, hébergement UE, rétention des snapshots.
- EN 301 549 = référentiel pivot UE ; RGAA = couche France.

## 4. Étapes de réalisation

### Étape 0 — Stack prête + CI (première étape, avant tout code métier)
Git : **initialisé par l'utilisateur** (l'agent ne lance ni `git init`, ni commit, ni push). L'agent prépare les fichiers ; l'utilisateur crée le dépôt et active la protection de branche.
Hypothèse à confirmer : hébergeur Git = GitHub (CI via GitHub Actions) ; à adapter sinon.

Contenu :
1. Monorepo : `package.json` racine, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`/`engines` (Node LTS), `.gitignore`, `.editorconfig`.
2. `tsconfig.base.json` en `strict`, configs par package.
3. Lint + format : ESLint (+ `eslint-plugin-jsx-a11y` pour les fronts) et Prettier.
4. Tests : Vitest (unitaires) ; Playwright (e2e) ajouté au premier parcours.
5. Squelettes minimaux et **compilables** de `apps/*` et `packages/*` (un « hello » + 1 test par package pour prouver la chaîne).
6. `docker-compose.yml` local : PostgreSQL (+ stockage S3 local type MinIO si nécessaire).
7. Configuration par variables d'environnement : `.env.example` documenté, validation Zod au démarrage, aucun secret dans le code.
8. Scripts racine : `lint`, `typecheck`, `test`, `build` via Turborepo.
9. **CI (`.github/workflows/ci.yml`)** déclenchée sur pull request : install avec cache pnpm, `lint`, `typecheck`, `test`, `build`, tests de migration sur Postgres service, audit de dépendances. Jobs requis avant merge.
10. Hooks locaux (Husky + lint-staged) : lint/format rapide au commit ; la CI reste la source de vérité.
11. `README.md` de démarrage + mise à jour d'AGENTS.md si des commandes de validation y sont à référencer.
12. À faire par l'utilisateur : `git init`, premier push, protection de branche `main` (CI obligatoire, PR requise).

Critère de fin : sur une branche vierge, `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` passent en local ET en CI ; `docker compose up` démarre Postgres.

### Étape 1 — Fondations données et contrats
- `packages/db` : schéma initial (organizations, sites, audits, pages, issues, rules, leads), migrations, tests de migration.
- `packages/contracts` : schémas Zod, génération OpenAPI, client typé.
- `packages/rules` : mapping axe → WCAG → EN 301 549 → RGAA, avec tests (couverture connue/inconnue explicite).

### Étape 2 — Moteur d'audit (worker)
- Interface `JobQueue` + implémentation pg-boss.
- Worker : Playwright + axe-core sur une URL, normalisation en `issues`, calcul de `fingerprint`.
- Protections : anti-SSRF, timeouts, limites, robots.txt (tests dédiés).
- Tests sur pages fixtures à violations connues.

### Étape 3 — API + audit gratuit (MVP)
- `apps/api` : endpoint de lancement d'audit gratuit, statut, rapport ; rate limiting ; capture de lead avec consentement.
- Rapport : score automatisé, problèmes groupés et priorisés, mention de la limite de l'automatique.
- Envoi du rapport par email.

### Étape 4 — Site public SEO (`apps/site`)
- Landing audit gratuit, « Suis-je concerné par l'EAA ? », guides EAA/RGAA, pages par secteur, modèle de déclaration.
- Sitemap, métadonnées, schema.org, tests de performance/accessibilité (le site doit être conforme).
- Déclaration d'accessibilité du produit lui-même.

### Étape 5 — Comptes et espace client (`apps/app`)
- Auth, organisations, ajout et vérification de domaine, crawl multi-pages, historique et `findings`.

### Étape 6 — Abonnement et surveillance continue
- Stripe Billing, webhooks idempotents, plans/quotas.
- Re-scans planifiés, détection de régressions, alertes email.
- Plan de correction priorisé (`remediation_tasks`).

### Étape 7 — Déclaration d'accessibilité et audit manuel
- `manual_checks` guidés, générateur de déclaration (versionnée, page publique, PDF), FR puis clés UE.

### Étape 8 — Prestations de correction
- Devis, `service_orders`, paiement ponctuel, suivi de livraison.

### Étapes ultérieures (selon traction)
API publique / intégration CI, plugin CMS, suggestions de correction par LLM, white-label agences, i18n UE.

## 5. Définition de « terminé » (chaque étape)
Workflow Spécificateur → Développeur → Testeur → Reviewer ; tests écrits avant l'implémentation ; lint, typecheck, tests et build verts en CI ; rapport final (Modification / Tests / Impacts / Incertitudes) ; aucune validation annoncée sans exécution réelle.

## 6. Questions ouvertes
- Hébergeur Git/CI (GitHub supposé).
- Choix final Drizzle vs Kysely, Better Auth vs alternative (à trancher à l'étape 1/5 sur vérification des versions et de la maintenance).
- Hébergeurs précis (Scaleway / Fly / Hetzner) et budget.
- Tarification et quotas des plans.
