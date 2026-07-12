export function parseAllowedOrigins(value: string | undefined, isProduction: boolean): string[] | null {
  if (!value) return isProduction ? [] : null;
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return !origin || allowedOrigins.includes(origin);
}

export function hasUnsafeDevSecret(isProduction: boolean, devApiKey: string): boolean {
  return isProduction && devApiKey === "dev-secret";
}
