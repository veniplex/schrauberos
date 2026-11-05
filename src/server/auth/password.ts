import "server-only";
import bcrypt from "bcryptjs";

const COST = 11;
export const MIN_PASSWORD_LENGTH = 8;

// Dummy-Hash, damit die Antwortzeit bei unbekannten Benutzern nicht verrät, ob es sie gibt.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("dummy-password", COST));

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? (await getDummyHash()));
  return ok && !!hash;
}
