export class PreverusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreverusError";
  }
}

export class NetworkError extends PreverusError {
  constructor(message = "Unable to connect to Preverus.") {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends PreverusError {
  constructor(
    message: string,
    public readonly statusCode = 0,
    public readonly errorCode = "api_error",
    public readonly response: unknown = undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
