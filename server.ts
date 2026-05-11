import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({
  origin: ['https://crometix.com', 'http://localhost:3000'],
}));

app.use(express.json());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 20,
}));

const cache = new Map<string, { data: any; expiresAt: number }>();

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function toInt(score: number | null | undefined): number {
  if (score == null) return 0;
  return Math.round(score * 100);
}

app.post('/audit', async (req, res) => {
  try {
    const rawUrl = req.body.url;

    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).json({ error: 'Missing URL' });
    }

    const targetUrl = normalizeUrl(rawUrl);
    new URL(targetUrl);

    const cacheKey = `mobile:${targetUrl}`;
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ ...cached.data, cached: true });
    }

    const apiUrl =
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
      `?url=${encodeURIComponent(targetUrl)}` +
      `&strategy=mobile` +
      `&category=performance` +
      `&category=seo` +
      `&category=accessibility` +
      `&category=best-practices` +
      `&key=${process.env.GOOGLE_PAGESPEED_API_KEY}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: 'PageSpeed API failed',
        details: text,
      });
    }

    const data = await response.json();
    const categories = data.lighthouseResult?.categories;

    const result = {
      url: targetUrl,
      performance: toInt(categories?.performance?.score),
      seo: toInt(categories?.seo?.score),
      accessibility: toInt(categories?.accessibility?.score),
      bestPractices: toInt(categories?.['best-practices']?.score),
    };

    cache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 1000 * 60 * 60 * 6,
    });

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Audit failed' });
  }
});

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Audit API running on port ${port}`);
});