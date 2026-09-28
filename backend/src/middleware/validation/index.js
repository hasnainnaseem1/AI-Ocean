const { validateEmail } = require('./emailValidator');
const { validate, z, fields } = require('./validate');

module.exports = {
  validateEmail,
  validate,
  z,
  fields,
};