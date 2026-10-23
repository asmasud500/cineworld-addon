declare module "stremio-addon-sdk" {
  export const addonBuilder: (manifest: unknown) => any;
  export const serveHTTP: (addonInterface: unknown, options: { port: number; hostname?: string }) => unknown;
  export const getRouter: (addonInterface: unknown) => any;
}
