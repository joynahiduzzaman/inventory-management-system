/**
 * Normalises a managed-MySQL connection URI into something mysql2 accepts.
 *
 * Providers hand out a URI with TLS expressed as a query parameter:
 *
 *   mysql://user:pass@host:12345/defaultdb?ssl-mode=REQUIRED
 *   mysql://user:pass@host:12345/defaultdb?sslmode=require
 *
 * mysql2 understands neither spelling. It takes TLS through a driver `ssl`
 * option instead, so passing the URI through untouched connects in plaintext,
 * the server refuses it, and the failure surfaces as a bare handshake error
 * that says nothing about TLS. That is the single most common way this
 * migration goes wrong, so the parameter is read here and turned into the
 * explicit driver option, and the query string is dropped rather than left for
 * Sequelize to reinterpret as connection options.
 *
 * Returns { url, ssl } — a clean URI, and whether the URI itself asked for TLS.
 */
const SSL_PARAM = /^(ssl-mode|sslmode|ssl_mode|ssl)$/i;
const SSL_ON = /^(required|require|preferred|verify_ca|verify-ca|verify_identity|verify-full|true|1)$/i;

const parseDbUrl = (raw) => {
  if (!raw) return { url: raw, ssl: false };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    // Not a URL we can reason about — hand it back untouched rather than
    // mangling something the driver might still understand.
    return { url: raw, ssl: false };
  }

  let ssl = false;
  for (const [key, value] of parsed.searchParams.entries()) {
    if (SSL_PARAM.test(key) && SSL_ON.test(value)) ssl = true;
  }

  parsed.search = '';
  return { url: parsed.toString(), ssl };
};

/**
 * The dialectOptions.ssl value for a managed provider.
 *
 * Providers terminate TLS with their own CA, which is not in Node's trust
 * store, so verification is off unless the caller supplies that CA as PEM in
 * DB_CA_CERT. The connection is still encrypted either way — this only governs
 * whether the certificate chain is checked.
 */
const sslOptions = (caCert) => ({
  rejectUnauthorized: Boolean(caCert),
  ...(caCert ? { ca: caCert } : {}),
});

module.exports = { parseDbUrl, sslOptions };
