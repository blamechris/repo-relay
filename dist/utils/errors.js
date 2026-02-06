/** Extract a safe message from an unknown thrown value. */
export function safeErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
//# sourceMappingURL=errors.js.map