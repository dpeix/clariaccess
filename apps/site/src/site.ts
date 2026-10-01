export const siteConfig = {
  lang: "fr",
  title: "Audit d'accessibilité",
  description:
    "Testez gratuitement l'accessibilité de votre site : audit automatisé, problèmes priorisés et repères sur l'EAA et le RGAA.",
} as const;

export const mainNav = [
  { href: "/", label: "Accueil" },
  { href: "/suis-je-concerne/", label: "Suis-je concerné ?" },
  { href: "/guides/", label: "Guides" },
] as const;

export const footerNav = [
  { href: "/mentions-legales/", label: "Mentions légales" },
  { href: "/confidentialite/", label: "Confidentialité" },
  { href: "/accessibilite/", label: "Accessibilité" },
  { href: "/plan-du-site/", label: "Plan du site" },
] as const;
