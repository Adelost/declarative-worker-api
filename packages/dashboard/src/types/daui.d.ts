/**
 * Type declarations for @daui/core when not installed.
 * These are minimal stubs to allow TypeScript compilation.
 * Full types come from the @daui/core package when installed.
 */

declare module "@daui/core" {
  export interface Section {
    [key: string]: unknown;
  }

  export interface Page {
    layout: "centered" | "full" | "sidebar";
    title: string | (() => string);
    sections: Section[];
    shortcuts?: unknown[];
  }
}
