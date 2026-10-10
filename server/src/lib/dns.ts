import { setServers } from "node:dns";

/**
 * Optional DNS override, for local development only.
 *
 * ── The problem it solves ────────────────────────────────────────────────
 * Atlas `mongodb+srv://` URIs are resolved by a DNS **SRV** lookup. Some
 * networks and resolvers mishandle SRV: on the machine this was built on, Node's
 * resolver took **31 seconds** and then failed with ETIMEOUT, while the Windows
 * resolver answered the identical query in milliseconds and a direct TCP
 * connection to the returned shard succeeded in 446 ms.
 *
 * Pointing Node at a public resolver fixes it outright:
 *
 *     before:  31,000 ms → ETIMEOUT
 *     after:      142 ms → 3 hosts
 *
 * ── Why this is opt-in and not just called from mongo.ts ───────────────────
 * 1. `dns.setServers()` is **process-global**. It redirects every DNS lookup in
 *    the process, not just the one the Mongo driver makes. Anything else that
 *    resolves a name inherits the change silently.
 * 2. It **breaks split-horizon DNS**. On a corporate, campus or VPN network,
 *    internal hostnames only resolve via the internal resolver. Redirecting to
 *    8.8.8.8 turns those into NXDOMAIN.
 * 3. 8.8.8.8 and 1.1.1.1 are **blocked on some networks and in some
 *    countries**. If that is why the local resolver is struggling in the first
 *    place, this makes it worse rather than better — and it fails slowly.
 *
 * None of these apply on Render, which resolves Atlas SRV through its own
 * internal DNS. So this is a laptop workaround, and shipping it as
 * unconditional production code would trade a real deployment for a
 * development convenience.
 *
 * Enable it with DNS_SERVERS in .env when you need it. Leave it unset
 * everywhere else.
 */
export function applyDnsOverride(raw: string | undefined): void {
    const servers = (raw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    if (servers.length === 0) return;

    setServers(servers);
    console.log(`[khoj] DNS override active: ${servers.join(", ")}`);
}