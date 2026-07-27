// File: src/services/admanager.service.js
const axios = require('axios');
const https = require('https');

const insecureAgent = new https.Agent({ rejectUnauthorized: false }); // self-signed cert, ինչպես -SkipCertificateCheck

const {
  ADMANAGER_PROTOCOL,
  ADMANAGER_HOST,
  ADMANAGER_PORT,
  DOMAIN_NAME,
  AUTH_TOKEN,
  PRODUCT_NAME,
  USER_TEMPLATE_NAME,
  GROUP_TEMPLATE_NAME,
  GROUP_OU,
  GROUP_SCOPE,
  GROUP_TYPE
} = process.env;

function baseUrl(action) {
  const protocol = ADMANAGER_PROTOCOL || 'https';
  return protocol + '://' + ADMANAGER_HOST + ':' + ADMANAGER_PORT + '/RestAPI/' + action;
}

function commonParams(extra) {
  return Object.assign(
    { domainName: DOMAIN_NAME, AuthToken: AUTH_TOKEN, PRODUCT_NAME: PRODUCT_NAME || 'UserProvisioningApp' },
    extra || {}
  );
}

function assertConfigured() {
  if (!ADMANAGER_HOST || !AUTH_TOKEN || !DOMAIN_NAME) {
    throw new Error('ADManager Plus կապակցումը կարգավորված չէ (.env-ում ADMANAGER_HOST / AUTH_TOKEN / DOMAIN_NAME)');
  }
}

async function request(config) {
  try {
    return await axios(Object.assign({}, config, {
      httpsAgent: insecureAgent,
      headers: { Authorization: AUTH_TOKEN }
    }));
  } catch (err) {
    if (err.response) {
      const body = err.response.data;
      let detail;
      if (Array.isArray(body) && body[0] && body[0].statusMessage) {
        detail = body[0].statusMessage;
      } else if (body && body.statusMessage) {
        detail = body.statusMessage;
      } else if (body && body.detail) {
        detail = body.detail;
      } else if (typeof body === 'string' && body.trim().startsWith('<')) {
        detail = 'endpoint not available on this ADManager Plus instance (HTML error page returned instead of JSON)';
      } else if (typeof body === 'string') {
        detail = body.slice(0, 300);
      } else {
        detail = JSON.stringify(body).slice(0, 300);
      }
      throw new Error('HTTP ' + err.response.status + ' from ADManager Plus: ' + detail);
    }
    throw err;
  }
}

async function testConnection() {
  assertConfigured();
  const url = baseUrl('SearchUser');
  const params = commonParams({ range: 1, startIndex: 1 });
  const { data } = await request({ method: 'get', url: url, params: params });
  if (data && data.SEVERITY === 'SEVERE') {
    throw new Error((data.STATUS_MESSAGE || 'ADManager Plus-ը սխալ վերադարձրեց') + ' (ERROR_CODE: ' + data.ERROR_CODE + ')');
  }
  return { raw: data };
}

async function searchGroup(groupName) {
  assertConfigured();
  const url = baseUrl('SearchGroup');
  const params = commonParams({ RANGE: 10, FROM_INDEX: 1, searchText: groupName });
  const { data } = await request({ method: 'get', url: url, params: params });
  const results = Array.isArray(data) ? data : [];
  const target = groupName.toLowerCase();
  const exact = results.find(function (g) {
    return (g.GROUP_NAME || '').toLowerCase() === target || (g.SAM_ACCOUNT_NAME || '').toLowerCase() === target;
  });
  return exact || null;
}

