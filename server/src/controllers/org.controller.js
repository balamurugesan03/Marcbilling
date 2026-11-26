const { asyncHandler } = require('../utils/common');
const org = require('../services/org.service');
const ApiError = require('../utils/ApiError');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

module.exports = {
  getCompany: asyncHandler(async (req, res) => ok(res, await org.getCompany(req))),
  updateCompany: asyncHandler(async (req, res) => ok(res, await org.updateCompany(req, req.body))),
  uploadLogo: asyncHandler(async (req, res) => ok(res, await org.updateCompany(req, { logoUrl: `/uploads/${req.file.filename}` }))),

  listBranches: asyncHandler(async (req, res) => ok(res, await org.listBranches(req))),
  createBranch: asyncHandler(async (req, res) => ok(res, await org.createBranch(req, req.body), 201)),
  updateBranch: asyncHandler(async (req, res) => ok(res, await org.updateBranch(req, req.params.id, req.body))),
  deleteBranch: asyncHandler(async (req, res) => ok(res, await org.deleteBranch(req, req.params.id))),
  clearData: asyncHandler(async (req, res) => {
    if (req.body?.confirm !== 'DELETE') throw ApiError.badRequest('Type DELETE to confirm');
    ok(res, await org.clearData(req, { products: !!req.body.products, customers: !!req.body.customers, suppliers: !!req.body.suppliers }));
  }),

  listPermissions: asyncHandler(async (req, res) => ok(res, await org.listPermissions())),
  listRoles: asyncHandler(async (req, res) => ok(res, await org.listRoles(req))),
  createRole: asyncHandler(async (req, res) => ok(res, await org.createRole(req, req.body), 201)),
  updateRole: asyncHandler(async (req, res) => ok(res, await org.updateRole(req, req.params.id, req.body))),
  deleteRole: asyncHandler(async (req, res) => { await org.deleteRole(req, req.params.id); ok(res, true); }),

  listUsers: asyncHandler(async (req, res) => ok(res, await org.listUsers(req))),
  createUser: asyncHandler(async (req, res) => ok(res, await org.createUser(req, req.body), 201)),
  updateUser: asyncHandler(async (req, res) => ok(res, await org.updateUser(req, req.params.id, req.body))),
};
