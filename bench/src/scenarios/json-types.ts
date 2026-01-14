// JSON parsing/stringify benchmarks
import { z } from "zod";

// Small payload - simple object
export interface SmallPayload {
  id: number;
  name: string;
  active: boolean;
}

// Medium payload - nested objects
export interface MediumPayload {
  id: number;
  user: {
    name: string;
    email: string;
    age: number;
  };
  metadata: {
    created: string;
    updated: string;
    version: number;
  };
  tags: string[];
}

// Large payload - deeply nested with arrays
export interface LargePayload {
  id: number;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  author: {
    id: number;
    name: string;
    email: string;
    profile: {
      bio: string;
      avatar: string;
      social: {
        twitter: string;
        github: string;
      };
    };
  };
  // content: {
  //   sections: Array<{
  //     id: number;
  //     title: string;
  //     body: string;
  //     order: number;
  //   }>;
  // };
  // metadata: {
  //   created: string;
  //   updated: string;
  //   published: string | null;
  //   views: number;
  //   likes: number;
  // };
  tags: string[];
  categories: string[];
}

// Zod schemas
export const zodSmallPayload = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
});

export const zodMediumPayload = z.object({
  id: z.number(),
  user: z.object({
    name: z.string(),
    email: z.string(),
    age: z.number(),
  }),
  metadata: z.object({
    created: z.string(),
    updated: z.string(),
    version: z.number(),
  }),
  tags: z.array(z.string()),
});

export const zodLargePayload = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  author: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
    profile: z.object({
      bio: z.string(),
      avatar: z.string(),
      social: z.object({
        twitter: z.string(),
        github: z.string(),
      }),
    }),
  }),
  // content: z.object({
  //   sections: z.array(
  //     z.object({
  //       id: z.number(),
  //       title: z.string(),
  //       body: z.string(),
  //       order: z.number(),
  //     }),
  //   ),
  // }),
  // metadata: z.object({
  //   created: z.string(),
  //   updated: z.string(),
  //   published: z.string().nullable(),
  //   views: z.number(),
  //   likes: z.number(),
  // }),
  tags: z.array(z.string()),
  categories: z.array(z.string()),
});

export const zodLargeArray = z.array(zodLargePayload);

// Test data
export const testSmallPayload: SmallPayload = {
  id: 1,
  name: "Test Item",
  active: true,
};

export const testSmallPayloadWithExtras = {
  id: 1,
  name: "Test Item",
  active: true,
  extra1: "should be filtered",
  extra2: 12345,
  extra3: { nested: "data" },
} as SmallPayload;

export const testMediumPayload: MediumPayload = {
  id: 42,
  user: {
    name: "Alice",
    email: "alice@example.com",
    age: 30,
  },
  metadata: {
    created: "2024-01-01T00:00:00Z",
    updated: "2024-01-15T12:00:00Z",
    version: 3,
  },
  tags: ["important", "reviewed", "approved"],
};

export const testLargePayload: LargePayload = {
  id: 1001,
  title: "Getting Started with TypeScript",
  description:
    "A comprehensive guide to TypeScript for beginners and experienced developers alike.",
  status: "published",
  author: {
    id: 42,
    name: "Jane Developer",
    email: "jane@example.com",
    profile: {
      bio: "Senior software engineer with 10+ years of experience in web development.",
      avatar: "https://example.com/avatars/jane.jpg",
      social: {
        twitter: "@janedev",
        github: "janedev",
      },
    },
  },
  // content: {
  //   sections: [
  //     { id: 1, title: "Introduction", body: "TypeScript is a typed superset of JavaScript...", order: 1 },
  //     { id: 2, title: "Setup", body: "To get started, install TypeScript globally...", order: 2 },
  //     { id: 3, title: "Basic Types", body: "TypeScript provides several basic types...", order: 3 },
  //     { id: 4, title: "Interfaces", body: "Interfaces define the shape of objects...", order: 4 },
  //     { id: 5, title: "Classes", body: "TypeScript supports class-based OOP...", order: 5 },
  //   ],
  // },
  // metadata: {
  //   created: "2024-01-01T00:00:00Z",
  //   updated: "2024-01-20T15:30:00Z",
  //   published: "2024-01-10T09:00:00Z",
  //   views: 15420,
  //   likes: 892,
  // },
  tags: ["typescript", "javascript", "tutorial", "beginner", "web-development"],
  categories: ["Programming", "Web Development", "Tutorials"],
};

// Generate array of large payloads for bulk benchmarks
export const testLargeArrayPayload: LargePayload[] = Array.from({ length: 1000 }, (_, i) => ({
  ...testLargePayload,
  id: i + 1,
  title: `Article ${i + 1}: ${testLargePayload.title}`,
  // metadata: {
  //   ...testLargePayload.metadata,
  //   views: testLargePayload.metadata.views + i * 10,
  //   likes: testLargePayload.metadata.likes + i,
  // },
}));

// Pre-stringified JSON for parse benchmarks
export const testSmallJson = JSON.stringify(testSmallPayload);
export const testSmallWithExtrasJson = JSON.stringify(testSmallPayloadWithExtras);
export const testMediumJson = JSON.stringify(testMediumPayload);
export const testLargeJson = JSON.stringify(testLargePayload);
export const testLargeArrayJson = JSON.stringify(testLargeArrayPayload);
