# 🌿 TheRike Full-Text RSS Server

Self-hosted, zero-dependency RSS 2.0 feed server optimized for **SocialBee**.

Fetches Shopify blog articles via native Atom feed and outputs clean RSS 2.0 with:
- ✅ Full article HTML inside `<description>` (CDATA-wrapped)
- ❌ No `<content:encoded>`
- ❌ No proxy CDN
- ❌ No external namespaces

## Quick Start

```bash
node server.js
```

## Endpoints

| Route | Description |
|-------|-------------|
| `GET /rss/sustainable-living` | Full-text RSS for sustainable-living blog |
| `GET /rss/:blogHandle` | Full-text RSS for any Shopify blog handle |
| `GET /health` | Health check |
| `GET /` | Index — lists all available feeds |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `SHOPIFY_DOMAIN` | `therike.com` | Shopify store domain |
| `CACHE_TTL_MS` | `300000` | Cache TTL in milliseconds (5 min) |

## Deploy on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/rozy0311/therike-rss-feed)

## SocialBee Setup

Add this URL as an RSS feed source in SocialBee:
```
https://your-render-url.onrender.com/rss/sustainable-living
```

## License

MIT
