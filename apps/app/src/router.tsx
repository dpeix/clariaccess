import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Layout } from "./components/Layout.js";
import { AuditPage } from "./routes/AuditPage.js";
import { CallbackPage } from "./routes/CallbackPage.js";
import { FindingsPage } from "./routes/FindingsPage.js";
import { HomeRedirect } from "./routes/HomeRedirect.js";
import { ManualAuditPage } from "./routes/ManualAuditPage.js";
import { StatementPage } from "./routes/StatementPage.js";
import { LoginPage } from "./routes/LoginPage.js";
import { NewOrgPage } from "./routes/NewOrgPage.js";
import { OrgPage } from "./routes/OrgPage.js";
import { RequireAuth } from "./routes/RequireAuth.js";
import { SitePage } from "./routes/SitePage.js";
import { TasksPage } from "./routes/TasksPage.js";

const rootRoute = createRootRoute({ component: Layout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const callbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  component: function Callback() {
    const { token } = callbackRoute.useSearch();
    return <CallbackPage token={token} />;
  },
});

// Everything below needs a signed-in user.
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  component: RequireAuth,
});

const homeRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/",
  component: HomeRedirect,
});
const newOrgRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/orgs/new",
  component: NewOrgPage,
});
const orgRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/orgs/$orgId",
  component: function Org() {
    return <OrgPage orgId={orgRoute.useParams().orgId} />;
  },
});
const siteRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/sites/$siteId",
  component: function Site() {
    return <SitePage siteId={siteRoute.useParams().siteId} />;
  },
});
const findingsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/sites/$siteId/findings",
  component: function Findings() {
    return <FindingsPage siteId={findingsRoute.useParams().siteId} />;
  },
});
const tasksRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/sites/$siteId/tasks",
  component: function Tasks() {
    return <TasksPage siteId={tasksRoute.useParams().siteId} />;
  },
});
const manualAuditRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/sites/$siteId/audit-manuel",
  component: function ManualAudit() {
    return <ManualAuditPage siteId={manualAuditRoute.useParams().siteId} />;
  },
});
const statementRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/sites/$siteId/declaration",
  component: function Statement() {
    return <StatementPage siteId={statementRoute.useParams().siteId} />;
  },
});
const auditRoute = createRoute({
  getParentRoute: () => authRoute,
  path: "/audits/$auditId",
  component: function Audit() {
    return <AuditPage auditId={auditRoute.useParams().auditId} />;
  },
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  callbackRoute,
  authRoute.addChildren([
    homeRoute,
    newOrgRoute,
    orgRoute,
    siteRoute,
    findingsRoute,
    tasksRoute,
    manualAuditRoute,
    statementRoute,
    auditRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
