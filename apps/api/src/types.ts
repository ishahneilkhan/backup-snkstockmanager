export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  PBKDF2_ITERATIONS?: string;
};

export type Role = 'super_admin' | 'owner' | 'salesman';

export type AuthUser = {
  id: string;
  shopId: string | null;
  role: Role;
  name: string;
  mustChangePassword: boolean;
};

export type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };
