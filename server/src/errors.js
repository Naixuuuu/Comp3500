/** An error that the route layer may translate into an HTTP response. */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, msg) => new HttpError(400, code, msg);
export const unauthorized = (code, msg) => new HttpError(401, code, msg);
export const forbidden = (code, msg) => new HttpError(403, code, msg);
export const notFound = (code, msg) => new HttpError(404, code, msg);
export const conflict = (code, msg) => new HttpError(409, code, msg);
