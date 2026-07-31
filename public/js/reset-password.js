// File: public/js/reset-password.js
var MAX_RESET_ROWS = 20;

var resetRowTemplate = document.getElementById('resetRowTemplate');
var resetRowsContainer = document.getElementById('resetRows');
var addResetBtn = document.getElementById('addResetBtn');
var resetCount = document.getElementById('resetCount');

function rowTargetEmailInput(row) { return row.querySelector('[data-field="targetEmail"]'); }
function rowNotifyEmailInput(row) { return row.querySelector('[data-field="notifyEmail"]'); }
function rowQuickSearch(row) { return row.querySelector('[data-quick-search]'); }
function rowQuickList(row) { return row.querySelector('[data-quick-list]'); }

function wireQuickSearch(row) {
  var input = rowQuickSearch(row);
  var list = rowQuickList(row);
  var targetEmailInput = rowTargetEmailInput(row);
  var debounce = null;

  function closeList() {
    list.hidden = true;
    list.innerHTML = '';
  }

  function renderList(users) {
    var withMailbox = users.filter(function (u) { return u.canToggle; });
    if (!withMailbox.length) {
      closeList();
      return;
    }
    list.innerHTML = '';
    list.hidden = false;
    withMailbox.forEach(function (u) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'group-list-item';
      item.innerHTML =
        '<span class="group-list-name">' + (u.displayName || u.samAccountName) + ' <span class="hint">(' + (u.company || '—') + ')</span></span>' +
        '<code class="group-list-code">' + u.email + '</code>';
      item.addEventListener('mousedown', function (e) {
        e.preventDefault();
        targetEmailInput.value = u.email;
        input.value = '';
        closeList();
      });
      list.appendChild(item);
    });
  }

  input.addEventListener('input', function () {
    var text = input.value.trim();
    clearTimeout(debounce);
    if (!text) {
      closeList();
      return;
    }
    debounce = setTimeout(function () {
      fetch('/directory/api/search?q=' + encodeURIComponent(text))
        .then(function (r) { return r.json(); })
        .then(function (data) { renderList((data && data.users) || []); })
        .catch(function () { /* quick-select is a convenience feature; ignore failures */ });
    }, 200);
  });
  input.addEventListener('blur', closeList);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeList();
      input.blur();
    }
  });
}

function reindexResetRows() {
  var rows = resetRowsContainer.querySelectorAll('[data-reset-row]');
  rows.forEach(function (row, index) {
    row.querySelector('[data-row-number]').textContent = index + 1;
    rowTargetEmailInput(row).name = 'entries[' + index + '][targetEmail]';
    rowNotifyEmailInput(row).name = 'entries[' + index + '][notifyEmail]';
    row.querySelector('[data-remove-row]').disabled = rows.length <= 1;
  });
  resetCount.textContent = '(' + rows.length + ')';
  addResetBtn.disabled = rows.length >= MAX_RESET_ROWS;
}

function addResetRow() {
  var rows = resetRowsContainer.querySelectorAll('[data-reset-row]');
  if (rows.length >= MAX_RESET_ROWS) return;

  var fragment = resetRowTemplate.content.cloneNode(true);
  var row = fragment.querySelector('[data-reset-row]');
  resetRowsContainer.appendChild(fragment);

  wireQuickSearch(row);
  row.querySelector('[data-remove-row]').addEventListener('click', function () {
    if (resetRowsContainer.querySelectorAll('[data-reset-row]').length <= 1) return;
    row.remove();
    reindexResetRows();
  });

  reindexResetRows();
  return row;
}

function resetRows() {
  resetRowsContainer.innerHTML = '';
  addResetRow();
}

addResetBtn.addEventListener('click', addResetRow);
resetRows();

document.getElementById('resetForm').addEventListener('submit', function (e) {
  e.preventDefault();

  var form = e.target;
  var submitBtn = document.getElementById('resetSubmitBtn');
  var statusWindow = document.getElementById('statusWindow');
  var statusList = document.getElementById('statusList');
  statusWindow.hidden = false;
  statusList.innerHTML = '';
  submitBtn.disabled = true;

  var params = new URLSearchParams(new FormData(form));
  var source = new EventSource('/reset-password/stream?' + params.toString());
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
        '<strong>Send this password manually (copy now, it will not be shown again)</strong>' +
        '<div>Send to: <code>' + data.notifyEmail + '</code></div>' +
        '<div>Account email: <code>' + data.accountEmail + '</code></div>' +
        '<div>Password: <code>' + data.password + '</code></div>';
      statusList.appendChild(box);
      return;
    }
    if (data.step === 'done') {
      source.close();
      submitBtn.disabled = false;
      var cls = data.status === 'success' ? 'done' : (data.status === 'partial' ? 'warn' : 'error');
      addLine(data.message, cls);
      if (data.status === 'success') {
        form.reset();
        resetRows();
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
    submitBtn.disabled = false;
    source.close();
  };
});
