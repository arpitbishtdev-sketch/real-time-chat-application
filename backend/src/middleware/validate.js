import { AppError } from '../utils/AppError.js';

// Express 5 makes req.query a read-only getter (no setter), unlike
// req.body/req.params — so a query-validated route reads the parsed
// result from req.validatedQuery instead of req.query. Not exercised by
// any M2 route yet (all M2 routes validate the body), but the factory is
// written correctly now rather than left as a landmine for M3's
// query-based routes (e.g. GET /users/search?q=).
export function validate(schema, source = 'body') {
  return function validateMiddleware(req, res, next) {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(
        new AppError(400, 'VALIDATION_ERROR', 'Invalid request data.', details)
      );
    }

    if (source === 'query') {
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }

    next();
  };
}
