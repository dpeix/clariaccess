export const APP_NAME = "Espace client";

// One distinct title per screen: it is what a screen reader announces first.
export function siteTitle(page: string): string {
  return `${page} | ${APP_NAME}`;
}
