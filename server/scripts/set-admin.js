/* eslint-disable no-console */
/**
 * Safe on a live database: creates (or resets) the admin@marc.com Super Admin and disables the old
 * demo logins. Touches nothing else — no products, sales, stock or other staff.
 *
 *   npm run admin:set
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { connectDB } = require('../src/config/db');
const M = require('../src/models');

const USERNAME = 'admin@marc.com';
const PASSWORD = 'admin@123';
const DEMO_USERNAMES = ['admin', 'companyadmin', 'manager', 'cashier', 'cashier2', 'cashier3', 'stock', 'accountant'];

async function main() {
  await connectDB();
  const company = await M.Company.findOne().sort({ createdAt: 1 });
  if (!company) throw new Error('No company found — this database has never been set up.');
  const role = await M.Role.findOne({ companyId: company._id, code: 'super_admin' });
  if (!role) throw new Error('Super Admin role not found.');
  const branches = await M.Branch.find({ companyId: company._id }).sort({ isDefault: -1, name: 1 });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await M.User.findOne({ username: USERNAME });
  if (existing) {
    await M.User.updateOne({ _id: existing._id }, {
      $set: { passwordHash, roleId: role._id, active: true, branchIds: branches.map((b) => b._id), defaultBranchId: branches[0]?._id },
      $inc: { tokenVersion: 1 },
    });
    console.log(`[admin] reset ${USERNAME}`);
  } else {
    await M.User.create({
      companyId: company._id, name: 'Administrator', username: USERNAME, email: USERNAME, passwordHash,
      roleId: role._id, branchIds: branches.map((b) => b._id), defaultBranchId: branches[0]?._id,
    });
    console.log(`[admin] created ${USERNAME}`);
  }

  // Disabled rather than deleted so old bills keep pointing at a real user; bumping tokenVersion ends their sessions.
  const r = await M.User.updateMany({ username: { $in: DEMO_USERNAMES }, active: true }, { $set: { active: false }, $inc: { tokenVersion: 1 } });
  console.log(`[admin] disabled ${r.modifiedCount} demo login(s)`);
  console.log(`[admin] done. Login: ${USERNAME} / ${PASSWORD}`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('[admin] failed', e.message);
  await mongoose.disconnect();
  process.exit(1);
});
