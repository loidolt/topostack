const raw = process.env.VITE_MAP_API_URL;
if (!raw) throw new Error("VITE_MAP_API_URL is required when packaging for Atomm.");
const url = new URL(raw);
const invalidHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".example") || url.hostname.includes("example.");
if (url.protocol !== "https:" || invalidHost) throw new Error("VITE_MAP_API_URL must be a deployed HTTPS endpoint, not localhost or a placeholder.");
