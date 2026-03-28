import { Router, type Request, type Response } from "express";

export function createDeprecatedRouter(scope: string): Router {
  const router = Router();
  // Pathless middleware matches all methods and paths under this router's mount (path-to-regexp rejects "*").
  router.use((_req: Request, res: Response) => {
    res.status(410).json({
      error: `${scope} endpoints are deprecated and removed from tracking_payspace_server`,
      migration: "Use tracking-only endpoints: /tracking/* and /snippets/*",
      scope,
    });
  });
  return router;
}

