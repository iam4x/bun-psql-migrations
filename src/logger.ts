import { pino } from "pino";

const isDevelopment = process.env.NODE_ENV === "development";

export const logger = pino(
  isDevelopment
    ? { level: "info", transport: { target: "pino-pretty" } }
    : { level: "info" },
);
