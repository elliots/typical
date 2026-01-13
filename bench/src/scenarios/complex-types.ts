// Complex type validation benchmarks
import { z } from "zod";

// Template literal types
// type Email = `${string}@${string}.${string}`;
// type UUID = `${string}-${string}-${string}-${string}-${string}`;

// Union types
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TaskWithUnion {
  id: string;
  title: string;
  status: TaskStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  assignee: string | null;
}

// Template literal types
export interface UserWithTemplates {
  // id: UUID;
  name: string;
  // email: Email;
  website: `https://${string}`;
  phone: `+${bigint}`;
}

// Complex nested config
export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  ssl: boolean;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  maxSize: number;
}

export interface LogConfig {
  level: "debug" | "info" | "warn" | "error";
  format: "json" | "text";
  destination: "stdout" | "file";
}

export interface ComplexConfig {
  database: DatabaseConfig;
  cache: CacheConfig;
  logging: LogConfig;
  features: string[];
  metadata: Record<string, string>;
}

// Zod schemas
const zodTaskStatus = z.enum(["pending", "in_progress", "completed", "cancelled"]);
const zodTaskWithUnion = z.object({
  id: z.string(),
  title: z.string(),
  status: zodTaskStatus,
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  assignee: z.string().nullable(),
});

const zodUserWithTemplates = z.object({
  // id: z.string().regex(/^[a-f0-9-]+$/),
  name: z.string(),
  // email: z.string().regex(/^.+@.+\..+$/),
  website: z.string().regex(/^https:\/\/.+$/),
  phone: z.string().regex(/^\+\d+$/),
});

const zodDatabaseConfig = z.object({
  host: z.string(),
  port: z.number(),
  name: z.string(),
  ssl: z.boolean(),
});

const zodCacheConfig = z.object({
  enabled: z.boolean(),
  ttl: z.number(),
  maxSize: z.number(),
});

const zodLogConfig = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  format: z.enum(["json", "text"]),
  destination: z.enum(["stdout", "file"]),
});

const zodComplexConfig = z.object({
  database: zodDatabaseConfig,
  cache: zodCacheConfig,
  logging: zodLogConfig,
  features: z.array(z.string()),
  metadata: z.record(z.string(), z.string()),
});

// Typical validation
export function validateTaskWithUnion(task: TaskWithUnion): TaskWithUnion {
  return task;
}

export function validateUserWithTemplates(user: UserWithTemplates): UserWithTemplates {
  return user;
}

export function validateComplexConfig(config: ComplexConfig): ComplexConfig {
  return config;
}

// No-validation baseline
export function noValidateTaskWithUnion(task: any): any {
  return task;
}

export function noValidateUserWithTemplates(user: any): any {
  return user;
}

export function noValidateComplexConfig(config: any): any {
  return config;
}

// Zod validation
export function zodValidateTaskWithUnion(task: any): any {
  return zodTaskWithUnion.parse(task);
}

export function zodValidateUserWithTemplates(user: any): any {
  return zodUserWithTemplates.parse(user);
}

export function zodValidateComplexConfig(config: any): any {
  return zodComplexConfig.parse(config);
}

// Test data
export const testTaskWithUnion: TaskWithUnion = {
  id: "task-001",
  title: "Implement feature X",
  status: "in_progress",
  priority: 2,
  assignee: "alice@example.com",
};

export const testUserWithTemplates: UserWithTemplates = {
  // id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Charlie",
  // email: "charlie@example.com",
  website: "https://charlie.dev",
  phone: "+1234567890",
};

export const testComplexConfig: ComplexConfig = {
  database: {
    host: "localhost",
    port: 5432,
    name: "mydb",
    ssl: true,
  },
  cache: {
    enabled: true,
    ttl: 3600,
    maxSize: 1000,
  },
  logging: {
    level: "info",
    format: "json",
    destination: "stdout",
  },
  features: ["feature1", "feature2", "feature3"],
  metadata: {
    version: "1.0.0",
    environment: "production",
  },
};
