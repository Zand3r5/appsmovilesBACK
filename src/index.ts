import express from "express";
import cors from "cors";

 import { authRoutes } from "./routes/auth";             
 import { movieRoutes } from "./routes/movies";         
 import { releaseRoutes } from "./routes/releases";
 import { syncCatalog } from "./services/tmdb";      
// import { reviewRoutes } from "./routes/reviews";        // fase 7
// import { userRoutes } from "./routes/users";            // fase 8
// import { rewardRoutes } from "./routes/rewards";        // fase 8
// import { socialRoutes } from "./routes/social";         // fase 9
// import { feedRoutes } from "./routes/feed";             // fase 9
// import { adminRoutes } from "./routes/admin";           // fase 10

for (const name of ["DATABASE_URL", "JWT_SECRET"]) {
  if (!process.env[name]) throw new Error(`Falta ${name} en el .env`);
}

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));     // 2 MB por las fotos en base64

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

 authRoutes(app);
  movieRoutes(app);
 releaseRoutes(app);
// reviewRoutes(app);
// userRoutes(app);
// rewardRoutes(app);
// socialRoutes(app);
// feedRoutes(app);
// adminRoutes(app);

app.use((_req, res) => {
  res.status(404).json({ error: "Ruta inexistente" });
});

app.listen(port, () => console.log(`API en http://localhost:${port}`));
syncCatalog().catch((e) => console.error("No se pudo sincronizar con TMDB:", e.message));
setInterval(() => syncCatalog().catch(() => {}), 12 * 60 * 60 * 1000);