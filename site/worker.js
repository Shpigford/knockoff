// Canonical-host redirects. Both knockoff.shopping and www are routed to this
// worker, and Cloudflare serves plain http without an upgrade, so without this
// Google sees four copies of every page (http/https x www/apex). Everything
// 301s to https://knockoff.shopping before the asset layer runs
// (run_worker_first in wrangler.toml). Other hostnames (wrangler dev's
// localhost) fall through untouched.
export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var wrongHost = url.hostname === 'www.knockoff.shopping';
    var wrongScheme = url.hostname === 'knockoff.shopping' && url.protocol === 'http:';
    if (wrongHost || wrongScheme) {
      url.hostname = 'knockoff.shopping';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  }
};
