import { parseEnv } from "./env.js";

const env = parseEnv(process.env);

console.log(`worker ready (${env.NODE_ENV})`);
