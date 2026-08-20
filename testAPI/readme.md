# testAPI

Exploration scripts for the two real data sources behind N1 (ingestion):

1. **e-GP RSS feed** (`explore-egp-rss.ts`) — the live source. No API key.
2. **data.go.th / opend** (`explore-api-data-go-th.ts`) — the historical/batch source (CGD contracts + agency lookup). API key optional (public reads worked without one in testing).

```bash
npm install   # once
```

## 1. e-GP RSS feed (live TOR/announcements)

```bash
npm run rss --                        # national feed, default types (B0,D0)
npm run rss -- 4520101                 # one agency, default types
npm run rss -- 4520101 B0,D0,D1,D2,W0  # one agency, custom type list
npm run rss -- ALL P0                  # national feed, just procurement plans
```

No published master list of `deptId` values exists — collect the ones you need to track manually. See the header comment in `explore-egp-rss.ts` for the full type-code table and the confirmed (and important) finding that each item's `<link>` is either a direct PDF or an HTML page, mixed per item.

## 2. data.go.th / opend (historical, batch)

```bash
npm run explore -- orgs                       # confirm the 7 target sites + CGD
npm run explore -- site <org_slug>            # e.g. site pea, site cgd
npm run explore -- search [keyword]
npm run explore -- resource <resource_id>
npm run explore -- cgd                        # CGD's own procurement datasets
npm run explore -- winner <tin>               # filter CGD contracts by winner TIN
npm run explore -- departments [year]         # CGD's agency name/code lookup (default 2566)
```

Set your key in `.env` (copy `.env.example`) before running — see the header comment in `explore-api-data-go-th.ts` for everything confirmed live so far (real org slugs, real dataset shapes, dead ends already ruled out).
