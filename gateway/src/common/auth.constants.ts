export const JWT_VERIFICATION_SECRET = Symbol('JWT_VERIFICATION_SECRET');

export function jwtVerificationSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(
      'JWT_SECRET must contain at least 32 bytes. No default signing key is provided.',
    );
  }
  return secret;
}
