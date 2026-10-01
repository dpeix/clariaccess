import { queryOptions } from "@tanstack/react-query";
import { api, call } from "./api.js";
import { auditRefetchInterval } from "./lib/polling.js";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => call(api.GET("/me")),
  staleTime: 60_000,
});

export const sitesQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["sites", orgId],
    queryFn: () =>
      call(api.GET("/orgs/{orgId}/sites", { params: { path: { orgId } } })),
  });

export const siteQuery = (siteId: string, refetchMs: number | false = false) =>
  queryOptions({
    queryKey: ["site", siteId],
    queryFn: () =>
      call(api.GET("/sites/{id}", { params: { path: { id: siteId } } })),
    refetchInterval: refetchMs,
  });

export const siteAuditsQuery = (siteId: string) =>
  queryOptions({
    queryKey: ["site-audits", siteId],
    queryFn: () =>
      call(api.GET("/sites/{id}/audits", { params: { path: { id: siteId } } })),
    refetchInterval: (query) =>
      auditRefetchInterval(query.state.data?.map((a) => a.status)),
  });

export const auditQuery = (auditId: string) =>
  queryOptions({
    queryKey: ["audit", auditId],
    queryFn: () =>
      call(api.GET("/audits/{id}", { params: { path: { id: auditId } } })),
    refetchInterval: (query) =>
      auditRefetchInterval(
        query.state.data ? [query.state.data.status] : undefined,
      ),
  });

export const auditPagesQuery = (auditId: string, active: boolean) =>
  queryOptions({
    queryKey: ["audit-pages", auditId],
    queryFn: () =>
      call(
        api.GET("/audits/{id}/pages", { params: { path: { id: auditId } } }),
      ),
    refetchInterval: active ? 3000 : false,
  });

export const reportQuery = (auditId: string) =>
  queryOptions({
    queryKey: ["report", auditId],
    queryFn: () =>
      call(
        api.GET("/audits/{id}/report", { params: { path: { id: auditId } } }),
      ),
  });

export const membersQuery = (orgId: string) =>
  queryOptions({
    queryKey: ["members", orgId],
    queryFn: () =>
      call(api.GET("/orgs/{orgId}/members", { params: { path: { orgId } } })),
  });

export const manualChecksQuery = (siteId: string) =>
  queryOptions({
    queryKey: ["manual-checks", siteId],
    queryFn: () =>
      call(
        api.GET("/sites/{id}/manual-checks", {
          params: { path: { id: siteId } },
        }),
      ),
  });

export const statementsQuery = (siteId: string) =>
  queryOptions({
    queryKey: ["statements", siteId],
    queryFn: () =>
      call(
        api.GET("/sites/{id}/statements", { params: { path: { id: siteId } } }),
      ),
  });
