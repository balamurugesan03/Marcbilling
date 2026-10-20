const { asyncHandler } = require('../utils/common');
const master = require('../services/master.service');
const product = require('../services/product.service');
const barcode = require('../services/barcode.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

/** CRUD handlers for a master kind (category / brand / supplier / expenseCategory). */
const masterHandlers = (kind) => ({
  list: asyncHandler(async (req, res) => ok(res, await master.list(req, kind))),
  get: asyncHandler(async (req, res) => ok(res, await master.get(req, kind, req.params.id))),
  create: asyncHandler(async (req, res) => ok(res, await master.create(req, kind, req.body), 201)),
  update: asyncHandler(async (req, res) => ok(res, await master.update(req, kind, req.params.id, req.body))),
  remove: asyncHandler(async (req, res) => { await master.remove(req, kind, req.params.id); ok(res, true); }),
});

module.exports = {
  masterHandlers,
  products: {
    list: asyncHandler(async (req, res) => ok(res, await product.list(req))),
    get: asyncHandler(async (req, res) => ok(res, await product.get(req, req.params.id))),
    create: asyncHandler(async (req, res) => ok(res, await product.create(req, req.body), 201)),
    update: asyncHandler(async (req, res) => ok(res, await product.update(req, req.params.id, req.body))),
    remove: asyncHandler(async (req, res) => { await product.remove(req, req.params.id); ok(res, true); }),
    searchVariants: asyncHandler(async (req, res) => ok(res, await product.searchVariants(req))),
    listVariants: asyncHandler(async (req, res) => ok(res, await product.listVariants(req))),
    uploadImages: asyncHandler(async (req, res) => ok(res, (req.files || []).map((f) => `/uploads/${f.filename}`))),
  },
  barcodes: {
    lookup: asyncHandler(async (req, res) => ok(res, await barcode.lookup(req, req.params.code))),
    validate: asyncHandler(async (req, res) => ok(res, await barcode.validate(req, req.body))),
    bulkGenerate: asyncHandler(async (req, res) => ok(res, await barcode.bulkGenerate(req, req.body))),
    labels: asyncHandler(async (req, res) => ok(res, await barcode.labels(req, req.body))),
  },
};
