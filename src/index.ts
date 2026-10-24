import express from 'express';
import cors from 'cors';
import { errorHandler } from './middlewares/errors'; 

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());
app.use(errorHandler);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => console.log(`API en http://localhost:${port}`));