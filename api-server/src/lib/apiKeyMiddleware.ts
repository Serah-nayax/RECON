import { type Request, type Response, type NextFunction } from "express";

export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey = req.headers["x-api-key"];
  const expected = process.env.CRAWLER_API_KEY;

  if (!expected) {
    res.status(500).json({ error: "CRAWLER_API_KEY is not configured on the server" });
    return;
  }

  if (!apiKey || apiKey !== expected) {
    res.status(401).json({ error: "Unauthorized: invalid or missing x-api-key header" });
    return;
  }

  next();
}
