// File: src/middleware/validate.js
const Joi = require('joi');

const userEntrySchema = Joi.object({
  givenName: Joi.string().trim().min(1).max(100).required(),
  altSecurityIdSuffix: Joi.string().trim().min(1).max(100).required(),
  email: Joi.string().trim().email().required()
});

const schema = Joi.object({
  agpUsername: Joi.string().trim().min(1).max(100).required(),
  partnerId: Joi.string()
    .trim()
    .pattern(/^[a-zA-Z0-9-]+$/)
    .min(1)
    .max(50)
    .required()
    .messages({ 'string.pattern.base': 'Partner ID may only contain letters, numbers and hyphens' }),
  partnerName: Joi.string().trim().min(1).max(100).required(),
  users: Joi.array()
    .items(userEntrySchema)
    .min(1)
    .max(20)
    .required()
    .messages({
      'array.min': 'At least one user is required',
      'array.max': 'You can create at most 20 users in a single batch'
    })
});

function validateProvisionInput(data) {
  return schema.validate(data, { abortEarly: false, stripUnknown: true });
}

const resetPasswordSchema = Joi.object({
  targetEmail: Joi.string().trim().email().required().messages({
    '*': 'The AD account email to reset is required and must be a valid email address'
  }),
  notifyEmail: Joi.string().trim().email().required().messages({
    '*': 'The email address to send the new password to is required and must be a valid email address'
  })
});

function validateResetPasswordInput(data) {
  return resetPasswordSchema.validate(data, { abortEarly: false, stripUnknown: true });
}

const toggleUserSchema = Joi.object({
  mail: Joi.string().trim().email().required(),
  enabled: Joi.boolean().required()
});

function validateToggleUserInput(data) {
  return toggleUserSchema.validate(data, { abortEarly: false, stripUnknown: true });
}

const toggleAdUserSchema = Joi.object({
  samAccountName: Joi.string().trim().min(1).max(200).required(),
  mail: Joi.string().trim().email().required(),
  enabled: Joi.boolean().required()
});

function validateToggleAdUserInput(data) {
  return toggleAdUserSchema.validate(data, { abortEarly: false, stripUnknown: true });
}

module.exports = {
  validateProvisionInput,
  validateResetPasswordInput,
  validateToggleUserInput,
  validateToggleAdUserInput
};
