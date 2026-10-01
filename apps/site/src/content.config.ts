import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// An invalid frontmatter fails the build instead of shipping a page without
// title or description.
const guides = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string().min(1).max(70),
    // Search engines truncate around 160 characters.
    description: z.string().min(50).max(160),
    updated: z.coerce.date(),
    section: z.enum(["guide", "secteur", "modele"]),
  }),
});

export const collections = { guides };
