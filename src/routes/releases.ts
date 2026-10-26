import type { Express } from "express";
import { getNowPlaying, getUpcoming } from "../services/tmdb";
import { handleError } from "../utils/http";

export function releaseRoutes(app: Express) {
  app.get("/api/releases/upcoming", async (_req, res) => {
    try {
      res.json(await getUpcoming());
    } catch (e) {
      handleError(res, e);
    }
  });

  app.get("/api/releases/now-playing", async (_req, res) => {
    try {
      res.json(await getNowPlaying());
    } catch (e) {
      handleError(res, e);
    }
  });
}