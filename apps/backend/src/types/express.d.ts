import 'express';

declare module 'express' {
  interface Request {
    /**
     * Correlation / request identifier attached by the request-id middleware
     * (and reused by the logger). Present for every request.
     */
    id?: string;
  }
}
