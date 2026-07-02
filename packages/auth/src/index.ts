import type { TenantContext } from "@framekit/core";
import { FramekitError } from "@framekit/core";

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  roles: string[];
  permissions: string[];
};

export type PublicAuthUser = Omit<AuthUser, "passwordHash">;

export type AuthSession = {
  token: string;
  user: PublicAuthUser;
  context: TenantContext;
  expiresAt: string;
};

export type UserStore = {
  findByEmail(email: string): Promise<AuthUser | undefined>;
  findById(tenantId: string, userId: string): Promise<AuthUser | undefined>;
};

export type PasswordAuthOptions = {
  secret: string;
  userStore: UserStore;
  sessionTtlSeconds?: number;
};

type SessionPayload = {
  sub: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  exp: number;
};

const encoder = new TextEncoder();

export class PasswordAuthService {
  private readonly sessionTtlSeconds: number;

  constructor(private readonly options: PasswordAuthOptions) {
    if (options.secret.length < 16) {
      throw new Error("Auth secret must be at least 16 characters.");
    }
    this.sessionTtlSeconds = options.sessionTtlSeconds ?? 60 * 60 * 8;
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const user = await this.options.userStore.findByEmail(normalizeEmail(email));
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new FramekitError("INVALID_LOGIN", "Invalid email or password.", 401);
    }
    return this.createSession(user);
  }

  async verifyToken(token: string): Promise<AuthSession> {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      throw new FramekitError("INVALID_SESSION", "Session token is malformed.", 401);
    }
    const expected = await sign(encodedPayload, this.options.secret);
    if (!constantEqual(signature, expected)) {
      throw new FramekitError("INVALID_SESSION", "Session token signature is invalid.", 401);
    }
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new FramekitError("SESSION_EXPIRED", "Session token has expired.", 401);
    }
    const user = await this.options.userStore.findById(payload.tenantId, payload.sub);
    if (!user) {
      throw new FramekitError("INVALID_SESSION", "Session user no longer exists.", 401);
    }
    return sessionFromUser(user, token, new Date(payload.exp * 1000).toISOString());
  }

  async createSession(user: AuthUser): Promise<AuthSession> {
    const expiresAt = Math.floor(Date.now() / 1000) + this.sessionTtlSeconds;
    const payload: SessionPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: user.permissions,
      exp: expiresAt
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const token = `${encodedPayload}.${await sign(encodedPayload, this.options.secret)}`;
    return sessionFromUser(user, token, new Date(expiresAt * 1000).toISOString());
  }
}

export class InMemoryUserStore implements UserStore {
  private readonly users: AuthUser[];

  constructor(users: AuthUser[]) {
    this.users = users.map((user) => ({ ...user, email: normalizeEmail(user.email) }));
  }

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((user) => user.email === normalizeEmail(email)));
  }

  async findById(tenantId: string, userId: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((user) => user.tenantId === tenantId && user.id === userId));
  }
}

export async function hashPassword(password: string, salt = randomSalt()): Promise<string> {
  const iterations = 160_000;
  const key = await derivePasswordKey(password, salt, iterations);
  return `pbkdf2-sha256:${iterations}:${salt}:${key}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [algorithm, iterationsRaw, salt, expected] = passwordHash.split(":");
  if (algorithm !== "pbkdf2-sha256" || !iterationsRaw || !salt || !expected) {
    throw new FramekitError("INVALID_PASSWORD_HASH", "Unsupported password hash format.", 500);
  }
  const actual = await derivePasswordKey(password, salt, Number(iterationsRaw));
  return constantEqual(actual, expected);
}

export function bearerToken(header: string | null): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length).trim();
}

function sessionFromUser(user: AuthUser, token: string, expiresAt: string): AuthSession {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return {
    token,
    user: publicUser,
    context: {
      tenantId: user.tenantId,
      userId: user.id,
      roles: user.roles,
      permissions: user.permissions
    },
    expiresAt
  };
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function derivePasswordKey(password: string, salt: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations
    },
    keyMaterial,
    256
  );
  return base64UrlEncodeBytes(new Uint8Array(bits));
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function cloneUser(user: AuthUser | undefined): AuthUser | undefined {
  return user ? { ...user, roles: [...user.roles], permissions: [...user.permissions] } : undefined;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(encoder.encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function constantEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}
