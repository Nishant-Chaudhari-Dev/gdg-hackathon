export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK === "1" || process.env.NEXT_PUBLIC_MOCK === "true";
export const OPERATOR_STORAGE_KEY = "sentineldesk.operator";
