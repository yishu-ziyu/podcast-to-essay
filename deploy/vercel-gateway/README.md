# Vercel public gateway

`lcw.yishuziyu.cn` terminates HTTPS at Vercel and proxies requests to the
Docker service exposed at `http://121.89.90.68/lcw/`.

The gateway is required because direct requests whose `Host` header is an
unfiled domain are blocked by the mainland Alibaba Cloud ingress before they
reach nginx. Requests to the raw IP remain available as a fallback.

Deploy this directory as its own Vercel project, then bind
`lcw.yishuziyu.cn` to that project and point the DNS record to the CNAME Vercel
provides.

## Why a function instead of plain rewrites (2026-09-28)

Edge rewrites leave Vercel from `hkg1`, and the cross-border path drops SYNs
from some foreign source IPs to the origin (about half of requests returned
`502 ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR`). `api/gw.js` runs in `kix1`
(Osaka), whose egress currently reaches the origin, and streams every request
through, including SSE. Only `POST /api/episodes/:slug/audio` stays a direct
rewrite because uploads exceed the 4.5 MB function body limit.

An egress IP can still be blocked later. If 502s return, redeploy (new
instances usually get new egress IPs) or move `regions` to another region that
tests clean. The durable fix is the ICP filing for `yishuziyu.cn`.

When the origin is unreachable, page navigations get a Chinese explanation
page that links to the self-host guide on GitHub; API calls get a JSON error.
`ORIGIN_HOST` can be overridden by env to preview that page.
