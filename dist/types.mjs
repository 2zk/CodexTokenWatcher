export class CliUsageError extends Error {
    exitCode = 2;
}
export class AppServerError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = "AppServerError";
    }
}
