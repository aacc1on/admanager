// File: public/js/main.js
var container = document.querySelector('.container');
var GROUP_OU = container.getAttribute('data-group-ou') || '';
var SAM_MAX_LENGTH = parseInt(container.getAttribute('data-sam-max-length') || '20', 10);
var UNSAFE_CHARS = /[,+"\\<>;\r\n=]/g;
var MAX_USER_ROWS = 20;

function sanitizeForAD(value) {
  if (!value) return '';
  return value.toString().replace(UNSAFE_CHARS, '').trim();
}

function truncate(value, max) {
  var limit = max || SAM_MAX_LENGTH;
  var str = (value || '').toString();
  if (str.length <= limit) return { value: str, truncated: false };
  return { value: str.slice(0, limit), truncated: true };
}

function buildGroupName(partnerName, partnerId) {
  var cleanName = sanitizeForAD(partnerName).replace(/\s+/g, ' ').trim();
  var cleanId = sanitizeForAD(partnerId).toString().trim();
  return cleanName + '-RDS-' + cleanId;
}

// --- Group preview ---
var partnerIdInput = document.getElementById('partnerId');
var partnerNameInput = document.getElementById('partnerName');
var groupPreview = document.getElementById('groupPreview');
var groupPreviewName = document.getElementById('groupPreviewName');
var groupConfirmed = document.getElementById('groupConfirmed');
var submitBtn = document.getElementById('submitBtn');

function updateGroupPreview() {
  var name = partnerNameInput.value.trim();
  var id = partnerIdInput.value.trim();
  if (!name || !id) {
    groupPreview.hidden = true;
    return;
  }
  var groupName = buildGroupName(name, id);
  groupPreviewName.textContent = 'CN=' + groupName + ',' + GROUP_OU;
  groupPreview.hidden = false;
  // Any change to the target group invalidates a previous manual confirmation.
  groupConfirmed.checked = false;
  updateSubmitState();
}

partnerIdInput.addEventListener('input', updateGroupPreview);
partnerNameInput.addEventListener('input', updateGroupPreview);

// --- Submit button gated on manual group confirmation ---
function updateSubmitState() {
  submitBtn.disabled = !groupConfirmed.checked;
}

groupConfirmed.addEventListener('change', updateSubmitState);

// --- Multi-user rows ---
var userRowTemplate = document.getElementById('userRowTemplate');
var userRowsContainer = document.getElementById('userRows');
var addUserBtn = document.getElementById('addUserBtn');
var usersCount = document.getElementById('usersCount');

function rowGivenNameInput(row) { return row.querySelector('[data-field="givenName"]'); }
function rowAltSecurityInput(row) { return row.querySelector('[data-field="altSecurityIdSuffix"]'); }
function rowEmailInput(row) { return row.querySelector('[data-field="email"]'); }
function rowHint(row) { return row.querySelector('[data-given-name-hint]'); }

function updateRowGivenNameHint(row) {
  var hint = rowHint(row);
  var result = truncate(sanitizeForAD(rowGivenNameInput(row).value));
  hint.textContent = result.truncated
    ? 'Will be truncated to fit the ' + SAM_MAX_LENGTH + '-character AD account name limit: "' + result.value + '"'
    : 'Often the same value as Alt Security Identity below';
}

function reindexRows() {
  var rows = userRowsContainer.querySelectorAll('[data-user-row]');
  rows.forEach(function (row, index) {
    row.querySelector('[data-row-number]').textContent = index + 1;
    rowGivenNameInput(row).name = 'users[' + index + '][givenName]';
    rowAltSecurityInput(row).name = 'users[' + index + '][altSecurityIdSuffix]';
    rowEmailInput(row).name = 'users[' + index + '][email]';
    row.querySelector('[data-remove-row]').disabled = rows.length <= 1;
  });
  usersCount.textContent = '(' + rows.length + ')';
  addUserBtn.disabled = rows.length >= MAX_USER_ROWS;
}

function addUserRow() {
  var rows = userRowsContainer.querySelectorAll('[data-user-row]');
  if (rows.length >= MAX_USER_ROWS) return;

  var fragment = userRowTemplate.content.cloneNode(true);
  var row = fragment.querySelector('[data-user-row]');
  userRowsContainer.appendChild(fragment);

  var givenNameInput = rowGivenNameInput(row);
  var altSecurityInput = rowAltSecurityInput(row);

  givenNameInput.addEventListener('input', function () { updateRowGivenNameHint(row); });
  altSecurityInput.addEventListener('blur', function () {
    if (!givenNameInput.value.trim() && altSecurityInput.value.trim()) {
      givenNameInput.value = altSecurityInput.value.trim();
      updateRowGivenNameHint(row);
    }
  });
  row.querySelector('[data-remove-row]').addEventListener('click', function () {
    if (userRowsContainer.querySelectorAll('[data-user-row]').length <= 1) return;
    row.remove();
    reindexRows();
  });

  reindexRows();
  return row;
}

function resetUserRows() {
  userRowsContainer.innerHTML = '';
  addUserRow();
}

addUserBtn.addEventListener('click', addUserRow);
resetUserRows();

// --- Test connection ---
document.getElementById('testConnectionBtn').addEventListener('click', function () {
  var btn = document.getElementById('testConnectionBtn');
  var result = document.getElementById('testConnectionResult');
  btn.disabled = true;
  result.textContent = 'Testing...';
  result.className = '';
  fetch('/test-connection')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      result.textContent = data.message;
      result.className = data.ok ? 'done' : 'error';
    })
    .catch(function () {
      result.textContent = 'Connection error. Please try again.';
      result.className = 'error';
    })
    .finally(function () {
      btn.disabled = false;
    });
});

