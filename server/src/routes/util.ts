import type { Request } from 'express';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string): ApiError => new ApiError(404, `${what} not found`);
export const badRequest = (message: string): ApiError => new ApiError(400, message);

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw badRequest(`Missing ${name}`);
  return value;
}

export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
}

export function queryNumber(req: Request, name: string): number | undefined {
  const raw = queryString(req, name);
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function body<T extends object>(req: Request): Partial<T> {
  return (req.body && typeof req.body === 'object' ? req.body : {}) as Partial<T>;
}
