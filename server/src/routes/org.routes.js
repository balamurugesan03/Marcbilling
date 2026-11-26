// /api/companies, /api/branches, /api/roles, /api/permissions, /api/users
const express = require('express');
const c = require('../controllers/org.controller');
const validate = require('../middleware/validate');
const { permit } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const v = require('../validators');

const companies = express.Router();
companies.get('/current', c.getCompany);
companies.put('/current', permit('branch.edit'), validate(v.org.company), c.updateCompany);
companies.post('/current/logo', permit('branch.edit'), imageUpload.single('logo'), c.uploadLogo);
companies.post('/current/clear-data', permit('backup.manage'), c.clearData);

const branches = express.Router();
branches.get('/', c.listBranches);
// upload only: returns the image URL, saved on the branch with the form (works before a new branch exists)
branches.post('/logo', permit('branch.create', 'branch.edit'), imageUpload.single('logo'), c.uploadBranchLogo);
branches.post('/', permit('branch.create'), validate(v.org.branch), c.createBranch);
branches.put('/:id', permit('branch.edit'), validate(v.org.branch.partial()), c.updateBranch);
branches.delete('/:id', permit('branch.delete'), c.deleteBranch);

const roles = express.Router();
roles.get('/', permit('role.view', 'user.view', 'user.create', 'user.edit'), c.listRoles);
roles.post('/', permit('role.create'), validate(v.org.role), c.createRole);
roles.put('/:id', permit('role.edit'), validate(v.org.role.partial()), c.updateRole);
roles.delete('/:id', permit('role.delete'), c.deleteRole);

const permissions = express.Router();
permissions.get('/', permit('role.view', 'user.view'), c.listPermissions);

const users = express.Router();
users.get('/', permit('user.view'), c.listUsers);
users.post('/', permit('user.create'), validate(v.org.userCreate), c.createUser);
users.put('/:id', permit('user.edit'), validate(v.org.userUpdate), c.updateUser);

module.exports = { companies, branches, roles, permissions, users };
