# Vercel public gateway

`lcw.yishuziyu.cn` terminates HTTPS at Vercel and proxies requests to the
Docker service exposed at `http://121.89.90.68/lcw/`.

The gateway is required because direct requests whose `Host` header is an
unfiled domain are blocked by the mainland Alibaba Cloud ingress before they
reach nginx. Requests to the raw IP remain available as a fallback.

Deploy this directory as its own Vercel project, then bind
`lcw.yishuziyu.cn` to that project and point the DNS record to the CNAME Vercel
provides.
