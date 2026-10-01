export interface paths {
    "/audits/free": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start a free audit of a public URL */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["FreeAuditRequest"];
                };
            };
            responses: {
                /** @description Audit queued */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Audit"];
                    };
                };
                /** @description Invalid request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Rate limited */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audits/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the status of an audit */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Audit */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Audit"];
                    };
                };
                /** @description Audit not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audits/{id}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the report of a completed audit */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Report */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AuditReport"];
                    };
                };
                /** @description Audit not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
                /** @description Audit not completed */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Record a lead with explicit consent */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["LeadRequest"];
                };
            };
            responses: {
                /** @description Lead recorded */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Invalid request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Error"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Audit: {
            /** Format: uuid */
            id: string;
            /** Format: uri */
            url: string;
            type: components["schemas"]["AuditType"];
            status: components["schemas"]["AuditStatus"];
            /** Format: date-time */
            startedAt: string | null;
            /** Format: date-time */
            finishedAt: string | null;
            pagesScanned: number;
            score: number | null;
            failureReason: components["schemas"]["AuditFailureReason"];
        };
        /** @enum {string} */
        AuditType: "free" | "scheduled" | "manual";
        /** @enum {string} */
        AuditStatus: "queued" | "running" | "completed" | "failed";
        /** @enum {string|null} */
        AuditFailureReason: "forbidden_url" | "robots_disallowed" | "scan_failed" | null;
        Error: {
            error: string;
            message: string;
        };
        FreeAuditRequest: {
            /** Format: uri */
            url: string;
        };
        AuditReport: {
            audit: components["schemas"]["Audit"];
            totalIssues: number;
            groups: components["schemas"]["ReportGroup"][];
            automatedCoverageNotice: string;
        };
        ReportGroup: {
            ruleId: string;
            title: string;
            /** Format: uri */
            helpUrl: string | null;
            impact: components["schemas"]["Impact"];
            occurrences: number;
            examples: components["schemas"]["ReportExample"][];
            wcagCriteria: string[];
            rgaaCriteria: string[];
        };
        /** @enum {string} */
        Impact: "minor" | "moderate" | "serious" | "critical";
        ReportExample: {
            selector: string;
            htmlExcerpt: string;
        };
        LeadRequest: {
            /** Format: email */
            email: string;
            /** Format: uuid */
            auditId: string;
            /** @enum {boolean} */
            consent: true;
            source?: string;
            utm?: {
                [key: string]: string;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