async function createGroup(groupName) {
  assertConfigured();
  if (!GROUP_OU) { throw new Error('GROUP_OU-ը սահմանված չէ .env-ում'); }
  const url = baseUrl('CreateGroup');
  const inputFormat = JSON.stringify([{
    name: groupName,
    sAMAccountName: groupName,
    templateName: GROUP_TEMPLATE_NAME || 'Partner-Group-Template',
    groupType: GROUP_TYPE || 'Security',
    groupScope: GROUP_SCOPE || 'Global',
    OUName: GROUP_OU
  }]);
  const params = commonParams({ inputFormat: inputFormat });
  const { data } = await request({ method: 'post', url: url, params: params });
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || String(result.status) !== '1') {
    throw new Error('CreateGroup failed: ' + ((result && result.statusMessage) || 'անհասկանալի սխալ'));
  }
  const ouName = result['OU Name'] || GROUP_OU;
  return { dn: 'CN=' + groupName + ',' + ouName, raw: result };
}

async function createUser(fields) {
  assertConfigured();
  const url = baseUrl('CreateUser');
  const inputFormat = JSON.stringify([{
    givenName: fields.givenName,
    sn: fields.sn,
    company: fields.company,
    memberof: fields.memberDn,
    altSecurityIdentities: fields.altSecurityIdentities,
    templateName: USER_TEMPLATE_NAME || 'CreateNewUser'
  }]);
  const params = commonParams({ inputFormat: inputFormat });
  const { data } = await request({ method: 'post', url: url, params: params });
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || result.status !== 'SUCCESS') {
    throw new Error('CreateUser failed: ' + ((result && result.statusMessage) || 'անհասկանալի սխալ'));
  }
  return { logonName: result['SAM Account Name'] || result.USER_NAME, userName: result.USER_NAME, password: result.USER_PASSWORD, raw: result };
}

async function resetPassword(mail, newPassword) {
  assertConfigured();
  const url = baseUrl('ResetPwd');
  const inputFormat = JSON.stringify([{ mail: mail }]);
  const params = commonParams({ passwordType: 'password', pwd: newPassword, inputFormat: inputFormat });
  const { data } = await request({ method: 'post', url: url, params: params });
  const results = Array.isArray(data) ? data : (data ? [data] : []);
  const result = results[0];

  if (!result) {
    throw new Error('No AD user found for email ' + mail);
  }
  const statusMessage = result.statusMessage || result.STATUS_MESSAGE || '';
  const statusOk = result.status === '1' || result.status === 1 || /success/i.test(statusMessage);
  if (!statusOk) {
    throw new Error('ResetPwd failed: ' + (statusMessage || 'unknown error (no AD user matched this email, or the AuthToken lacks permission)'));
  }

  return {
    sAMAccountName: result.sAMAccountName,
    userPrincipalName: result.userPrincipalName,
    raw: result
  };
}

async function listAllUsers() {
  assertConfigured();
  const url = baseUrl('SearchUser');
  const params = commonParams({ range: 500, startIndex: 1 });
  const { data } = await request({ method: 'get', url: url, params: params });
  return Array.isArray(data && data.UsersList) ? data.UsersList : [];
}

async function setUserEnabled(mail, enabled) {
  assertConfigured();
  const action = enabled ? 'EnableUser' : 'DisableUser';
  const url = baseUrl(action);
  const inputFormat = JSON.stringify([{ mail: mail }]);
  const params = commonParams({ inputFormat: inputFormat });
  const { data } = await request({ method: 'post', url: url, params: params });
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || String(result.status) !== '1') {
    throw new Error(action + ' failed: ' + ((result && result.statusMessage) || 'անհասկանալի սխալ'));
  }
  return result;
}

async function addUserToGroup(sAMAccountName, groupName) {
  assertConfigured();
  const url = baseUrl('AddUsersToGroup');
  const inputFormat = JSON.stringify([{ sAMAccountName: sAMAccountName }]);
  const params = commonParams({ inputFormat: inputFormat, addGroup: JSON.stringify([groupName]) });
  const { data } = await request({ method: 'post', url: url, params: params });
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || String(result.status) !== '1') {
    throw new Error('AddUsersToGroup failed: ' + ((result && result.statusMessage) || 'անհասկանալի սխալ'));
  }
  return result;
}

module.exports = { testConnection, searchGroup, createGroup, createUser, addUserToGroup, resetPassword, listAllUsers, setUserEnabled };