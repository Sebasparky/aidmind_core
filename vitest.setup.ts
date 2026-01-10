/// <reference types="@testing-library/jest-dom" />
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Cleanup after each test to avoid memory leaks and state pollution
afterEach(() => {
  cleanup();
});
