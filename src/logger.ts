/**
 * Logger Module
 *
 * Centralized logging using pino.
 */
import pino from "pino";

export type Logger = pino.Logger;
export type LoggerBindings = pino.Bindings;

/**
 * Root logger instance
 * Log level can be controlled via LOG_LEVEL environment variable
 */
export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
});

/**
 * Create a child logger with additional context bindings
 * Useful for adding workerId, browserUrl, etc. to all log entries
 */
export const createChildLogger = (bindings: LoggerBindings): Logger => {
  return logger.child(bindings);
};
