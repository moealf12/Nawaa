// Diagnostic-only preload: observes the real transport, without changing requests.
// Log an allowlisted endpoint label, never headers, query strings or credentials.
const originalFetch = globalThis.fetch;
const epoch = performance.now();
let sequence = 0;
const label = url => {
  if (url.hostname === 'ac.cnstrc.com') return 'jarir:page-' + (url.searchParams.get('page') || '1');
  if (url.hostname === 'search.unbxd.io') return 'extra';
  if (url.hostname.endsWith('.algolia.net')) return 'algolia';
  if (url.hostname === 'api.frankfurter.dev') return 'fx';
  return url.hostname;
};
globalThis.fetch = async (input, options) => {
  const id = ++sequence;
  const endpoint = label(new URL(typeof input === 'string' || input instanceof URL ? input : input.url));
  const start = performance.now();
  const report = fields => console.log('LATENCY_TRANSPORT ' + JSON.stringify({
    id, endpoint, startMs: Math.round(start - epoch), elapsedMs: Math.round(performance.now() - start), ...fields,
  }));
  try {
    const response = await originalFetch(input, options);
    report({phase:'headers',status:response.status});
    for (const method of ['json','text']) {
      const consume = response[method].bind(response);
      response[method] = async () => {
        try { const value = await consume(); report({phase:'body',status:response.status}); return value; }
        catch (error) { report({phase:'body-error',error:error.name}); throw error; }
      };
    }
    return response;
  } catch (error) { report({phase:'error',error:error.name}); throw error; }
};
