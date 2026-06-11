/**
 * Bloom-style error envelope:
 * { defined, code, status, message, data }
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody() {
    return {
      defined: true,
      code: this.code,
      status: this.status,
      message: this.message,
      data: this.data,
    };
  }
}

export const Errors = {
  unauthorized: () =>
    new ApiError("UNAUTHORIZED", 401, "Missing or invalid API key."),
  brandNotFound: (id: string) =>
    new ApiError("BRAND_NOT_FOUND", 422, `Brand ${id} not found.`),
  brandNotReady: (id: string, status: string) =>
    new ApiError(
      "BRAND_NOT_READY",
      422,
      `Brand ${id} is not ready (status: ${status}). Poll GET /api/v1/brands/${id} until status is "ready".`,
    ),
  imageNotFound: (id: string) =>
    new ApiError("IMAGE_NOT_FOUND", 422, `Image ${id} not found.`),
  imageNotCompleted: (id: string, status: string) =>
    new ApiError(
      "IMAGE_NOT_COMPLETED",
      422,
      `Image ${id} has status "${status}"; it must be "completed" before it can be used as a source.`,
    ),
  insufficientCredits: (needed: number, available: number) =>
    new ApiError(
      "INSUFFICIENT_CREDITS",
      402,
      `This request costs ${needed} credit(s) but the account has ${available}.`,
      { action_url: "http://localhost:3000/billing" },
    ),
  validation: (message: string) =>
    new ApiError("VALIDATION_ERROR", 422, message),
  internal: (message = "Internal server error.") =>
    new ApiError("INTERNAL_ERROR", 500, message),
};
