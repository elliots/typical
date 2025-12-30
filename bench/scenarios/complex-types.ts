// Complex type validation benchmarks (unions, generics, template literals)

// Union types
export type Status = "pending" | "active" | "completed" | "cancelled";

export interface TaskWithUnion {
  id: number;
  title: string;
  status: Status;
  priority: 1 | 2 | 3 | 4 | 5;
}

export function validateTaskWithUnion(task: TaskWithUnion): TaskWithUnion {
  return task;
}

export function noValidateTaskWithUnion(task: any): any {
  return task;
}

// Template literal types
export type Email = `${string}@${string}.${string}`;
export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export interface UserWithTemplates {
  id: UUID;
  email: Email;
  name: string;
}

export function validateUserWithTemplates(user: UserWithTemplates): UserWithTemplates {
  return user;
}

export function noValidateUserWithTemplates(user: any): any {
  return user;
}

// Complex nested with optionals
export interface ComplexConfig {
  name: string;
  version: string;
  settings: {
    enabled: boolean;
    timeout?: number;
    retries?: number;
    options?: {
      debug?: boolean;
      verbose?: boolean;
      logLevel?: "error" | "warn" | "info" | "debug";
    };
  };
  tags?: string[];
}

export function validateComplexConfig(config: ComplexConfig): ComplexConfig {
  return config;
}

export function noValidateComplexConfig(config: any): any {
  return config;
}

// Test data
export const testTaskWithUnion: TaskWithUnion = {
  id: 1,
  title: "Complete project",
  status: "active",
  priority: 2,
};

export const testUserWithTemplates: UserWithTemplates = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  email: "test@example.com",
  name: "Test User",
};

export const testComplexConfig: ComplexConfig = {
  name: "my-app",
  version: "1.0.0",
  settings: {
    enabled: true,
    timeout: 5000,
    retries: 3,
    options: {
      debug: true,
      verbose: false,
      logLevel: "info",
    },
  },
  tags: ["production", "v1"],
};
