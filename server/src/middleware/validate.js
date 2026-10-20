const ApiError = require('../utils/ApiError');

/** Validates req[source] with a zod schema and replaces it with the parsed (coerced) value. */
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    const first = issues[0];
    return next(ApiError.badRequest(first.field ? `${first.field}: ${first.message}` : first.message, issues));
  }
  req[source] = result.data;
  next();
};

module.exports = validate;
