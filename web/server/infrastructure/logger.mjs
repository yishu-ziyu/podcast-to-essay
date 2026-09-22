const SECRET_ENV = ['STEP_API_KEY', 'ACCESS_PASSWORD', 'ANTHROPIC_AUTH_TOKEN'];

export function redact(value, env = process.env) {
  let text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  for (const key of SECRET_ENV) {
    const secret = env[key];
    if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('[redacted]');
  }
  text = text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  text = text.replace(/((?:cookie|authorization|password)\s*[:=]\s*)\S+/gi, '$1[redacted]');
  text = text.replace(/p2e_session=[^;\s]+/g, 'p2e_session=[redacted]');
  return text;
}

export function logEvent(fields, env = process.env) {
  const line = redact(JSON.stringify({
    t: new Date().toISOString(),
    requestId: fields.requestId || null,
    jobId: fields.jobId || null,
    episodeSlug: fields.episodeSlug || null,
    stage: fields.stage || null,
    durationMs: fields.durationMs ?? null,
    result: fields.result || null,
    errorCode: fields.errorCode || null,
    diagnosticId: fields.diagnosticId || null,
  }), env);
  console.log(line);
}
