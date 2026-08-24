/** Bindings shared by the module-style Cloudflare environment and worker entry. */
declare namespace Cloudflare {
  interface Env {
    DB?:D1Database;
  }
}
