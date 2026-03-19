// API response codes (matching fontInAss convention)
export const CODE = {
  OK: 200,
  WARN: 201,          // success with warnings (missing glyphs)
  MISSING_FONT: 300,  // fonts not available
  CLIENT_ERROR: 400,  // bad request
  SERVER_ERROR: 500,
} as const;
