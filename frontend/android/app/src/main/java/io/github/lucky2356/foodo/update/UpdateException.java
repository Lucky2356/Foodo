package io.github.lucky2356.foodo.update;

/**
 * A failed update step. The {@link Code} is passed to JavaScript as the error code; the web UI
 * turns it into a Russian message (frontend/src/native/updateLogic.ts). The message is for logs.
 */
public final class UpdateException extends Exception {

    private static final long serialVersionUID = 1L;

    public enum Code {
        /** No connection, DNS failure or timeout. */
        NETWORK,
        /** GitHub refused the anonymous request (HTTP 403 or 429), usually the hourly limit. */
        RATE_LIMIT,
        /** Any other unexpected HTTP status. */
        HTTP,
        /** The release response could not be parsed. */
        BAD_RESPONSE,
        /** check() found nothing to download, or download() has not completed. */
        NO_UPDATE,
        /** Size, SHA-256, package name, version or signing certificate did not match. */
        VERIFY_FAILED,
        /** The user has not allowed Foodo to install apps («Установка неизвестных приложений»). */
        INSTALL_PERMISSION,
        /** PackageInstaller could not start the installation. */
        INSTALL_FAILED,
        /** Another update operation is already running. */
        BUSY,
        /** Unexpected internal error. */
        INTERNAL,
    }

    private final Code code;

    public UpdateException(Code code, String message) {
        super(message);
        this.code = code;
    }

    public UpdateException(Code code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public Code getCode() {
        return code;
    }
}
