const { createLogger, format, transports } = require('winston');

// Define custom log format for structured JSON logs
const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.splat(),
        format.json()
    ),
    defaultMeta: { service: 'vaultbank-server' },
    transports: [
        // Log to console in all environments
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(({ timestamp, level, message, ...meta }) => {
                    // Simple console output while preserving JSON structure for log aggregation
                    return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                })
            )
        })
        // Additional transports (e.g., file) can be added here if needed
    ]
});

module.exports = logger;