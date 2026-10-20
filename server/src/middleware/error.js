const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const DUP_FIELD_LABELS = {
  barcode: 'Barcode', code: 'Code', sku: 'SKU', productCode: 'Product code', mobile: 'Mobile number',
  invoiceNumber: 'Invoice number', username: 'Username', name: 'Name',
};

function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || err.keyValue || {}).find((k) => k !== 'companyId' && k !== 'branchId' && k !== 'parentId') || 'value';
    const value = err.keyValue ? err.keyValue[field] : '';
    message = `${DUP_FIELD_LABELS[field] || field} "${value}" already exists`;
  } else if (err.name === 'ValidationError') {
    status = 400;
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    message = details[0]?.message || 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request too large';
  } else if (err.name === 'MulterError') {
    status = 400;
  }

  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    success: false,
    message: status >= 500 && env.nodeEnv === 'production' ? 'Internal server error' : message,
    details,
  });
}

module.exports = { notFound, errorHandler };