// --- Provisioning form ---
document.getElementById('provisionForm').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!groupConfirmed.checked) return;

  var form = e.target;
  var statusWindow = document.getElementById('statusWindow');
  var statusList = document.getElementById('statusList');
  statusWindow.hidden = false;
  statusList.innerHTML = '';
  submitBtn.disabled = true;
  var params = new URLSearchParams(new FormData(form));
  var source = new EventSource('/provision/stream?' + params.toString());
  var stepLines = {};

  function addLine(text, cls) {
    var li = document.createElement('li');
    li.textContent = text;
    li.className = cls || '';
    statusList.appendChild(li);
    return li;
  }

  source.onmessage = function (event) {
    var data = JSON.parse(event.data);
    if (data.step === 'credentials') {
      var box = document.createElement('li');
      box.className = 'credentials-box';
      box.innerHTML =
        '<strong>Send these credentials manually (copy now, they will not be shown again)</strong>' +
        '<div>Send to: <code>' + data.notifyEmail + '</code></div>' +
        '<div>Account email: <code>' + data.accountEmail + '</code></div>' +
        '<div>Password: <code>' + data.password + '</code></div>';
      statusList.appendChild(box);
      return;
    }
    if (data.step === 'done') {
      source.close();
      updateSubmitState();
      var cls = data.status === 'success' ? 'done' : (data.status === 'partial' ? 'warn' : 'error');
      addLine(data.message, cls);
      if (data.status === 'success') {
        form.reset();
        groupPreview.hidden = true;
        resetUserRows();
        updateSubmitState();
      }
      return;
    }
    var icon = '...';
    if (data.status === 'done') icon = 'OK';
    else if (data.status === 'error') icon = 'ERROR';
    else if (data.status === 'warn') icon = 'WARN';
    var text = icon + ' ' + data.message;
    if (stepLines[data.step] && data.status !== 'progress') {
      stepLines[data.step].textContent = text;
      stepLines[data.step].className = data.status;
    } else {
      stepLines[data.step] = addLine(text, data.status);
    }
  };

  source.onerror = function () {
    addLine('Connection error. Please try again.', 'error');
    updateSubmitState();
    source.close();
  };
});
